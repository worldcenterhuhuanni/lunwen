// 配置读写:基于 WXT 的 storage helper,统一存 chrome.storage.local。
import { storage } from '#imports';
import { type AppConfig, DEFAULT_CONFIG } from './config';
import type { PromptTemplate } from './prompt-templates';

export const configItem = storage.defineItem<AppConfig>('local:config', {
  fallback: DEFAULT_CONFIG,
});

/** 读取时合并默认值，相当于无损迁移旧版本缺失字段。 */
export const getConfig = async (): Promise<AppConfig> => ({
  ...DEFAULT_CONFIG,
  ...(await configItem.getValue()),
});
export const setConfig = (c: AppConfig) => configItem.setValue(c);
export const watchConfig = (cb: (c: AppConfig) => void) =>
  configItem.watch((value) => cb({ ...DEFAULT_CONFIG, ...value }));

/** 仅保存用户模板；内置专业模板随扩展代码发布，不占本地存储。 */
export const promptTemplatesItem = storage.defineItem<PromptTemplate[]>('local:promptTemplates', {
  fallback: [],
});

export const getPromptTemplates = () => promptTemplatesItem.getValue();
export const setPromptTemplates = (templates: PromptTemplate[]) =>
  promptTemplatesItem.setValue(templates);
export const watchPromptTemplates = (cb: (templates: PromptTemplate[]) => void) =>
  promptTemplatesItem.watch(cb);
