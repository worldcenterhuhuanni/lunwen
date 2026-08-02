// 材料预处理只负责智能摘取；提示词正文已迁移到本地模板系统 prompt-templates.ts。

/**
 * HTML / 文本线:长文智能摘取(头+中+尾),保留摘要倾向与文末结论倾向。
 * 不是「只砍前 N 字」。
 */
export function smartExcerpt(text: string, maxChars: number): { text: string; note: string } {
  const raw = text.trim();
  if (raw.length <= maxChars) return { text: raw, note: '' };

  const headBudget = Math.floor(maxChars * 0.55);
  const midBudget = Math.floor(maxChars * 0.2);
  const tailBudget = Math.max(0, maxChars - headBudget - midBudget);

  const head = raw.slice(0, headBudget);
  const midStart = Math.max(0, Math.floor(raw.length / 2 - midBudget / 2));
  const mid = raw.slice(midStart, midStart + midBudget);
  const tail = raw.slice(-tailBudget);

  return {
    text: `${head}\n\n……\n\n${mid}\n\n……\n\n${tail}`,
    note: '\n\n【注:网页正文较长,已智能摘取开头、中段与结尾关键部分(非全文)。若需完整论文,请改用 PDF 线上传/打开 PDF。】',
  };
}
