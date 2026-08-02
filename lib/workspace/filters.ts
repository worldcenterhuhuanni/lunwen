const BLOCKED_SEGMENTS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'vendor',
  'dist',
  'build',
  'out',
  'target',
  'coverage',
  '.next',
  '.nuxt',
  '.venv',
  'venv',
  '__pycache__',
]);

const BINARY_EXTENSIONS = new Set([
  '7z', 'a', 'avi', 'bin', 'bmp', 'class', 'dmg', 'doc', 'docx', 'eot', 'exe',
  'flac', 'gif', 'gz', 'ico', 'jar', 'jpeg', 'jpg', 'lockb', 'mov', 'mp3', 'mp4',
  'o', 'ogg', 'otf', 'pdf', 'png', 'ppt', 'pptx', 'rar', 'so', 'sqlite', 'tar',
  'ttf', 'wav', 'webm', 'webp', 'woff', 'woff2', 'xls', 'xlsx', 'zip',
]);

const SECRET_NAMES = [
  /(^|\/)\.env(?:\.|$)/i,
  /(^|\/)id_(?:rsa|dsa|ecdsa|ed25519)(?:\.|$)/i,
  /(^|\/).*(?:credential|secret).*(?:\.json|\.ya?ml|\.toml|\.ini)?$/i,
  /\.(?:pem|key|p12|pfx)$/i,
];

const SECRET_CONTENT = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[opusr]_[A-Za-z0-9_]{30,}\b/,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
];

export function normalizeWorkspacePath(path: string): string {
  const normalized = path.replaceAll('\\', '/').replace(/^\.\/+/, '').replace(/\/+/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) {
    throw new Error(`非法工作区路径：${path}`);
  }
  return normalized;
}

function matchesCustomPattern(path: string, rawPattern: string): boolean {
  const pattern = rawPattern.trim().replace(/^\/+/, '').replace(/\/+$/, '');
  if (!pattern || pattern.startsWith('#') || pattern.startsWith('!')) return false;
  if (!pattern.includes('*')) {
    return path === pattern || path.startsWith(`${pattern}/`) || path.split('/').includes(pattern);
  }
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  const regex = escaped.replaceAll('**', '\0').replaceAll('*', '[^/]*').replaceAll('\0', '.*');
  return new RegExp(`(?:^|/)${regex}(?:$|/)`).test(path);
}

export function pathExclusionReason(path: string, customPatterns: string[] = []): string | null {
  let normalized: string;
  try {
    normalized = normalizeWorkspacePath(path);
  } catch {
    return '非法路径';
  }
  const segments = normalized.toLowerCase().split('/');
  if (segments.some((part) => BLOCKED_SEGMENTS.has(part))) return '默认忽略目录';
  if (customPatterns.some((pattern) => matchesCustomPattern(normalized, pattern))) return '用户忽略规则';
  if (SECRET_NAMES.some((pattern) => pattern.test(normalized))) return '敏感文件';
  if (/\.min\.(?:js|css)$/i.test(normalized) || /\.map$/i.test(normalized)) return '生成产物';
  const ext = normalized.split('.').pop()?.toLowerCase() ?? '';
  if (BINARY_EXTENSIONS.has(ext)) return '二进制文件';
  return null;
}

export function looksBinary(content: string): boolean {
  if (content.includes('\0')) return true;
  if (!content) return false;
  const sample = content.slice(0, 8192);
  let controls = 0;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    if (code < 9 || (code > 13 && code < 32)) controls += 1;
  }
  return controls / sample.length > 0.08;
}

export function containsLikelySecret(content: string): boolean {
  const sample = content.slice(0, 200_000);
  return SECRET_CONTENT.some((pattern) => pattern.test(sample));
}

export function languageForPath(path: string): string {
  const name = path.split('/').pop()?.toLowerCase() ?? '';
  if (name === 'dockerfile') return 'Dockerfile';
  if (name === 'makefile') return 'Makefile';
  const ext = name.includes('.') ? name.split('.').pop()! : 'text';
  const names: Record<string, string> = {
    c: 'C', cc: 'C++', cpp: 'C++', cs: 'C#', css: 'CSS', go: 'Go', h: 'C/C++',
    html: 'HTML', java: 'Java', js: 'JavaScript', json: 'JSON', jsx: 'JavaScript',
    kt: 'Kotlin', md: 'Markdown', php: 'PHP', py: 'Python', rb: 'Ruby', rs: 'Rust',
    sh: 'Shell', sql: 'SQL', swift: 'Swift', toml: 'TOML', ts: 'TypeScript',
    tsx: 'TypeScript', vue: 'Vue', xml: 'XML', yaml: 'YAML', yml: 'YAML',
  };
  return names[ext] ?? ext.toUpperCase();
}

export async function fingerprintText(content: string): Promise<string> {
  const bytes = new TextEncoder().encode(content);
  if (globalThis.crypto?.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return (hash >>> 0).toString(16);
}
