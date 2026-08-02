import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { type AppConfig, DEFAULT_CONFIG, isWebBridgeProvider } from '@/lib/config';
import { getConfig, watchConfig } from '@/lib/storage';
import { streamChat, type ChatMessage } from '@/lib/llm';
import {
  renderPromptTemplate,
  resolveTemplate,
  type PromptTemplate,
} from '@/lib/prompt-templates';
import {
  type Paper,
  extractFromActiveTab,
  extractFromPdfFile,
  extractFromPlainText,
  extractFromUrl,
} from '@/lib/extract';
import type { AnalysisMode, Material } from '@/lib/material/types';
import { importGitHubRepository } from '@/lib/sources/github/client';
import {
  importLocalDirectory,
  importLocalFileList,
  supportsDirectoryPicker,
} from '@/lib/sources/local/client';
import { runProjectAgent, type ProjectAgentCallbacks } from '@/lib/agent/runtime';
import { runWebGitHubAnalysis } from '@/lib/agent/web-project';
import {
  applyCandidatePatch,
  type CandidatePatch,
} from '@/lib/patch/local-patch';
import { DEEPSEEK_CHAT_URL } from '@/lib/deepseek-web';
import { throwIfAborted } from '@/lib/abort';
import { MarkdownLite } from './MarkdownLite';
import {
  IconChevron,
  IconDownload,
  IconExpand,
  IconLink,
  IconPage,
  IconSend,
  IconSettings,
  IconStop,
  IconUpload,
} from './icons';
import {
  openPatchReviewWindow,
  openReaderWindow,
  openSettingsWindow,
} from '@/lib/extension-windows';
import { DEMO_EXPLANATION, DEMO_PAPER } from './demo';
import { TemplatePicker } from './TemplatePicker';
import { usePromptTemplates } from './usePromptTemplates';
import { MarkdownModal } from './MarkdownModal';

type Turn = { role: 'user' | 'assistant'; content: string };
type Status = 'idle' | 'extracting' | 'streaming';
type ToolTrace = { id: string; name: string; status: 'running' | 'done' | 'error' };

function ThinkingDots() {
  return (
    <div className="thinking" aria-label="思考中">
      <span />
      <span />
      <span />
    </div>
  );
}

export default function App() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [mode, setMode] = useState<AnalysisMode>('paper');
  const [url, setUrl] = useState('');
  const [paste, setPaste] = useState('');
  const [paper, setPaper] = useState<Material | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [followup, setFollowup] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('auto');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [expandedMarkdown, setExpandedMarkdown] = useState<string | null>(null);
  const [toolTrace, setToolTrace] = useState<ToolTrace[]>([]);
  const [patches, setPatches] = useState<CandidatePatch[]>([]);
  const [applyingPatchId, setApplyingPatchId] = useState<string | null>(null);
  const customTemplates = usePromptTemplates();

  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const patchesRef = useRef<CandidatePatch[]>([]);
  /** 保留当前 PDF 附件,追问时重新上传(每次新会话) */
  const paperRef = useRef<Material | null>(null);
  /** 锁定本篇材料首次使用的模板，追问期间不因全局配置变化而漂移。 */
  const activeTemplateRef = useRef<PromptTemplate | null>(null);

  useEffect(() => {
    getConfig().then(setCfg);
    return watchConfig(setCfg);
  }, []);

  useEffect(() => {
    patchesRef.current = patches;
  }, [patches]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, progress]);

  const busy = status !== 'idle';
  const configured = isWebBridgeProvider(cfg.provider) || Boolean(cfg.baseURL && cfg.apiKey);
  const openSettings = () => {
    if (cfg.preferLargeWindows) {
      void openSettingsWindow();
      return;
    }
    void browser.runtime.openOptionsPage();
  };

  const projectLimits = {
    maxFiles: cfg.maxProjectFiles,
    maxFileBytes: cfg.maxProjectFileBytes,
    maxTotalBytes: cfg.maxProjectTotalBytes,
    maxArchiveBytes: cfg.maxProjectArchiveBytes,
    ignorePatterns: cfg.projectIgnorePatterns,
  };

  function switchMode(next: AnalysisMode) {
    if (busy || next === mode) return;
    setMode(next);
    setPaper(null);
    paperRef.current = null;
    activeTemplateRef.current = null;
    setTurns([]);
    setToolTrace([]);
    setPatches([]);
    setError(null);
    setProgress(null);
    setSelectedTemplateId('auto');
  }

  function projectDefaultTemplate(project: Material): string {
    return project.mode === 'github'
      ? cfg.defaultGithubTemplateId
      : cfg.defaultLocalTemplateId;
  }

  async function analyzeProject(
    project: Material,
    question?: string,
    taskController?: AbortController,
  ) {
    if (!project.workspaceId) throw new Error('项目索引标识缺失。');
    const template = resolveTemplate(
      customTemplates,
      selectedTemplateId === 'auto' ? projectDefaultTemplate(project) : selectedTemplateId,
      project.kind,
    );
    activeTemplateRef.current = template;
    const rendered = renderPromptTemplate(template, project, {
      maxChars: cfg.maxContextChars,
      question,
    });
    setStatus('streaming');
    const directWebAnalysis = isWebBridgeProvider(cfg.provider) && project.mode === 'github';
    setProgress(directWebAnalysis ? '正在构建源码上下文…' : 'Agent 正在检查项目结构…');
    setError(null);
    setTurns((turnsNow) => [...turnsNow, { role: 'assistant', content: '' }]);
    const ac = taskController ?? new AbortController();
    abortRef.current = ac;
    let acc = '';
    const showAnswer = (content: string) => {
      acc = content;
      setProgress(null);
      setTurns((turnsNow) => {
        const next = [...turnsNow];
        next[next.length - 1] = { role: 'assistant', content };
        return next;
      });
    };
    try {
      const callbacks: ProjectAgentCallbacks = {
        signal: ac.signal,
        onText: (delta) => {
          acc += delta;
          showAnswer(acc);
        },
        onFinal: showAnswer,
        onProgress: setProgress,
        onContext: ({ includedFiles, totalFiles, chars }) => {
          const name = `源码上下文 ${includedFiles}/${totalFiles} 文件 · ${Math.round(chars / 1024)}KB`;
          const contextTrace: ToolTrace = {
            id: crypto.randomUUID(),
            name,
            status: 'done',
          };
          setToolTrace((current) => [
            ...current,
            contextTrace,
          ].slice(-12));
        },
        onPatch: (patch) => {
          setPatches((current) => [
            ...current.filter((item) => item.path !== patch.path),
            patch,
          ]);
          if (cfg.preferLargeWindows) {
            void openPatchReviewWindow(patch).catch((error) => setError((error as Error).message));
          }
        },
        onTool: (event) => {
          setProgress(event.status === 'running' ? `正在执行 ${event.name}…` : null);
          setToolTrace((current) => {
            if (event.status === 'running') {
              const running: ToolTrace = {
                id: crypto.randomUUID(),
                name: event.name,
                status: 'running',
              };
              return [...current, running].slice(-12);
            }
            const next = [...current];
            const index = next.findLastIndex((item) => item.name === event.name && item.status === 'running');
            if (index >= 0) next[index] = { ...next[index], status: event.status };
            return next;
          });
        },
      };
      if (directWebAnalysis) {
        await runWebGitHubAnalysis(
          cfg,
          project.workspaceId,
          rendered.system,
          rendered.user,
          callbacks,
          {
            query: question,
            newChat: !question || cfg.webSessionMode !== 'multi',
          },
        );
      } else {
        await runProjectAgent(
          cfg,
          project.workspaceId,
          rendered.system,
          rendered.user,
          callbacks,
        );
      }
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setError((error as Error).message);
      setTurns((turnsNow) => (turnsNow.at(-1)?.content ? turnsNow : turnsNow.slice(0, -1)));
    } finally {
      setStatus('idle');
      setProgress(null);
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  async function importProject(getMaterial: (signal: AbortSignal) => Promise<Material>) {
    if (!configured) {
      setError('请先在设置里配置可用模型服务。');
      return;
    }
    setStatus('extracting');
    setError(null);
    setPaper(null);
    setTurns([]);
    setToolTrace([]);
    setPatches([]);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const project = await getMaterial(ac.signal);
      throwIfAborted(ac.signal);
      setPaper(project);
      paperRef.current = project;
      await analyzeProject(project, undefined, ac);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') setError((error as Error).message);
      setStatus('idle');
      setProgress(null);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  function stopCurrentTask() {
    if (!abortRef.current) return;
    setProgress('正在停止…');
    abortRef.current.abort();
  }

  async function confirmPatch(patch: CandidatePatch): Promise<{ ok: boolean; error?: string }> {
    setApplyingPatchId(patch.id);
    setError(null);
    try {
      await applyCandidatePatch(patch);
      setPatches((current) => current.filter((item) => item.id !== patch.id));
      setProgress(`已写入 ${patch.path}`);
      window.setTimeout(() => setProgress(null), 2200);
      return { ok: true };
    } catch (error) {
      const message = (error as Error).message;
      setError(message);
      return { ok: false, error: message };
    } finally {
      setApplyingPatchId(null);
    }
  }

  useEffect(() => {
    const onMessage = (message: unknown) => {
      const value = message as { type?: string; patchId?: string; accepted?: boolean };
      if (value.type !== 'local-patch-decision' || !value.patchId) return undefined;
      const patch = patchesRef.current.find((item) => item.id === value.patchId);
      if (!patch) return Promise.resolve({ ok: false, error: '候选修改已失效。' });
      if (!value.accepted) {
        setPatches((current) => current.filter((item) => item.id !== patch.id));
        return Promise.resolve({ ok: true });
      }
      return confirmPatch(patch);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  async function expandReading(content: string) {
    if (!cfg.preferLargeWindows) {
      setExpandedMarkdown(content);
      return;
    }
    try {
      await openReaderWindow({
        title: paper?.title || '材料分析',
        source: paper?.source,
        content,
      });
    } catch (e) {
      setError((e as Error).message || '无法打开放大阅读窗口');
    }
  }
  const webMode = isWebBridgeProvider(cfg.provider);
  const sessionMode = cfg.webSessionMode ?? 'single';
  const multiSession = webMode && sessionMode === 'multi';

  async function streamInto(
    messages: ChatMessage[],
    opts?: { file?: Paper['pdf']; newChat?: boolean },
  ) {
    setStatus('streaming');
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setTurns((t) => [...t, { role: 'assistant', content: '' }]);
    try {
      let acc = '';
      for await (const delta of streamChat(cfg, messages, {
        signal: ac.signal,
        file: opts?.file,
        newChat: opts?.newChat,
        onProgress: setProgress,
      })) {
        acc += delta;
        setProgress(null);
        setTurns((t) => {
          const next = [...t];
          next[next.length - 1] = { role: 'assistant', content: acc };
          return next;
        });
      }
      if (!acc) throw new Error('模型没有返回内容,请检查是否登录或额度。');
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      setError((e as Error).message);
      setTurns((t) => (t[t.length - 1]?.content ? t : t.slice(0, -1)));
    } finally {
      setStatus('idle');
      setProgress(null);
      abortRef.current = null;
    }
  }

  async function readWith(getPaper: () => Promise<Paper>) {
    if (!configured) {
      setError(
        webMode
          ? '请先在设置里选择「DeepSeek 网页」,并保持 chat.deepseek.com 已登录。'
          : '请先在设置里配置模型服务和 API Key。',
      );
      return;
    }
    setStatus('extracting');
    setProgress(webMode ? '正在查找/下载 PDF…' : '正在提取正文…');
    setError(null);
    setPaper(null);
    paperRef.current = null;
    activeTemplateRef.current = null;
    setTurns([]);
    try {
      const p = await getPaper();
      const usePdfUpload = webMode && p.kind === 'pdf' && Boolean(p.pdf);
      if (!usePdfUpload && !p.text) {
        throw new Error(
          p.kind === 'pdf'
            ? '无法从该 PDF 抽出文本。请改用 DeepSeek 网页模式上传/打开 PDF。'
            : '没提取到正文内容,换个页面或链接试试。',
        );
      }

      setPaper(p);
      paperRef.current = p;

      const defaultId =
        p.kind === 'pdf' ? cfg.defaultPdfTemplateId : cfg.defaultHtmlTemplateId;
      const template = resolveTemplate(
        customTemplates,
        selectedTemplateId === 'auto' ? defaultId : selectedTemplateId,
        p.kind,
      );
      activeTemplateRef.current = template;

      const rendered = renderPromptTemplate(template, p, {
        maxChars: cfg.maxContextChars,
        hasAttachment: usePdfUpload,
      });
      const file = usePdfUpload ? p.pdf : undefined;
      if (usePdfUpload) setProgress('已拿到 PDF,准备上传到 DeepSeek…');

      // 新材料首轮:总是新开 DeepSeek 会话
      await streamInto(
        [
          { role: 'system', content: rendered.system },
          { role: 'user', content: rendered.user },
        ],
        { file, newChat: true },
      );
    } catch (e) {
      setError((e as Error).message);
      setStatus('idle');
      setProgress(null);
    }
  }

  const hasResult = Boolean(paper) && turns.some((t) => t.role === 'assistant' && t.content);

  function downloadMd() {
    if (!paper) return;
    const lines = [
      `# ${paper.title}`,
      '',
      `> 来源:${paper.source}`,
      `> 模式:${paper.mode}`,
      '> 由「材料解读助手」生成',
      '',
    ];
    for (const t of turns) {
      if (!t.content) continue;
      if (t.role === 'user') lines.push('', `## 追问:${t.content}`, '');
      else lines.push(t.content, '');
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    const href = URL.createObjectURL(blob);
    a.href = href;
    a.download = `${paper.title.replace(/[\\/:*?"<>|\n]+/g, '_').slice(0, 80).trim() || 'paper'}.md`;
    a.click();
    URL.revokeObjectURL(href);
  }

  function ask() {
    const q = followup.trim();
    const p = paperRef.current;
    if (!q || busy || !p) return;
    setFollowup('');
    setTurns((t) => [...t, { role: 'user', content: q }]);

    if (p.mode !== 'paper') {
      void analyzeProject(p, q);
      return;
    }

    // 多轮:同一 DeepSeek 会话里只发追问,不再传 PDF
    if (multiSession) {
      void streamInto(
        [{ role: 'user', content: q }],
        { newChat: false },
      );
      return;
    }

    // 单轮:每次新会话,重新带上材料
    const hasAttachment = webMode && p.kind === 'pdf' && Boolean(p.pdf);
    const template =
      activeTemplateRef.current ??
      resolveTemplate(
        customTemplates,
        p.kind === 'pdf' ? cfg.defaultPdfTemplateId : cfg.defaultHtmlTemplateId,
        p.kind,
      );
    const rendered = renderPromptTemplate(template, p, {
      maxChars: cfg.maxContextChars,
      hasAttachment,
      question: q,
    });
    const file = hasAttachment ? p.pdf : undefined;

    void streamInto(
      [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      { file, newChat: true },
    );
  }

  const webOpts = {
    skipPdfText: webMode,
    preferPdfDownload: webMode,
  } as const;

  const submitUrl = () => url.trim() && readWith(() => extractFromUrl(url.trim(), webOpts));
  const submitGithub = () => {
    if (!url.trim()) return;
    void importProject((signal) =>
      importGitHubRepository(url.trim(), projectLimits, setProgress, signal),
    );
  };
  const pickLocalDirectory = () => {
    if (supportsDirectoryPicker()) {
      void importProject((signal) => importLocalDirectory(projectLimits, setProgress, signal));
      return;
    }
    folderRef.current?.click();
  };
  const onPickFolder = (fileList: FileList | null) => {
    if (!fileList?.length) return;
    void importProject((signal) =>
      importLocalFileList(fileList, projectLimits, setProgress, signal),
    );
    if (folderRef.current) folderRef.current.value = '';
  };
  const submitPaste = () => {
    if (!paste.trim()) return;
    setPasteOpen(false);
    void readWith(async () => extractFromPlainText(paste));
  };

  function onPickPdf(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;
    void readWith(() => extractFromPdfFile(file, webOpts));
    if (fileRef.current) fileRef.current.value = '';
  }

  function loadDemo() {
    setError(null);
    setStatus('idle');
    setProgress(null);
    setPaper(DEMO_PAPER);
    paperRef.current = DEMO_PAPER;
    setTurns([{ role: 'assistant', content: DEMO_EXPLANATION }]);
  }

  return (
    <div className="app">
      <header className="masthead">
        <div className="brand">
          <span className="mark" />
          材料解读
        </div>
        <div className="masthead-actions">
          {hasResult && (
            <button className="icon-btn" title="下载为 Markdown" aria-label="下载为 Markdown" onClick={downloadMd}>
              <IconDownload />
            </button>
          )}
          <button className="icon-btn" title="设置" aria-label="设置" onClick={openSettings}>
            <IconSettings />
          </button>
        </div>
      </header>

      <nav className="mode-rail" aria-label="分析模式">
        {([
          ['paper', '论文'],
          ['github', 'GitHub 项目'],
          ['local', '本地工作区'],
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={mode === id ? 'active' : ''}
            disabled={busy}
            onClick={() => switchMode(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!configured && (
        <div className="banner warn">
          还没配置模型服务。
          <button className="link" onClick={openSettings}>
            现在去设置
          </button>
        </div>
      )}

      {configured && webMode && (
        <div className="banner warn">
          {mode === 'paper'
            ? `网页模式 · ${multiSession ? '多轮会话' : '单轮会话'}。优先下载页面 PDF 再上传。`
            : '项目 Agent 将在同一网页会话中用 JSON 协议逐步检索源码。'}
          请保持{' '}
          <a className="link" href={DEEPSEEK_CHAT_URL} target="_blank" rel="noreferrer">
            聊天页
          </a>{' '}
          已登录。
        </div>
      )}

      <div className="controls">
        <TemplatePicker
          customTemplates={customTemplates}
          mode={mode}
          value={selectedTemplateId}
          disabled={busy}
          onChange={setSelectedTemplateId}
          onManage={openSettings}
        />
        {mode === 'paper' ? (
          <>
        <button
          className="primary"
          disabled={busy}
          onClick={() => readWith(() => extractFromActiveTab(webOpts))}
        >
          <IconPage size={16} />
          {status === 'extracting' ? '正在准备…' : '解读当前页面'}
        </button>
        <div className="btn-row">
          <button className="ghost grow" disabled={busy} onClick={() => fileRef.current?.click()}>
            <IconUpload size={16} />
            上传 PDF
          </button>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => onPickPdf(e.target.files)}
          />
        </div>
        <div className="url-row">
          <span className="url-icon">
            <IconLink size={16} />
          </span>
          <input
            className="url-input"
            placeholder="粘贴链接:网页=HTML 线 / PDF 链接=PDF 线"
            value={url}
            disabled={busy}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && submitUrl()}
          />
          <button className="ghost" disabled={busy || !url.trim()} onClick={submitUrl}>
            解读
          </button>
        </div>
        <div className={pasteOpen ? 'paste-drawer open' : 'paste-drawer'}>
          <button
            type="button"
            className="paste-drawer-toggle"
            aria-expanded={pasteOpen}
            onClick={() => setPasteOpen((open) => !open)}
          >
            <span>
              <strong>粘贴文字</strong>
              <small>{paste ? `已输入 ${paste.length} 字` : '摘要、论文片段或任意材料'}</small>
            </span>
            <IconChevron size={16} />
          </button>
          {pasteOpen && (
            <div className="paste-drawer-body">
              <textarea
                className="paste-input"
                placeholder="粘贴文字后按当前模板解读…"
                value={paste}
                disabled={busy}
                rows={5}
                autoFocus
                onChange={(e) => setPaste(e.target.value)}
              />
              <div className="paste-drawer-foot">
                <span>{paste.length.toLocaleString()} 字</span>
                <button className="ghost" disabled={busy || !paste.trim()} onClick={submitPaste}>
                  解读这段
                </button>
              </div>
            </div>
          )}
        </div>
          </>
        ) : mode === 'github' ? (
          <div className="project-connect">
            <p className="connect-title">公开仓库源码</p>
            <p className="connect-hint">读取默认分支全部合规文本源码，建立本地索引后再按需检索。</p>
            <div className="url-row">
              <span className="url-icon"><IconLink size={16} /></span>
              <input
                className="url-input"
                placeholder="https://github.com/owner/repo"
                value={url}
                disabled={busy}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && submitGithub()}
              />
              <button className="ghost" disabled={busy || !url.trim()} onClick={submitGithub}>
                索引
              </button>
            </div>
          </div>
        ) : (
          <div className="project-connect">
            <p className="connect-title">授权一个本地工作区</p>
            <p className="connect-hint">
              Chrome 可在 diff 确认后写回；不支持目录句柄的浏览器将只读导入。
            </p>
            <button className="primary" disabled={busy} onClick={pickLocalDirectory}>
              <IconUpload size={16} />
              选择本地文件夹
            </button>
            <input
              ref={folderRef}
              type="file"
              hidden
              {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
              onChange={(e) => onPickFolder(e.target.files)}
            />
          </div>
        )}
      </div>

      {progress && <div className="banner warn">{progress}</div>}
      {error && <div className="banner error">{error}</div>}

      <div className="reader" ref={scrollRef}>
        {paper && (
          <div className="paper-head">
            <div className="paper-meta">
              <span className={`kind-tag kind-${paper.kind}`}>
                {paper.mode === 'paper'
                  ? paper.kind === 'pdf' ? 'PDF 线' : 'HTML 线'
                  : paper.mode === 'github' ? 'GitHub 索引' : '本地索引'}
              </span>
              {webMode && paper.kind === 'pdf' && paper.pdf ? <span className="kind-note">上传至 DeepSeek</span> : null}
              {paper.stats ? (
                <span className="kind-note">
                  {paper.stats.indexedFiles} 文件 · {(paper.stats.indexedBytes / 1024 / 1024).toFixed(1)}MB
                  {paper.stats.excludedFiles ? ` · 排除 ${paper.stats.excludedFiles}` : ''}
                </span>
              ) : null}
            </div>
            <h1 className="paper-title">{paper.title}</h1>
            {paper.source.startsWith('http') ? (
              <a className="paper-source" href={paper.source} target="_blank" rel="noreferrer">
                {paper.source}
              </a>
            ) : (
              <div className="paper-source">{paper.source}</div>
            )}
          </div>
        )}

        {paper?.mode !== 'paper' && toolTrace.length > 0 && (
          <div className="tool-trace" aria-label="项目工具轨迹">
            <span>来源轨迹</span>
            <div>
              {toolTrace.map((tool) => (
                <small key={tool.id} className={tool.status}>
                  {tool.name}
                </small>
              ))}
            </div>
          </div>
        )}

        {turns.map((t, i) => {
          const isCurrentStreaming =
            t.role === 'assistant' && status === 'streaming' && i === turns.length - 1;
          return t.role === 'assistant' ? (
            <article key={i} className="tutor">
              {t.content && !isCurrentStreaming && (
                <div className="tutor-actions">
                  <button
                    type="button"
                    title="放大阅读"
                    aria-label="放大阅读这条解读"
                    onClick={() => void expandReading(t.content)}
                  >
                    <IconExpand size={15} />
                  </button>
                </div>
              )}
              {t.content ? (
                <MarkdownLite text={t.content} streaming={isCurrentStreaming} />
              ) : (
                <ThinkingDots />
              )}
            </article>
          ) : (
            <div key={i} className="ask-bubble">
              {t.content}
            </div>
          );
        })}

        {patches.map((patch) => (
          <section className="patch-review" key={patch.id}>
            <div className="patch-head">
              <div>
                <small>候选修改 · 尚未写入</small>
                <strong>{patch.path}</strong>
              </div>
              <div>
                <button
                  className="ghost"
                  disabled={Boolean(applyingPatchId)}
                  onClick={() => setPatches((current) => current.filter((item) => item.id !== patch.id))}
                >
                  拒绝
                </button>
                <button
                  className="primary"
                  disabled={Boolean(applyingPatchId)}
                  onClick={() => void confirmPatch(patch)}
                >
                  {applyingPatchId === patch.id ? '写入中…' : '确认写入'}
                </button>
              </div>
            </div>
            <pre>{patch.diff}</pre>
          </section>
        ))}

        {!paper && status === 'idle' && (
          <div className="empty">
            <div className="empty-mark">
              <IconPage size={30} />
            </div>
            <p className="empty-title">
              {mode === 'paper' ? '把难懂的论文，读成大白话' : mode === 'github' ? '从源码理解一个项目' : '在授权目录内读写协作'}
            </p>
            <p className="empty-hint">
              {mode === 'paper'
                ? 'PDF、HTML 与粘贴文字使用论文专用方法。'
                : mode === 'github'
                  ? '索引公开仓库全部合规文本源码，再按问题检索。'
                  : '读取整个选定目录；修改必须先审阅 diff。'}
            </p>
            {mode === 'paper' && <button className="demo-btn" onClick={loadDemo}>先看一个示例解读</button>}
          </div>
        )}
      </div>

      <div className="composer">
        {(status === 'streaming' || (status === 'extracting' && mode !== 'paper')) && (
          <button className="icon-btn stop" title="停止当前任务" aria-label="停止当前任务" onClick={stopCurrentTask}>
            <IconStop size={18} />
          </button>
        )}
        <input
          className="ask-input"
          placeholder={
            paper
              ? paper.mode !== 'paper'
                ? '继续询问项目，Agent 会重新检索证据…'
                : multiSession
                ? '在同一会话里继续追问…'
                : '追问会新开会话…'
              : mode === 'paper' ? '先读一篇论文' : '先导入一个项目'
          }
          value={followup}
          disabled={!paper || busy}
          onChange={(e) => setFollowup(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && ask()}
        />
        <button
          className="icon-btn send"
          title="发送"
          aria-label="发送"
          disabled={!paper || busy || !followup.trim()}
          onClick={ask}
        >
          <IconSend size={18} />
        </button>
      </div>

      <MarkdownModal
        title={paper?.title || '材料分析'}
        source={paper?.source}
        content={expandedMarkdown}
        onClose={() => setExpandedMarkdown(null)}
      />
    </div>
  );
}
