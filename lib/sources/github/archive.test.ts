import { describe, expect, it } from 'vitest';
import { parseTar } from './archive';

function tarFile(path: string, content: string): Uint8Array {
  const body = new TextEncoder().encode(content);
  const total = 512 + Math.ceil(body.length / 512) * 512 + 1024;
  const bytes = new Uint8Array(total);
  bytes.set(new TextEncoder().encode(path), 0);
  bytes.set(new TextEncoder().encode(body.length.toString(8).padStart(11, '0') + '\0'), 124);
  bytes[156] = '0'.charCodeAt(0);
  bytes.set(body, 512);
  return bytes;
}

describe('parseTar', () => {
  it('extracts regular files and removes GitHub archive root', () => {
    expect(parseTar(tarFile('owner-repo-sha/src/main.ts', 'export const ok = true;'))).toEqual([
      {
        path: 'src/main.ts',
        content: 'export const ok = true;',
        size: 23,
      },
    ]);
  });

  it('rejects truncated entry bodies', () => {
    const bytes = tarFile('owner-repo/a.ts', 'hello').slice(0, 513);
    expect(() => parseTar(bytes)).toThrow('不完整');
  });
});
