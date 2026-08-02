// 模型 provider 预设与应用配置类型。
// 核心思想:DeepSeek/OpenAI/Gemini/LiteLLM 都兼容 OpenAI Chat Completions,
// 统一层只需切换 baseURL + apiKey + model 三个值,无需任何 provider SDK。

export type ProviderId = 'deepseek-web' | 'deepseek' | 'openai' | 'gemini' | 'custom';

export interface ProviderPreset {
  id: ProviderId;
  label: string;
  baseURL: string; // custom 留空由用户填写(可指向 litellm proxy);网页模式忽略
  models: string[]; // 建议模型,UI 中仍允许自由输入
  /** 走已登录的 chat.deepseek.com DOM 桥接,无需 API Key */
  webBridge?: boolean;
}

export const PROVIDERS: ProviderPreset[] = [
  {
    id: 'deepseek-web',
    label: 'DeepSeek 网页（已登录）',
    baseURL: '',
    models: [],
    webBridge: true,
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    baseURL: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o'],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  },
  {
    id: 'custom',
    label: '自定义 / LiteLLM',
    baseURL: '',
    models: [],
  },
];

export function isWebBridgeProvider(id: ProviderId): boolean {
  return Boolean(getPreset(id).webBridge);
}

export function getPreset(id: ProviderId): ProviderPreset {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export interface AppConfig {
  provider: ProviderId;
  baseURL: string;
  apiKey: string;
  model: string;
  maxContextChars: number; // HTML/API 文本摘取上限
  /** PDF / HTML 各自的本地默认提示词模板 */
  defaultPdfTemplateId: string;
  defaultHtmlTemplateId: string;
  defaultGithubTemplateId: string;
  defaultLocalTemplateId: string;
  /** 项目索引硬上限；达到总量上限时停止而不是静默截断。 */
  maxProjectFiles: number;
  maxProjectFileBytes: number;
  maxProjectTotalBytes: number;
  maxProjectArchiveBytes: number;
  projectIgnorePatterns: string[];
  /**
   * DeepSeek 网页会话策略:
   * - single: 每次回答都新开会话(互不污染)
   * - multi: 同一篇材料在同一会话里多轮追问
   */
  webSessionMode: 'single' | 'multi';
  /**
   * 独立大窗口模式。
   * false(默认):设置走系统 options 页，放大阅读留在侧栏内。
   * true:设置与放大阅读均打开居中独立大窗。
   */
  preferLargeWindows: boolean;
  /**
   * 网页模式下是否自动跳转/聚焦到 DeepSeek 标签页。
   * true(默认):解读时切到 DeepSeek；false:后台桥接，不抢焦点。
   */
  autoFocusDeepSeek: boolean;
}

export const DEFAULT_CONFIG: AppConfig = {
  provider: 'deepseek-web',
  baseURL: '',
  apiKey: '',
  model: '',
  maxContextChars: 48000,
  defaultPdfTemplateId: 'builtin:research-review',
  defaultHtmlTemplateId: 'builtin:research-review',
  defaultGithubTemplateId: 'builtin:project-guide',
  defaultLocalTemplateId: 'builtin:local-workspace',
  maxProjectFiles: 5000,
  maxProjectFileBytes: 1024 * 1024,
  maxProjectTotalBytes: 20 * 1024 * 1024,
  maxProjectArchiveBytes: 80 * 1024 * 1024,
  projectIgnorePatterns: [],
  webSessionMode: 'single',
  preferLargeWindows: false,
  autoFocusDeepSeek: true,
};
