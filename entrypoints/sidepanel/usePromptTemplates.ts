import { useEffect, useState } from 'react';
import type { PromptTemplate } from '@/lib/prompt-templates';
import { getPromptTemplates, watchPromptTemplates } from '@/lib/storage';

/** 订阅浏览器本地模板库，设置页保存后侧栏即时更新。 */
export function usePromptTemplates() {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);

  useEffect(() => {
    getPromptTemplates().then(setTemplates);
    return watchPromptTemplates(setTemplates);
  }, []);

  return templates;
}
