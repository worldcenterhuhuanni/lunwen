# DeepSeek Harness 网页桥适配器

## Why

本地已有 DeepSeek Harness（`/Users/lijie/git/deepseek-harness`，下称 dsh）——一个完整的 agent harness。它的模型层必须配 API Key，没有"用已登录网页免费额度"的通路。

本扩展的核心资产恰恰是免 Key 的网页 DOM 桥（`lib/deepseek-web.ts`）。把两者接起来，dsh 就能白嫖网页额度。

**契约可行性已通过读源码验证（见 design.md「已验证」），剩余风险全部集中在网页版限流，必须先实测再决定是否实现。**

## What

分三阶段，**每阶段都是门，不过就终止**：

- **阶段 0 · 可行性实测**（本变更当前范围）
  - V1：DeepSeek 网页接不接受 `.md` / `.txt` 附件
  - V2：连续多轮大附件提交的限流阈值 ← **致命假设**
  - V3：输入框长度上限（附件路线不通时的退路）
- **阶段 1 · 最小闭环**：单轮无工具的 `LlmAdapter`，跑通 dsh 一次问答
- **阶段 2 · 完整适配**：工具调用、思考流、标签池并发

## Not

- 不改动扩展现有 `deepseek-web` provider 的行为；适配器是新增旁路，侧栏自用路径不受影响
- 不追求 `temperature` / `maxTokens` / `stop` 的语义（网页版无法控制，一律忽略）
- 不在阶段 0 写任何适配器代码
- 不替换扩展自己的 `lib/agent/runtime.ts`；dsh 是并列选项，不是取代

## 验收

**阶段 0（本次）：**

1. V1/V2/V3 三项实测各有明确结论并记录在 `design.md`
2. V2 结论若为"连续 N 轮内必被限流且 N < 20"，本变更直接归档为「已评估·不实施」，不进入阶段 1

**阶段 1（V2 通过后才展开）：**

3. dsh 中选择 `deepseek-web` provider，能完成一次不含工具的问答，输出流式可见
4. dsh 的 `llm-invariant` 校验全程无 failure
