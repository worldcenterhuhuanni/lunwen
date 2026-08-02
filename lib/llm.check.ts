// node 自检(不依赖浏览器):node lib/llm.check.ts
// 验证 SSE 解析(含跨 chunk 半行、[DONE]、噪声行)与 URL 拼接。
import assert from 'node:assert';
import { joinURL, parseSSELine, parseSSEStream } from './llm.ts';

// joinURL:带/不带末尾斜杠都要正确
assert.equal(joinURL('https://api.deepseek.com/v1', 'chat/completions'), 'https://api.deepseek.com/v1/chat/completions');
assert.equal(joinURL('https://generativelanguage.googleapis.com/v1beta/openai/', 'chat/completions'), 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions');

// parseSSELine
assert.equal(parseSSELine('data: {"choices":[{"delta":{"content":"你"}}]}'), '你');
assert.equal(parseSSELine('data: [DONE]'), null);
assert.equal(parseSSELine(': keepalive'), null);
assert.equal(parseSSELine(''), null);

// parseSSEStream:故意把一行拆到两个 chunk 中间
async function* chunks() {
  yield 'data: {"choices":[{"delta":{"content":"大白';
  yield '话"}}]}\n\n';
  yield 'data: {"choices":[{"delta":{"content":"解读"}}]}\n';
  yield 'data: [DONE]\n';
}
const out: string[] = [];
for await (const d of parseSSEStream(chunks())) out.push(d);
assert.deepEqual(out, ['大白话', '解读']);

console.log('llm.check.ts: OK');
