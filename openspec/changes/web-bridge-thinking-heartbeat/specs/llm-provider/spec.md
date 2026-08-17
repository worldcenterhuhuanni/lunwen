# llm-provider Spec

## ADDED Requirements

### Requirement: 网页思考期报活

系统 SHALL 在 DeepSeek 页面确实处于生成状态但正文尚未出现时持续报告进度，使仍在思考的请求不被判定为无响应。

#### Scenario: 长时间思考后才开始输出

- WHEN 页面处于生成状态且超过空闲阈值仍未产生正文
- THEN 系统 SHALL 定期报告已等待时长
- AND 本次请求 SHALL 继续等待，不得按无新内容中断

#### Scenario: 页面毫无动静

- WHEN 页面既未处于生成状态，也没有新内容
- THEN 系统 SHALL 在空闲阈值后停止等待
- AND 错误信息 SHALL 说明页面没有任何动静并给出排查方向

#### Scenario: 正文开始推进

- WHEN 页面开始产生正文
- THEN 系统 SHALL 改为推送正文增量，不再重复报告等待时长
