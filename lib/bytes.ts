// ArrayBuffer ↔ Base64:chrome.runtime Port 对嵌套 ArrayBuffer 结构化克隆不可靠,
// 会变成普通对象,new File([obj]) → 内容变成 "[object Object]"(恰好 15 字节)。
// 因此跨扩展页/content script 传 PDF 一律走 Base64。

export function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

export function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/** 校验是否像真正的 PDF(魔数 %PDF + 最小体积)。 */
export function assertPdfBytes(data: ArrayBuffer, label = 'PDF'): void {
  if (data.byteLength < 1024) {
    throw new Error(`${label} 过小(${data.byteLength}B),不是有效论文文件。`);
  }
  const head = new TextDecoder('latin1').decode(data.slice(0, 5));
  if (head !== '%PDF-') {
    throw new Error(`${label} 不是合法 PDF(文件头=${JSON.stringify(head)})。可能下到了网页/反爬页。`);
  }
}
