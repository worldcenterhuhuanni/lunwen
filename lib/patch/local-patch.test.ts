import { describe, expect, it } from 'vitest';
import { fingerprintText } from '../workspace/filters';
import { assertUnchangedContent } from './local-patch';

describe('local patch conflict protection', () => {
  it('accepts the original content fingerprint', async () => {
    const fingerprint = await fingerprintText('const value = 1;\n');
    await expect(assertUnchangedContent('const value = 1;\n', fingerprint)).resolves.toBeUndefined();
  });

  it('rejects content changed after diff generation', async () => {
    const fingerprint = await fingerprintText('const value = 1;\n');
    await expect(assertUnchangedContent('const value = 2;\n', fingerprint)).rejects.toThrow('已变化');
  });
});
