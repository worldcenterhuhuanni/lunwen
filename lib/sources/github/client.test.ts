import { describe, expect, it } from 'vitest';
import { parseGitHubRepoUrl } from './client';

describe('parseGitHubRepoUrl', () => {
  it('parses canonical and shorthand repository URLs', () => {
    expect(parseGitHubRepoUrl('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
    expect(parseGitHubRepoUrl('github.com/owner/repo.git/tree/main')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('rejects non-GitHub and incomplete URLs', () => {
    expect(() => parseGitHubRepoUrl('https://gitlab.com/owner/repo')).toThrow('只支持 github.com');
    expect(() => parseGitHubRepoUrl('https://github.com/owner')).toThrow('owner/repo');
  });
});
