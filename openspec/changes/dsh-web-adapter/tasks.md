# 任务

## 阶段 0 · 可行性

- [x] T0.1 读 dsh 源码确认适配器契约可满足 → 结论见 `design.md` 一、A1–A7
- [x] T0.2 定位扩展侧 PDF 硬编码位置 → `design.md` 四、V1 三处
- [ ] T0.3 **V1**：确认 DeepSeek 网页接受 `.md` 附件（代码已支持，未实测）
- [ ] T0.4 **V3**：输入框最大字符数（`useAttachment: false` 兜底路线的上限）
- [ ] T0.5 **V2**：连续提交 15–20 次大附件，记录首次限流轮次 N ← **仍未测**
- [ ] T0.6 把 V1/V2/V3 实测结论回写 `design.md` 四

> 用户选择跳过阶段 0 直接实现。V2 仍是未验证的致命假设：插件已可运行，
> 但网页版限流可能让长任务不可用。T0.5 会消耗真实账号配额、可能触发风控。

## 阶段 1 · 最小闭环

- [x] T1.10 **架构改为独立**：插件不再依赖浏览器扩展，改用 CDP 驱动真实 Chrome
      （取舍见 `design.md` 三）。新增 `cdp.ts` / `page-agent.ts` / `session.ts`，
      删除 `bridge.ts` / `protocol.ts`；扩展侧 `lib/dsh-bridge.ts` 与 background 接线一并回滚
- [x] T1.11 自动拉起浏览器 → `launch.ts`。运行中的 Chrome 无法事后开启调试端口
      （启动参数会被转交给已有实例），所以用独立 `--user-data-dir` 另起一个，
      与用户日常浏览器并存；`detached + unref` 让它跨 dsh 重启存活，登录态不用重来。
      实测：自动探测到 Chrome 151，端口从未就绪到就绪，落地页为 chat.deepseek.com
- [x] ~~T1.1 扩展侧 WS client~~ → 已随架构调整删除
- [x] T1.2 附件通道支持 `.md` → `entrypoints/deepseek.content.ts` `attachFile()`
      （保留：对扩展自身也是能力增强，与 dsh 无关）
- [x] T1.3 dsh 插件包 `@deepseek-ai/dsh-llm-deepseek-web`，注册 `deepseek-web` route
- [x] T1.4 `DsWebAdapter.stream()` —— 渲染、提交、文本转 chunk
- [x] T1.6 把新包登记进 `tsconfig.host.json` references 与 `knip.json`
      （仓库约定：新包必须登记到 host 或 client 之一，否则 `packages/*/*/tests/**/*.ts`
      会把测试收进 host 工程却看不到 `src/`，报 TS6307）
- [x] T1.7 把插件接进运行时组合，共三处，缺一不可：
      - `packages/bundle/base/package.json` 依赖（否则运行时 node 解析不到模块）
      - `packages/bundle/base/cordis.patch.yml` 插件条目（否则插件根本不加载）
      - 版本对齐 `0.1.0-rc.5`，`pnpm install` 重新 link
- [x] T1.8 让路由出现在模型页：`registerAdapter` 只让路由**可用**，
      `registerConfigurableProviders` 才让它进入 UI 目录（`listConfigurableProviders`），
      两者是独立的两套登记；配套 `installSettingsSection` 提供 `llm-deepseek-web` 设置节
- [x] T1.9 桥接端口被占时不再掀翻整个 harness：`WebSocketServer` 的 `error` 事件
      无人接管会变成 unhandled error event 直接退进程（开第二个 dsh 实例即可复现）。
      改为记录并在请求时报明确失败，回归测试见 `tests/bridge.spec.ts`
- [x] T1.12 修复 DeepSeek 改版导致的三处失效（旧 content script 选择器已过期）：
      消息容器 `.ds-markdown` → `.ds-virtual-list-visible-items`；
      页面已无 `<button>`，发送键为 `div[role=button].ds-button--primary`；
      `insertText` 后需等 React 状态落定再回车。完成判定改为文本稳定 1.6s，
      不再依赖已失效的停止按钮
- [x] T1.13 单会话保持 + 增量发送（对齐 lunwen 的 `webSessionMode: 'multi'`）：
      续轮只发新增 user/工具结果，assistant 跳过；能否续用由 message id 前缀校验决定，
      compaction 改写前缀即自动新开对话。测试见 `tests/conversation.spec.ts`
- [x] T1.14 关闭网页端「智能搜索」（站点默认开启）：首字延迟 32.7s → 2.9s，
      单轮总耗时 78.2s → 4.5s
- [x] T1.15 读取改为推送：页面内 `MutationObserver` 经 CDP binding 回推快照
      （`Runtime.addBinding` + `Runtime.bindingCalled`），页面内合并 120ms；
      低频轮询保留为安全网（observer 可能漏，且完成判定需在静默时推进）。
      等待也从固定 sleep 换成页面内 Promise（`awaitPromise`），导航用 `Page.loadEventFired`
- [x] T1.16 发送改用元素 `click()`（三种提交方式实测只有它稳定生效），键鼠退为兜底；
      当时用 `Page.bringToFront` 让页面可见，见 T1.17 的修正
- [x] T1.17 **不再抢前台** + 推翻两个错误结论：
      - `Page.bringToFront` → `Emulation.setFocusEmulationEnabled`，页面自认为可见且
        有焦点，但不抬窗口、不抢键盘焦点（每轮问答不再跳浏览器）
      - **纠错 1**：T1.16 记的「后台标签虚拟列表零渲染」是错的。实测 `hidden:true` 时
        `items:4, h:840`，照样渲染；`hidden` 的真实来源是该 profile 里另开了 3080 标签
      - **纠错 2**：T1.12 记的「`.ds-markdown` 已失效」是错的。它就是助手正文节点
        （`ds-markdown ds-assistant-message-main-content`），一直有效；当初失效的只是消息容器
- [x] T1.18 **修「正在阅读」污染回复**：回复文本原先读整条气泡的 `innerText`，把站点
      读附件时的状态文字当成了模型输出，dsh 收到的回答以「正在阅读\n正在阅读」开头
      （证据：session 事件里 assistant/message 的 text）。改为只读 `.ds-markdown` 正文节点，
      无正文即视为「尚未开始回答」
- [x] T1.19 新回复判据改为「正文与发送前不同」，`count` 不再参与判定（只留作诊断）。
      两次修正才落定：
      - 先去掉 `count >= baseline + 2` —— `count` 是虚拟列表的**可见**条目数，
        对话一长就到顶不再增长，该判据会永久失效
      - 但换成的「可见数增长 **或** 正文不同」立刻引入了更严重的错误：提问气泡
        比回复气泡先出现，那一刻正文节点还是上一轮的回复，于是**每个续轮的回答
        都以上一轮的回答开头**（证据：session 事件里 turn 2 的 assistant/message
        以 turn 1 的全文起头）。为防两个假想场景加的 OR，换来一个必然发生的 bug
- [x] T1.20 会话复用可诊断：`resumeBlocker()` 返回具体原因并打进日志
      （`复用网页会话，从第 N 条起发增量` / `新开网页会话，原因：…`）。
      实测 turn 5 `inputTokens: 10`，证明增量确实只发了新增那句话
- [x] T1.5 端到端：三轮真实问答通过。首字 1.0–1.2s，单轮 2.2–3.2s，
      第 2 轮答出上一轮记住的数字（会话复用），第 3 轮多个增量（流式推送）。
      相比最初 78.2s 快约 34 倍

## 阶段 2 · 完整适配

- [x] T2.1 工具调用文本协议 + 流式切分 + 解析失败退回可见文本 → `parse.ts`
- [x] T2.6 **续轮工具调用失效**：`renderIncrement` 完全不带工具说明，且结尾写着
      「只输出回复本身」—— 那是在反向暗示模型别输出 `<tool_call>` 标记。表现为模型
      回「我先看一下那个目录」然后 stop，一次工具都不调（证据：session turn 3 的
      assistant/message 只有意图叙述，无 tool/call；而 15:44 那次成功的调用恰好走的是
      全量渲染，带完整工具说明）。修法：**只删掉那句冲突措辞**，改为「需要用工具就直接
      按约定格式输出调用，不要只说明你打算做什么」；工具目录与 schema 不重发 ——
      首轮已在同一个网页对话里给过，`resumeBlocker` 也保证工具集未变。
      测试见 `tests/render.spec.ts`。
      （第一版我同时加了「续轮重发工具清单」，被用户当场纠正：既然诊断是指令冲突，
      重申就是多余，而且一次改两处会分不清哪处起作用。已回退，详见 `debugging-log.md` P8）
      实测验证：`in=40` 纯增量下模型成功输出 `[tool-call:bash]`，只删冲突措辞就够了
- [x] T2.7 **工具结果轮补回提问**：`renderIncrement` 只发新增消息，提问在工具调用第一步
      就发过了，第二步被 slice 掉 —— 写最终回答时提问不在上下文里，模型拿着工具输出
      自由发挥，漏掉「有几个」这类具体要求（证据：两步 usage 为 `in=40` / `in=189`，
      后者只含工具结果）。修法：工具结果轮附上 `## 当前要回答的问题`。
      与 T2.6 的区别：那是「在但被压过」改措辞即可，这是「根本不在」必须补内容
- [ ] T2.2 思考内容映射为 `reasoning-delta`（协议已留 `thinking` 通道；content script 尚未分离思考文本，需等 `web-bridge-thinking-heartbeat` 落地）
- [x] T2.5 **串行化标签页访问**（`createGate`，测试见 `tests/gate.spec.ts`）。
      根因：dsh 生成会话标题会额外发一个 LLM 请求，与主请求重叠；两个 `ask()`
      各自 `Input.insertText` 到同一输入框，站点收到两段提示词拼接后按最后一条指令作答 ——
      用户问「爱情是什么」拿到的是生成出来的标题「爱的本质探索」。
      证据：session 事件 `session/title-llm-request` 紧跟 `request/header`，
      随后 `assistant/message` = 标题文本；截图显示输入框内两段 prompt 拼在一起。
      README 早就写了「并发会互相抢输入框」这条限制，但没实现串行化
- [ ] T2.3 标签池并发（现为单标签串行队列 `createGate`）
- [x] T2.4 `usage` 按 4 字符/token 估算，避免 compaction 永不触发

## 验证记录

- `parse.ts` 切分与解析：12 项断言通过（Node 直跑；vitest 用例已写在 `tests/parse.spec.ts`，待 dsh 装依赖后可跑）
- `render.ts` 渲染：11 项断言通过
- 扩展侧 `pnpm compile` 通过，`pnpm test` 17 文件 41 用例通过
- **dsh 侧未编译验证**：`deepseek-harness` 未 `pnpm install`，`adapter.ts` / `bridge.ts` / `index.ts` 的类型未经检查
