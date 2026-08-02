import type { WorkspaceCandidate } from '../../workspace/types';

function field(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.subarray(start, start + length)).replace(/\0.*$/, '').trim();
}

function octal(value: string): number {
  const parsed = Number.parseInt(value.replace(/\0/g, '').trim() || '0', 8);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseTar(bytes: Uint8Array): WorkspaceCandidate[] {
  const files: WorkspaceCandidate[] = [];
  let offset = 0;
  let rootPrefix: string | null = null;
  let pendingLongName = '';
  let pendingPaxPath = '';
  while (offset + 512 <= bytes.length) {
    const header = bytes.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = field(header, 0, 100);
    const prefix = field(header, 345, 155);
    const size = octal(field(header, 124, 12));
    const type = String.fromCharCode(header[156] || 48);
    const rawPath = pendingLongName || pendingPaxPath || [prefix, name].filter(Boolean).join('/');
    pendingLongName = '';
    pendingPaxPath = '';
    const bodyStart = offset + 512;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > bytes.length) throw new Error('GitHub 归档内容不完整。');

    if (type === 'L') {
      pendingLongName = new TextDecoder().decode(bytes.subarray(bodyStart, bodyEnd)).replace(/\0.*$/, '');
    } else if (type === 'x') {
      const pax = new TextDecoder().decode(bytes.subarray(bodyStart, bodyEnd));
      pendingPaxPath = pax.match(/(?:^|\n)\d+ path=([^\n]+)/)?.[1] ?? '';
    } else if (type === '0' || type === '\0') {
      const firstSlash = rawPath.indexOf('/');
      if (rootPrefix == null && firstSlash >= 0) rootPrefix = rawPath.slice(0, firstSlash + 1);
      const path = rootPrefix && rawPath.startsWith(rootPrefix) ? rawPath.slice(rootPrefix.length) : rawPath;
      if (path) {
        files.push({
          path,
          content: new TextDecoder('utf-8', { fatal: false }).decode(bytes.subarray(bodyStart, bodyEnd)),
          size,
        });
      }
    }
    offset = bodyStart + Math.ceil(size / 512) * 512;
  }
  return files;
}
