import { useEffect, useMemo, useState } from 'react';
import type { AppConfig } from '@/lib/config';
import { streamChat } from '@/lib/llm';
import {
  BUILTIN_TEMPLATES,
  DEFAULT_TEMPLATE_ID,
  TEMPLATE_VARIABLES,
  allTemplates,
  buildTemplateGenerationPrompt,
  createCustomTemplate,
  parseGeneratedTemplate,
  renderPromptTemplate,
  type PromptTemplate,
  type TemplateScope,
  validateTemplate,
} from '@/lib/prompt-templates';
import {
  getPromptTemplates,
  setPromptTemplates,
  watchPromptTemplates,
} from '@/lib/storage';

interface Props {
  config: AppConfig;
  patchConfig: (patch: Partial<AppConfig>) => void;
}

const PREVIEW_PAPER = {
  mode: 'paper' as const,
  kind: 'html' as const,
  title: '示例：一种更可靠的论文分析方法',
  source: 'https://example.org/paper',
  text: '本文提出一种新方法，并在三个数据集上与强基线比较。实验显示主要指标提高 8%，但尚未进行外部验证。',
};

const PREVIEW_PROJECT = {
  mode: 'github' as const,
  kind: 'github' as const,
  title: 'example/repository',
  source: 'https://github.com/example/repository',
  text: '项目源码已建立文件级索引。',
  workspaceId: 'preview',
  version: 'abc1234',
  stats: {
    indexedFiles: 128,
    indexedBytes: 860_000,
    excludedFiles: 12,
    excludedBytes: 240_000,
    languages: { TypeScript: 90, CSS: 20, Markdown: 18 },
  },
};

export function PromptTemplateManager({ config, patchConfig }: Props) {
  const [custom, setCustom] = useState<PromptTemplate[]>([]);
  const [selectedId, setSelectedId] = useState(DEFAULT_TEMPLATE_ID);
  const [draft, setDraft] = useState<PromptTemplate>(BUILTIN_TEMPLATES[0]);
  const [message, setMessage] = useState<{ error?: boolean; text: string } | null>(null);
  const [goal, setGoal] = useState('');
  const [generating, setGenerating] = useState(false);

  useEffect(() => {
    getPromptTemplates().then(setCustom);
    return watchPromptTemplates(setCustom);
  }, []);

  const templates = useMemo(() => allTemplates(custom), [custom]);
  const selected = templates.find((t) => t.id === selectedId) ?? templates[0];
  const readonly = Boolean(selected?.builtin && draft.id === selected.id);

  function choose(template: PromptTemplate) {
    setSelectedId(template.id);
    setDraft({ ...template });
    setMessage(null);
  }

  function startNew(base?: PromptTemplate) {
    const next = createCustomTemplate(base);
    setSelectedId(next.id);
    setDraft(next);
    setMessage(null);
  }

  async function saveDraft() {
    const errors = validateTemplate(draft);
    if (errors.length) {
      setMessage({ error: true, text: errors.join('；') });
      return;
    }
    if (draft.builtin) {
      setMessage({ error: true, text: '内置模板不可覆盖，请先“复制并编辑”。' });
      return;
    }
    const saved = { ...draft, updatedAt: Date.now(), builtin: false };
    const next = custom.some((t) => t.id === saved.id)
      ? custom.map((t) => (t.id === saved.id ? saved : t))
      : [...custom, saved];
    await setPromptTemplates(next);
    setDraft(saved);
    setMessage({ text: '模板已保存到本地。' });
  }

  async function removeDraft() {
    if (draft.builtin) return;
    const next = custom.filter((t) => t.id !== draft.id);
    await setPromptTemplates(next);
    if (config.defaultPdfTemplateId === draft.id) {
      patchConfig({ defaultPdfTemplateId: DEFAULT_TEMPLATE_ID });
    }
    if (config.defaultHtmlTemplateId === draft.id) {
      patchConfig({ defaultHtmlTemplateId: DEFAULT_TEMPLATE_ID });
    }
    if (config.defaultGithubTemplateId === draft.id) {
      patchConfig({ defaultGithubTemplateId: 'builtin:project-guide' });
    }
    if (config.defaultLocalTemplateId === draft.id) {
      patchConfig({ defaultLocalTemplateId: 'builtin:local-workspace' });
    }
    choose(BUILTIN_TEMPLATES[0]);
    setMessage({ text: '自定义模板已删除。' });
  }

  function insertVariable(name: string) {
    setDraft((d) => ({ ...d, userPrompt: `${d.userPrompt}\n{{${name}}}` }));
  }

  async function generate() {
    if (!goal.trim()) {
      setMessage({ error: true, text: '先描述模板的读者、目标和重点。' });
      return;
    }
    setGenerating(true);
    setMessage({ text: '正在调用当前模型生成模板草稿…' });
    try {
      let raw = '';
      for await (const delta of streamChat(
        config,
        [
          {
            role: 'system',
            content: '你只负责设计材料分析提示词，并严格输出用户要求的 JSON。',
          },
          {
            role: 'user',
            content: buildTemplateGenerationPrompt(goal, draft.scope),
          },
        ],
        { newChat: true },
      )) {
        raw += delta;
      }
      const generated = parseGeneratedTemplate(raw);
      setSelectedId(generated.id);
      setDraft(generated);
      setMessage({ text: '草稿已生成。请检查变量与分析结构，确认后再保存。' });
    } catch (error) {
      setMessage({ error: true, text: (error as Error).message });
    } finally {
      setGenerating(false);
    }
  }

  let preview = '';
  try {
    const projectScope = ['github', 'local', 'project'].includes(draft.scope);
    const rendered = renderPromptTemplate(draft, projectScope ? PREVIEW_PROJECT : PREVIEW_PAPER, { maxChars: 4000 });
    preview = `SYSTEM\n${rendered.system}\n\nUSER\n${rendered.user}`;
  } catch (error) {
    preview = (error as Error).message;
  }

  return (
    <section className="template-section">
      <div className="section-heading">
        <div>
          <p className="eyebrow">本地提示词库</p>
          <h2>解读模板工作台</h2>
          <p>内置模板强调证据链与方法审查；复制后可按你的学科和读者继续优化。</p>
        </div>
        <button type="button" className="primary" onClick={() => startNew()}>
          新建模板
        </button>
      </div>

      <div className="template-defaults">
        <label>
          PDF 默认
          <select
            value={config.defaultPdfTemplateId}
            onChange={(e) => patchConfig({ defaultPdfTemplateId: e.target.value })}
          >
            {templates
              .filter((t) => t.scope !== 'html')
              .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          HTML 默认
          <select
            value={config.defaultHtmlTemplateId}
            onChange={(e) => patchConfig({ defaultHtmlTemplateId: e.target.value })}
          >
            {templates
              .filter((t) => t.scope !== 'pdf')
              .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          GitHub 默认
          <select
            value={config.defaultGithubTemplateId}
            onChange={(e) => patchConfig({ defaultGithubTemplateId: e.target.value })}
          >
            {templates
              .filter((t) => ['github', 'project', 'all'].includes(t.scope))
              .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
        <label>
          本地默认
          <select
            value={config.defaultLocalTemplateId}
            onChange={(e) => patchConfig({ defaultLocalTemplateId: e.target.value })}
          >
            {templates
              .filter((t) => ['local', 'project', 'all'].includes(t.scope))
              .map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </label>
      </div>

      <div className="template-workbench">
        <nav className="template-list" aria-label="提示词模板">
          {templates.map((template) => (
            <button
              type="button"
              key={template.id}
              className={selectedId === template.id ? 'template-card active' : 'template-card'}
              onClick={() => choose(template)}
            >
              <strong>{template.name}</strong>
              <span>{template.description}</span>
              <small>{template.builtin ? '内置' : '本地'} · {template.scope === 'both' ? 'PDF + HTML' : template.scope.toUpperCase()}</small>
            </button>
          ))}
        </nav>

        <div className="template-editor">
          <div className="editor-actions">
            {readonly ? (
              <button type="button" onClick={() => startNew(draft)}>复制并编辑</button>
            ) : (
              <>
                <button type="button" className="primary" onClick={saveDraft}>保存到本地</button>
                <button type="button" className="danger" onClick={removeDraft}>删除</button>
              </>
            )}
          </div>

          <label>
            名称
            <input
              value={draft.name}
              disabled={readonly}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            />
          </label>
          <label>
            用途说明
            <input
              value={draft.description}
              disabled={readonly}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            />
          </label>
          <label>
            适用材料
            <select
              value={draft.scope}
              disabled={readonly}
              onChange={(e) => setDraft({ ...draft, scope: e.target.value as TemplateScope })}
            >
              <option value="both">PDF + HTML</option>
              <option value="pdf">仅 PDF</option>
              <option value="html">仅 HTML</option>
              <option value="github">仅 GitHub 项目</option>
              <option value="local">仅本地工作区</option>
              <option value="project">GitHub + 本地项目</option>
              <option value="all">全部模式</option>
            </select>
          </label>
          <label>
            System Prompt
            <textarea
              rows={10}
              value={draft.systemPrompt}
              disabled={readonly}
              onChange={(e) => setDraft({ ...draft, systemPrompt: e.target.value })}
            />
          </label>
          <label>
            User Prompt
            <textarea
              rows={18}
              value={draft.userPrompt}
              disabled={readonly}
              onChange={(e) => setDraft({ ...draft, userPrompt: e.target.value })}
            />
          </label>

          {!readonly && (
            <div className="variable-row">
              <span>插入变量</span>
              {TEMPLATE_VARIABLES.map((name) => (
                <button type="button" key={name} onClick={() => insertVariable(name)}>
                  {'{{'}{name}{'}}'}
                </button>
              ))}
            </div>
          )}

          <details className="template-preview">
            <summary>查看示例渲染</summary>
            <pre>{preview}</pre>
          </details>
        </div>
      </div>

      <div className="generator">
        <div>
          <p className="eyebrow">AI 辅助起草</p>
          <h3>描述你想怎样读论文</h3>
          <p>例如：面向医学研究生，重点核查因果推断、样本偏差和临床可迁移性。</p>
        </div>
        <textarea
          rows={3}
          value={goal}
          placeholder="读者是谁？用于什么决策？最关注哪些方法或证据？"
          onChange={(e) => setGoal(e.target.value)}
        />
        <button type="button" onClick={generate} disabled={generating}>
          {generating ? '正在生成…' : '生成可编辑草稿'}
        </button>
      </div>

      {message && <div className={message.error ? 'result err' : 'result'}>{message.text}</div>}
    </section>
  );
}
