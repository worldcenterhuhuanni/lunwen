# Tasks

- [x] `deepseek.content.ts` 的 `waitReply`：页面在生成但正文未出现时每 15 秒推送一次思考进度，正文推进时重置计时
- [x] 页面既未生成又无变化时保持静默，不掩盖真正的卡死
- [x] `deepseek-web.ts`：空闲超时文案改为描述真实状态并给出排查方向
- [x] 单测：持续报活跨过 180 秒阈值不报错；毫无动静超过阈值如实报错
- [x] 反向验证：临时移除 progress 刷新活动时间后，报活用例转红
- [x] `pnpm test`（41 通过）、`pnpm compile`、`pnpm build`
- [ ] 在 `output/chrome-mv3` 用本地工作区实测一次完整分析（需人工）
