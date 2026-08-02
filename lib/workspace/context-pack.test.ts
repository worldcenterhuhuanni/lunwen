import { describe, expect, it } from 'vitest';
import type { WorkspaceFile } from './types';
import { buildContextPackFromFiles } from './context-pack';

function file(path: string, content: string): WorkspaceFile {
  return {
    workspaceId: 'test',
    path,
    content,
    size: content.length,
    language: path.split('.').at(-1) ?? 'text',
    fingerprint: path,
  };
}

const files = [
  file('README.md', '# Demo\n项目说明'),
  file('package.json', '{"scripts":{"dev":"vite"},"dependencies":{"react":"latest"}}'),
  file('src/index.ts', 'import { createServer } from "./server";\ncreateServer();'),
  file('src/server.ts', 'export function createServer() { return "server"; }'),
  file('src/payments.ts', 'export function reconcilePayment() { return "payment"; }'),
  file('tests/server.test.ts', 'test("server", () => createServer())'),
  file('docs/history.md', '很长的历史记录'.repeat(2_000)),
];

describe('workspace context pack', () => {
  it('prioritizes manifests and entrypoints for broad analysis', async () => {
    const pack = await buildContextPackFromFiles(files, { maxChars: 4_000 });

    expect(pack.includedPaths).toContain('package.json');
    expect(pack.includedPaths).toContain('src/index.ts');
    expect(pack.content.length).toBeLessThanOrEqual(4_000);
    expect(pack.content).toContain('src/payments.ts');
  });

  it('prioritizes files matching a follow-up question', async () => {
    const pack = await buildContextPackFromFiles(files, {
      maxChars: 1_600,
      query: '支付 reconcilePayment 是怎么实现的？',
    });

    expect(pack.includedPaths[0]).toBe('src/payments.ts');
    expect(pack.content.length).toBeLessThanOrEqual(1_600);
    expect(pack.content).toContain('reconcilePayment');
  });
});
