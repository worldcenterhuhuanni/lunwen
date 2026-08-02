// 面向 LLM 流式输出的完整 Markdown 渲染。
// XMarkdown 基于 marked，默认经过 DOMPurify，不使用原始 HTML 注入。
import { XMarkdown } from '@ant-design/x-markdown';
import '@ant-design/x-markdown/es/XMarkdown/index.css';

export function MarkdownLite({
  text,
  streaming = false,
}: {
  text: string;
  streaming?: boolean;
}) {
  return (
    <XMarkdown
      content={text}
      rootClassName="literary-markdown"
      openLinksInNewTab
      escapeRawHtml
      streaming={{
        hasNextChunk: streaming,
        enableAnimation: streaming,
        animationConfig: { fadeDuration: 180 },
        tail: streaming ? { content: '▋' } : false,
      }}
    />
  );
}
