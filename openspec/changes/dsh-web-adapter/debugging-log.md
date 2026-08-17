# 调试复盘：把 DeepSeek 网页版接进 dsh

记录真实踩过的坑。每条都写清**现象 → 根因 → 证据 → 修法**，以及当时我判断错在哪里。
留这份东西的目的不是记功，是让下一个人（或下一次的我）不必重新踩。

---

## 一、贯穿全程的两个教训

### 1. 「我知道这个限制」不等于「我处理了这个限制」

`README.md` 的「已知限制」里第一版就写着：

> 单会话串行。一个标签页是单一物理资源，并发请求会互相抢输入框。

写下了，但没实现串行化。结果 dsh 的会话标题请求与主请求并发，两段 prompt 被拼进同一个输入框，
用户问「爱情是什么」拿到的是生成出来的标题「爱的本质探索」。

**限制写进文档只是记录，不是防护。** 能用 20 行代码消掉的限制，不要留在文档里当免责声明。

### 2. 别用叠加去补偿一个错误的判断

本次两处犯了同一个毛病（P6、P8 第一版）：定位到问题后，不是把错的那处改对，
而是**再叠一层新逻辑上去补偿**。

- P6：原判据有问题 → 我叠了一条 OR 上去 → 引入每轮必然发生的错误
- P8：诊断是「近处指令压过远处」→ 我既改了近处措辞，又在近处重发一份远处的内容

叠加看起来更安全，实际上：既掩盖了原因（改好了也不知道哪处起作用），又自带新的失效路径。
**一次只改一个变量，先把错的那处改对。**

### 3. 绕过集成层的测试不叫端到端

我曾报告「三轮真实问答通过，首字 1.0–1.2s」，那是**直接驱动 `WebSession`** 跑出来的，
根本没经过 dsh 的 agent loop。于是：

- 会话标题请求（只在首轮发）永远不会触发 → 并发踩踏藏了很久
- 工具调用链路（`renderIncrement` → 模型 → `parse.ts`）从未被真正走过

**验证必须从系统的真实入口进。** 对这个插件来说，入口是 `http://127.0.0.1:3080/`，不是 `WebSession.ask()`。

### 4. slice 的边界就是「近处上下文」的边界

增量发送的标准是「网页那边已经收到过的，不再发」：

```ts
// adapter.ts —— 本轮成功后记账
sentIds: options.messages.map(message => message.id)
// adapter.ts —— 续轮从上次记了多少条开始
const resumeAt = blocker === null ? this.conversation?.sentIds.length ?? 0 : 0
// render.ts —— 只发那之后新增的,且跳过 assistant(网页自己产出的,回灌等于重看自己)
options.messages.slice(fromIndex).filter(message => message.role !== 'assistant')
```

**边界画错了，这是设计错误而不是实现疏漏。** 边界画在「已发送的消息条数」上，
正确的边界是**「轮」**：一轮里的多个 step 共享同一个用户提问，那个提问在本轮结束前
**根本不是历史**，必须在每个 step 都在场。用户的原话点破了这一点：

> 这一整句话都是 usermessage，这里为啥要 slice？

（`slice` 切的是 messages **数组**，那条消息本身完好地待在 index N —— 但结果一样：
它整条落在边界外。）

除此之外还有一层隐含假设也是错的：**「网页对话的历史等价于 dsh 的历史，所以只发差量就够」**
——这对**信息存在性**成立，对**注意力权重**不成立。

本次三个故障全是这条边界的产物：

| 落在边界外的东西 | 后果 | 编号 |
|---|---|---|
| system prompt（首轮，35KB 附件里） | 续轮回答漂向普通闲聊 | 见 §五 |
| `<tool_call>` 格式约定（首轮） | 被近处「只输出回复本身」压过，只说不做 | P8 |
| 用户的提问（工具调用第一步） | 第二步漏掉「有几个」这个要点 | P9 |

工具调用两步之间 index 是怎么错开的：

```
第一步  messages = [..., 提问]      长度 N+1  → 记账 sentIds = 全 N+1 条
        模型回 tool_call,dsh 追加 assistant(tool-call) + user(tool-result)
第二步  fromIndex = N+1
        slice(N+1) → [assistant(tool-call), user(tool-result)]
        filter 掉 assistant → 只剩 tool-result;提问在 index N,被切掉
```

**修法判据**：去看实际发出去的文档，那段内容**在不在里面**。
不在就补（P9），在但被近处措辞压过就改措辞（P8）。

为什么没有真的按「轮」重画边界：那会把本轮之前所有 step 的工具结果一起重发
（一轮五次工具调用，第五步要重发前四次的输出，可能是几十 KB），
而缺的只有提问这一条。**只补提问是等效且更省的做法** —— 但要记住它修的是边界语义，
不是「工具结果轮顺手补点东西」。

---

## 二、取证方法（比结论更有用）

调试这类「网页 + 多进程 + 流式」的东西，靠猜必然反复翻车。三个能直接看到事实的手段：

### 1. 读 dsh 的会话事件日志

路径：`~/.dsh/sessions/<项目>/<session-id>/session.jsonl.zstd`

**坑**：它是逐条 append 的**多帧** zstd，`zstdDecompressSync` 和流式解压都只吐第一帧。
必须按 magic `0x28 B5 2F FD` 切帧后逐帧解：

```js
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])
const starts = []
for (let i = 0; i + 4 <= buf.length; i++) {
  if (buf.compare(MAGIC, 0, 4, i, i + 4) === 0) starts.push(i)
}
let raw = ''
for (const [k, s] of starts.entries()) {
  raw += zstdDecompressSync(buf.subarray(s, starts[k + 1] ?? buf.length)).toString('utf8')
}
```

里面有 `request/header`、`assistant/chunk`（逐个 chunk！）、`assistant/message`、
`tool/call`、`session/title-llm-request`。**这份日志能直接回答「dsh 到底收到了什么」**，
不用猜适配器发了什么。本次一半的根因是从它里面挖出来的。

### 2. 直接连 CDP 读页面真实状态

不要凭页面截图推断 DOM。起一个脚本连 `http://127.0.0.1:9222`，
`Runtime.evaluate` 读你关心的那几个值。本次用它推翻了两个错误结论（见下）。

### 3. 调用注入进去的 page agent 本体

`window.__dshWeb.snapshot()` 在页面里活着。直接调它，看到的就是驱动方每轮看到的东西。
本次靠 `watching: false` 判断出 session 层其实已经收尾，问题在更上层。

---

## 三、逐个问题

### P1 每轮问答都把浏览器窗口抬到最前

| | |
|---|---|
| 现象 | 每次在 dsh 里提问，插件的 Chrome 窗口跳到最前，抢走键盘焦点 |
| 根因 | 用了 `Page.bringToFront` 来保证页面可见 |
| 修法 | 换成 `Emulation.setFocusEmulationEnabled({ enabled: true })` |

页面自认为可见且获得焦点，但**不抬窗口、不抢焦点**。实测 `document.hidden` 立刻从 true 翻成 false。

`Page.setWebLifecycleState('active')` 不管用——它管的是冻结/丢弃生命周期，翻不动 visibility。

### P2 【错误结论】「后台标签虚拟列表零渲染」

我曾断定：标签页在后台时 `document.hidden = true`，消息区虚拟列表高度为 0、一条都不渲染。

**这是错的。** 实测 `hidden: true` 时：

```json
{"hidden":true,"visibleKids":2,"nonEmpty":2,"scrollH":672,"clientH":672}
{"hidden":true,"items":4,"h":840}
```

照样渲染。`hidden` 的真实来源是那个 profile 里开了**两个标签**（用户在同一个浏览器里也开了 3080），
DeepSeek 那个不是激活标签。

当初加 `bringToFront` 后问题消失，我把**相关性当成了因果**。真正的故障另有原因（见 P4）。

### P3 【错误结论】「`.ds-markdown` 已被改版淘汰」

我曾断定站点改版后 `.ds-markdown` 失效，于是改成读消息容器的 children。

**这是错的。** dump 助手气泡结构：

```
DIV._4f9bf79 d7dc56a8 _43c05b5          ← 气泡（混淆 class）
  DIV.ds-message _63c77b1
    DIV.ds-markdown ds-assistant-message-main-content   ← 正文，一直都在
      P.ds-markdown-paragraph
  DIV.ds-flex _0a3d93b                  ← 底部按钮区
```

失效的只是**消息容器**（`.ds-virtual-list-visible-items`），正文节点一直是 `.ds-markdown`。

这个错判直接导致了 P4——我以为没有正文节点可用，才退而去读整条气泡。

### P4 回复以「正在阅读 正在阅读」开头

| | |
|---|---|
| 现象 | dsh 里的回答变成「正在阅读\n正在阅读很抱歉听到你这么说……」 |
| 证据 | `assistant/message.text` 原文就是这样，说明是适配器发过去的，不是 UI 渲染问题 |
| 根因 | 回复文本读的是整条气泡的 `innerText`，把站点读附件时的状态文字和底部按钮区一起读走了 |
| 修法 | 只读正文节点 `.ds-markdown`；没有正文节点就返回空——那正是「站点还在忙、回答尚未开始」 |

```js
function replyText() {
  const nodes = document.querySelectorAll('.ds-markdown');
  if (!nodes.length) return '';
  return ((nodes[nodes.length - 1].innerText) || '').trim();
}
```

**教训**：读一个「渲染给人看」的容器时，里面一定混着不属于内容的东西。要读就读语义最窄的那个节点。

### P5 完成判据用 `count`，长对话会永久失效

原判据：`snapshot.count >= baselineCount + 2`（发送后多出提问和回复两条气泡）。

`count` 来自 `.ds-virtual-list-visible-items` 的 children —— **虚拟列表的可见条目数**，
对话一长就到视口上限不再增长。该判据会永久失效，表现是干等到超时。当时对话都短，没炸。

### P6 【我引入的 bug】续轮的回答带上上一轮的回答

修 P5 时我把判据改成「可见数增长 **或** 正文与发送前不同」。立刻炸了：

| | |
|---|---|
| 现象 | turn 2 的回答以 turn 1 的全文开头 |
| 证据 | `assistant/message` 原文（turn 2 的内容 = turn 1 全文 + turn 2 回答） |
| 根因 | **提问气泡比回复气泡先出现**。那一刻 `count` 已增长，但最后一个正文节点还是上一轮的回复 → 被当成本轮新内容发出去；等本轮回答真的出现，前缀对不上，又整段发一次 |
| 修法 | 删掉 `count` 分支，只保留「正文与发送前不同」 |

保留的代价：本轮回答与上一轮**逐字相同**时判不出来。但新回复的正文节点从空开始逐字长，
流式期间必然出现过中间态；真漏了还有 idle 超时兜住，不是静默错误。

**教训**：为两个**假想**场景加的 OR，换来一个**每轮必然发生**的错误。
判据不是越多越稳——多一条 OR 就多一条误判路径。原判据有问题时，正确动作是换成对的那一条，
不是再叠一条上去。

这和 P8 第一版是**同一个毛病**：诊断出问题后，不是把错的那处改对，而是叠一层新东西上去
补偿。叠加看起来更安全，实际上既掩盖了原因，又自带新的失效路径。

### P7 问「爱情是什么」，回答「爱的本质探索」

| | |
|---|---|
| 现象 | 回答是个短名词短语，像标题不像回答；直接在网页版问则正常 |
| 根因 | dsh 为会话起名会**额外发一个 LLM 请求**，与主请求并发。两个 `ask()` 各自 `Input.insertText` 到同一个输入框，站点收到两段 prompt 拼接，按最后读到的指令作答 |
| 修法 | `createGate()` —— 一个标签页一次只服务一个请求，按到达顺序排队 |

证据链完整：

```
[user/message] 爱情是什么
[session/title] title:"爱情是什么"  source:fallback
[request/header] deepseek-web                ← 主请求
[session/title-llm-request] ...              ← 标题请求，并发
[session/title] title:"爱的本质探索"  source:provider
[assistant/message] 爱的本质探索              ← 主请求读走了标题请求的回答
```

截图里输入框内容也证实了拼接：

```
### [1] 用户
Generate the session title from this JSON array of human messages:
[{"seq":7,"text":"爱情是什么"}]
## 你的任务
…请阅读附件中的对话记录，按其中「你的任务」一节作答。
```

**为什么藏了这么久**：标题请求只在会话**首轮**发一次，而首轮往往是寒暄。
问「你好」→ 标题「你好！有什么我可以帮你的吗？」→ 看起来是一句完美的回答，没人会怀疑。
换成「爱情是什么」才露馅，因为标题和回答的形态差别太大。

**代价**（选择不关标题生成）：每个 dsh 会话在网页侧有 2 个对话（1 主 + 1 标题）。
标题请求会覆盖会话记录，所以第 2 轮全量重发一次，之后恢复增量。可接受。

闸门实现（提成独立函数是为了能在没有浏览器的情况下测互斥）：

```ts
export function createGate(): () => Promise<() => void> {
  let queue: Promise<void> = Promise.resolve()
  return () => {
    const previous = queue
    let release = (): void => {}
    queue = new Promise<void>((resolve) => { release = resolve })
    return previous.then(() => release)
  }
}
```

### P8 续轮不调工具，只说「我先看一下那个目录」

| | |
|---|---|
| 现象 | 问「某目录下有几个文件夹」，模型回「我先看一下……」然后 stop，一次工具都不调 |
| 证据 | session turn 3 只有意图叙述，无 `tool/call`；而先前那次成功的调用恰好走了**全量**渲染 |
| 根因 | 续轮 prompt 结尾写着「只输出回复本身」——它贴在问题后面，压过了远在附件开头的 `<tool_call>` 格式约定，读起来就是「别输出工具调用标记」 |
| 修法 | 删掉那句冲突措辞，改为「需要用工具就直接按约定格式输出调用，不要只说明你打算做什么」 |

**这条最值得记住**：上下文一直都在，附件也没丢，模型甚至明确表达了正确意图
（说明它记得工具存在）。失效的原因是**指令冲突，而近的赢**。
**长上下文里，位置就是权重。**

#### 我第一版修错了，用户当场纠正

第一版我做了两件事：改掉冲突措辞，**并且**在续轮重发工具名清单 + 格式约定。用户的质疑：

> 如果是指令冲突，那你没必要重申一遍，因为这不是两遍了吗？而应该把那个冲突的指令修改

完全正确。两个问题：

1. **逻辑上多余。** 既然诊断是「近处的指令压过远处的」，那移除近处的反向拉力就够了。
   远处的约定本来有效——是我用措辞把它压掉的。
2. **调试上更糟。** 一次改两处，修好了也不知道是哪一处起的作用。
   `renderIncrement` 每轮多带几百字符，也白付。

**一次只改一个变量。** 先只修冲突，跑；真还不调，再加重申——届时才能确定原因是位置权重而不是冲突。

残留的不确定性写在这里：移除冲突措辞后模型是否就按格式输出，**目前只有一个反向样本（turn 3），
没有正向数据**。如果实测仍不调，那才说明「远处约定权重不足」是独立成因，需要重申。

### P9 工具调用后的回答漏掉提问里的要求

| | |
|---|---|
| 现象 | 问「某目录下有几个文件夹，分别是啥」，工具跑完后只逐个介绍，**不报数量** |
| 证据 | 两步的 usage：第一步 `in=40`（提问），第二步 `in=189`（只有工具结果）。全量那次（`in=9163`）反而报了数量 |
| 根因 | `renderIncrement` 只发「上次之后新增的消息」。提问在第一步就发过了，第二步被 slice 掉——写最终回答时，提问**根本不在上下文里**，模型只看到一堆 `ls` 输出和一句泛泛的「给出下一条回复」 |
| 修法 | 工具结果轮把当前提问补回去（`## 当前要回答的问题`） |

**和 P8 的区别要分清**：P8 是「约定在远处，被近处措辞压过」→ 修近处措辞就够，不必重申；
P9 是「提问根本不在上下文里」→ 必须补。**先分清「在但被压过」和「根本不在」，
前者改措辞，后者补内容。** 判据是去看实际发出去的文档里到底有没有那段内容。

顺带纠正一个印象：全量那次说「共有 **7** 个文件夹」，其实是错的（6 个文件夹 + 3 个 README 文件）。
所以并不是「全量答得更好」，而是全量**尝试**报数量、但数错了；增量则连报数量都没尝试。

---

## 四、性能：78.2s → 2.3s

按贡献排序：

| 做法 | 效果 |
|---|---|
| 关掉站点「智能搜索」（默认是开的） | 首字 32.7s → 2.9s |
| 固定 sleep 换成页面内 Promise 条件等待 | 条件一成立立即返回，不等轮询周期 |
| 导航等 `Page.loadEventFired` 而不是猜时长 | 去掉一段固定等待 |
| 读取改为 MutationObserver + CDP binding 推送 | 新文本一渲染就到，不等下一次轮询 |

**关掉智能搜索是单项最大的一笔**：dsh 自己带工具，网页那层联网搜索是纯粹的浪费。

一个反例记一下：把 `sleep(500)` 换成 `waitSendable` 条件等待时，我用了 `.disabled` 和
`aria-disabled` 当判据。发送键是 `div[role=button]`，这两个属性恒为 `undefined`/`null`，
条件恒真 —— 等于把等待删了，回车打在还禁用的按钮上。
**用条件替换固定等待时，条件必须真的能观测到状态变化。** 判据最后只能看 class：
`!/ds-button--disabled/.test(className)`。

---

## 五、这个插件的固有脆弱点

不是 bug，是这条路线的性质，写下来免得下次当成 bug 查：

1. **无原生 tool call。** 工具调用靠文本协议，遵不遵守全看提示词。P8 是提示词写漏了，
   但即使写对，偶发不遵守也是可能的。真要稳，得检测「有意图无调用」后重试一次（尚未做）。
2. **依赖页面结构。** 站点改版会让选择器失效。已知语义化程度：
   `.ds-markdown` / `.ds-message` / `.ds-button--primary` / `.ds-virtual-list-visible-items` 相对稳，
   消息条目自身的 class 是混淆值（`_9663006` 之类），只能靠位置取。
3. **单标签串行。** 排队不会出错，但会等。真要并发得先做标签池。
4. **限流未实测。** 这仍是唯一能推翻整个方案的未知：网页版是给人交互用的，
   一个 agent 任务几十轮下来会不会触发限流/验证码，没有数据。
5. **token 用量是估算的**（4 字符/token）。不报的话 dsh 的 compaction 永远不触发。

---

## 六、附：新包接进 dsh 的四处登记

缺任何一处都不生效，而且报错完全不指向真实原因：

| 位置 | 缺了会怎样 |
|---|---|
| `tsconfig.host.json` 的 references | TS6307：`packages/*/*/tests/**/*.ts` 把测试收进 host 工程，却看不到 `src/` |
| `knip.json` | 未使用依赖误报 |
| `packages/bundle/base/package.json` | 运行时 node 解析不到模块 |
| `packages/bundle/base/cordis.patch.yml` | 插件根本不加载 |

另外两处易错：

- `registerAdapter` 只让路由**可用**；`registerConfigurableProviders` 才让它进入 UI 目录。两套独立登记。
- 模型选不中先查 `~/.dsh/settings.yaml` 的 `agent-default-model`，
  以及 `cordis.patch.yml` 里可能硬编码的默认路由。会话本身也会 pin 住模型。
