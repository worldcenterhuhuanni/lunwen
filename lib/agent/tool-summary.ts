// 工具轨迹展示用的取值：把 Agent 工具的参数和结果压成可读文本。
const MAX_RESULT_CHARS = 1500;

/** 工具结果是 { content: [{ type:'text', text }], details } 形状，取其中的文本。 */
export function summarizeToolResult(result: unknown): string {
  if (result == null) return '';
  const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
  const text = Array.isArray(content)
    ? content
        .filter((part) => part?.type === 'text')
        .map((part) => part.text ?? '')
        .join('\n')
    : typeof result === 'string'
      ? result
      : JSON.stringify(result, null, 2);
  return text.length > MAX_RESULT_CHARS ? `${text.slice(0, MAX_RESULT_CHARS)}\n…（已截断）` : text;
}

export function formatToolArgs(args: unknown): string {
  if (args == null) return '';
  if (typeof args === 'string') return args;
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}
