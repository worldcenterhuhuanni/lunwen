// 侧栏分析状态机：status × mode × provider 决定走网页桥接、API Agent 还是网页直答三条路径之一。
// 视图只负责渲染和触发动作，全部流程状态集中在这里。
import { useCallback, useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { type AppConfig, DEFAULT_CONFIG, isWebBridgeProvider } from '@/lib/config';
import { getConfig, watchConfig } from '@/lib/storage';
import { streamChat, type ChatMessage } from '@/lib/llm';
import {
  renderPromptTemplate,
  resolveFollowupTemplate,
  resolveTemplate,
  type PromptTemplate,
} from '@/lib/prompt-templates';
import { type Paper, extractFromPlainText } from '@/lib/extract';
import type { AnalysisMode, Material } from '@/lib/material/types';
import { importGitHubRepository } from '@/lib/sources/github/client';
import { reindexLocalWorkspace } from '@/lib/sources/local/client';
import { runProjectAgent, type ProjectAgentCallbacks } from '@/lib/agent/runtime';
import { runWebGitHubAnalysis } from '@/lib/agent/web-project';
import { applyCandidatePatch, type CandidatePatch } from '@/lib/patch/local-patch';
import { throwIfAborted } from '@/lib/abort';
import { openParallelReader, openPatchReviewWindow } from '@/lib/extension-windows';
import { putDocument } from '@/lib/session/document-store';
import { saveSession, deleteSession, listSessions } from '@/lib/session/store';
import { stripAttachment, type StoredSession, type Turn } from '@/lib/session/types';
import { getWorkspace, deleteWorkspace } from '@/lib/workspace/store';
import { takePendingCapture, watchPendingCapture, type PendingCapture } from '@/lib/capture';
import { usePromptTemplates } from './usePromptTemplates';
import { DEMO_EXPLANATION, DEMO_PAPER } from './demo';

export type Status = 'idle' | 'extracting' | 'streaming';
export type ToolTrace = {
  id: string;
  name: string;
  status: 'running' | 'done' | 'error';
  args?: unknown;
  result?: unknown;
};

export function useAnalysis() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [cfgLoaded, setCfgLoaded] = useState(false);
  const [mode, setMode] = useState<AnalysisMode>('paper');
  const [paper, setPaper] = useState<Material | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState('auto');
  const [toolTrace, setToolTrace] = useState<ToolTrace[]>([]);
  const [patches, setPatches] = useState<CandidatePatch[]>([]);
  const [applyingPatchId, setApplyingPatchId] = useState<string | null>(null);
  /** 从历史恢复的 PDF 会话只剩文件名，网页模式追问时需要用户重新选文件。 */
  const [restoredPdfName, setRestoredPdfName] = useState<string | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);

  const abortRef = useRef<AbortController | null>(null);
  const patchesRef = useRef<CandidatePatch[]>([]);
  const paperRef = useRef<Material | null>(null);
  /** 锁定本篇材料首次使用的模板，追问期间不因全局配置变化而漂移。 */
  const activeTemplateRef = useRef<PromptTemplate | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const statusRef = useRef<Status>('idle');

  const customTemplates = usePromptTemplates();

  useEffect(() => {
    getConfig().then((value) => {
      setCfg(value);
      setCfgLoaded(true);
    });
    return watchConfig(setCfg);
  }, []);

  useEffect(() => {
    patchesRef.current = patches;
  }, [patches]);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const busy = status !== 'idle';
  const webMode = isWebBridgeProvider(cfg.provider);
  const multiSession = webMode && (cfg.webSessionMode ?? 'single') === 'multi';
  const configured = webMode || Boolean(cfg.baseURL && cfg.apiKey);

  /**
   * 请求落盘。不能在这里直接读 turns：setTurns 的 updater 是异步执行的，
   * 同步读会拿到上一轮的快照。改成打一个计数，等 React 完成这批更新后再写。
   */
  const [persistTick, setPersistTick] = useState(0);
  const requestPersist = useCallback(() => setPersistTick((value) => value + 1), []);

  useEffect(() => {
    if (!persistTick) return;
    // 依赖只列 persistTick：此处的 turns 是与该 tick 同批更新后的最新值。
    const material = paperRef.current;
    const id = sessionIdRef.current;
    if (!material || !id) return;
    if (!turns.some((turn) => turn.role === 'assistant' && turn.content)) return;
    void saveSession({
      id,
      updatedAt: Date.now(),
      material: stripAttachment(material),
      turns,
      templateId: activeTemplateRef.current?.id ?? selectedTemplateId,
      workspaceId: material.workspaceId,
    })
      .then(() => setHistoryVersion((value) => value + 1))
      .catch((e) => console.error('保存解读历史失败', e));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [persistTick]);

  /** 载入新材料：换一条会话记录，清空上一篇的痕迹。 */
  const startMaterial = useCallback(
    (material: Material | null) => {
      setPaper(material);
      paperRef.current = material;
      sessionIdRef.current = material ? crypto.randomUUID() : null;
      setRestoredPdfName(null);
      setTurns([]);
      setToolTrace([]);
      setPatches([]);
    },
    [],
  );

  function switchMode(next: AnalysisMode) {
    if (busy || next === mode) return;
    setMode(next);
    startMaterial(null);
    activeTemplateRef.current = null;
    setError(null);
    setProgress(null);
    setSelectedTemplateId('auto');
  }

  const projectLimits = {
    maxFiles: cfg.maxProjectFiles,
    maxFileBytes: cfg.maxProjectFileBytes,
    maxTotalBytes: cfg.maxProjectTotalBytes,
    maxArchiveBytes: cfg.maxProjectArchiveBytes,
    ignorePatterns: cfg.projectIgnorePatterns,
  };

  function projectDefaultTemplate(project: Material): string {
    return project.mode === 'github' ? cfg.defaultGithubTemplateId : cfg.defaultLocalTemplateId;
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
    const directWebAnalysis = webMode && project.mode === 'github';
    setProgress(directWebAnalysis ? '正在构建源码上下文…' : 'Agent 正在检查项目结构…');
    setError(null);
    setTurns((current) => [...current, { role: 'assistant', content: '' }]);
    const ac = taskController ?? new AbortController();
    abortRef.current = ac;
    let acc = '';
    const showAnswer = (content: string) => {
      acc = content;
      setProgress(null);
      setTurns((current) => {
        const next = [...current];
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
          setToolTrace((current) =>
            [
              ...current,
              {
                id: crypto.randomUUID(),
                name: `源码上下文 ${includedFiles}/${totalFiles} 文件 · ${Math.round(chars / 1024)}KB`,
                status: 'done' as const,
              },
            ].slice(-12),
          );
        },
        onPatch: (patch) => {
          setPatches((current) => [...current.filter((item) => item.path !== patch.path), patch]);
          if (cfg.preferLargeWindows) {
            void openPatchReviewWindow(patch).catch((e) => setError((e as Error).message));
          }
        },
        onTool: (event) => {
          setProgress(event.status === 'running' ? `正在执行 ${event.name}…` : null);
          setToolTrace((current) => {
            if (event.status === 'running') {
              return [...current, { ...event, status: 'running' as const }].slice(-12);
            }
            // 按工具调用 id 配对，并行执行时不会错位。
            const index = current.findIndex((item) => item.id === event.id);
            if (index < 0) return [...current, event].slice(-12);
            const next = [...current];
            next[index] = { ...next[index], status: event.status, result: event.result };
            return next;
          });
        },
      };
      if (directWebAnalysis) {
        await runWebGitHubAnalysis(cfg, project.workspaceId, rendered.system, rendered.user, callbacks, {
          query: question,
          newChat: !question || cfg.webSessionMode !== 'multi',
        });
      } else {
        await runProjectAgent(cfg, project.workspaceId, rendered.system, rendered.user, callbacks);
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setTurns((current) => (current.at(-1)?.content ? current : current.slice(0, -1)));
      setStatus('idle');
      setProgress(null);
      if (abortRef.current === ac) abortRef.current = null;
      requestPersist();
    }
  }

  async function importProject(getMaterial: (signal: AbortSignal) => Promise<Material>) {
    if (!configured) {
      setError('请先在设置里配置可用模型服务。');
      return;
    }
    setStatus('extracting');
    setError(null);
    startMaterial(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const project = await getMaterial(ac.signal);
      throwIfAborted(ac.signal);
      startMaterial(project);
      await analyzeProject(project, undefined, ac);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      setStatus('idle');
      setProgress(null);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  async function streamInto(messages: ChatMessage[], opts?: { file?: Paper['pdf']; newChat?: boolean }) {
    setStatus('streaming');
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    setTurns((current) => [...current, { role: 'assistant', content: '' }]);
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
        setTurns((current) => {
          const next = [...current];
          next[next.length - 1] = { role: 'assistant', content: acc };
          return next;
        });
      }
      if (!acc) throw new Error('模型没有返回内容,请检查是否登录或额度。');
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      // 无论中断还是报错，都要移除没拿到内容的占位气泡，否则界面上留一个永远转的「思考中」。
      setTurns((current) => (current.at(-1)?.content ? current : current.slice(0, -1)));
      setStatus('idle');
      setProgress(null);
      abortRef.current = null;
      requestPersist();
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
    startMaterial(null);
    activeTemplateRef.current = null;
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

      startMaterial(p);

      const defaultId = p.kind === 'pdf' ? cfg.defaultPdfTemplateId : cfg.defaultHtmlTemplateId;
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

  function ask(question: string) {
    const q = question.trim();
    const p = paperRef.current;
    if (!q || busy || !p) return;

    // 从历史恢复的 PDF 会话没有附件字节，网页模式下不能发一个缺附件的请求充数。
    if (p.mode === 'paper' && p.kind === 'pdf' && webMode && !p.pdf) {
      setError(
        `这是从历史恢复的会话，${restoredPdfName ? `「${restoredPdfName}」` : '原 PDF'}需要重新上传后才能继续追问。`,
      );
      return;
    }

    setTurns((current) => [...current, { role: 'user', content: q }]);

    if (p.mode !== 'paper') {
      void analyzeProject(p, q);
      return;
    }

    // 多轮:同一 DeepSeek 会话里只发追问,不再传 PDF
    if (multiSession) {
      void streamInto([{ role: 'user', content: q }], { newChat: false });
      return;
    }

    // 单轮:每次新会话,重新带上材料
    const hasAttachment = webMode && p.kind === 'pdf' && Boolean(p.pdf);
    const template = resolveFollowupTemplate(
      customTemplates,
      activeTemplateRef.current,
      selectedTemplateId,
      p.kind,
      { pdf: cfg.defaultPdfTemplateId, html: cfg.defaultHtmlTemplateId },
    );
    const rendered = renderPromptTemplate(template, p, {
      maxChars: cfg.maxContextChars,
      hasAttachment,
      question: q,
    });

    void streamInto(
      [
        { role: 'system', content: rendered.system },
        { role: 'user', content: rendered.user },
      ],
      { file: hasAttachment ? p.pdf : undefined, newChat: true },
    );
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
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      return { ok: false, error: message };
    } finally {
      setApplyingPatchId(null);
    }
  }

  const rejectPatch = (id: string) =>
    setPatches((current) => current.filter((item) => item.id !== id));

  // 放大阅读窗口里的确认/拒绝结果回传到侧栏。
  useEffect(() => {
    const onMessage = (message: unknown) => {
      const value = message as { type?: string; patchId?: string; accepted?: boolean };
      if (value.type !== 'local-patch-decision' || !value.patchId) return undefined;
      const patch = patchesRef.current.find((item) => item.id === value.patchId);
      if (!patch) return Promise.resolve({ ok: false, error: '候选修改已失效。' });
      if (!value.accepted) {
        rejectPatch(patch.id);
        return Promise.resolve({ ok: true });
      }
      return confirmPatch(patch);
    };
    browser.runtime.onMessage.addListener(onMessage);
    return () => browser.runtime.onMessage.removeListener(onMessage);
  }, []);

  // ── 历史 ────────────────────────────────────────────────

  /** 恢复一条历史会话：只载入已生成的内容，不重新请求模型。 */
  function restoreSession(session: StoredSession) {
    if (busy) return;
    const material = session.material as Material;
    setMode(material.mode);
    setPaper(material);
    paperRef.current = material;
    sessionIdRef.current = session.id;
    setRestoredPdfName(session.material.pdf?.name ?? null);
    setTurns(() => session.turns);
    setToolTrace([]);
    setPatches([]);
    setError(null);
    setProgress(null);
    setSelectedTemplateId(session.templateId || 'auto');
    activeTemplateRef.current = null;
  }

  async function removeSession(session: StoredSession) {
    await deleteSession(session.id);
    if (sessionIdRef.current === session.id) startMaterial(null);
    setHistoryVersion((value) => value + 1);
  }

  /** 删除工作区索引：连带清掉它的文件行与引用它的历史会话。 */
  async function removeWorkspace(workspaceId: string) {
    await deleteWorkspace(workspaceId);
    if (paperRef.current?.workspaceId === workspaceId) startMaterial(null);
    setHistoryVersion((value) => value + 1);
  }

  /** 复用一个仍在库里的项目索引，直接进入分析，不重新下载或扫描。 */
  async function reuseWorkspace(workspaceId: string) {
    if (busy) return;
    setError(null);
    const record = await getWorkspace(workspaceId);
    if (!record) {
      setError('该索引已被删除，请重新导入。');
      setHistoryVersion((value) => value + 1);
      return;
    }
    const material: Material = {
      mode: record.mode,
      kind: record.mode,
      title: record.title,
      source: record.source,
      text: `${record.title} 已有文件级本地索引。`,
      workspaceId: record.id,
      version: record.version,
      stats: record.stats,
      writable: record.writable,
    };
    setMode(record.mode);
    startMaterial(material);
    await analyzeProject(material);
  }

  /** 重新索引本地工作区：必须由按钮点击触发，目录权限只在用户手势里能重新申请。 */
  async function reindexLocal(workspaceId: string) {
    if (busy) return;
    setStatus('extracting');
    setError(null);
    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const material = await reindexLocalWorkspace(
        workspaceId,
        projectLimits,
        setProgress,
        ac.signal,
      );
      throwIfAborted(ac.signal);
      setMode('local');
      startMaterial(material);
      setStatus('idle');
      setProgress(null);
      setHistoryVersion((value) => value + 1);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
      setStatus('idle');
      setProgress(null);
    } finally {
      if (abortRef.current === ac) abortRef.current = null;
    }
  }

  // ── 划词解读 ─────────────────────────────────────────────

  const captureRef = useRef<(capture: PendingCapture) => void>(() => {});
  captureRef.current = (capture: PendingCapture) => {
    if (statusRef.current !== 'idle') {
      setError('当前还有分析在进行，划词解读已忽略。等这次结束后再试。');
      return;
    }
    setMode('paper');
    setSelectedTemplateId('auto');
    activeTemplateRef.current = null;
    void readWith(async () =>
      extractFromPlainText(capture.text, { source: capture.source, title: capture.title }),
    );
  };

  // 冷启动只做一件事：有划词就解读划词，否则恢复最近一次会话。两者不能互相覆盖。
  useEffect(() => {
    // 等配置就绪再消费，否则可能用默认 provider 走错模型通路。
    if (!cfgLoaded) return;
    let cancelled = false;
    const consume = () => {
      void takePendingCapture().then((capture) => {
        if (capture && !cancelled) captureRef.current(capture);
      });
    };

    void takePendingCapture()
      .then(async (capture) => {
        if (cancelled) return;
        if (capture) {
          captureRef.current(capture);
          return;
        }
        const rows = await listSessions();
        if (cancelled || paperRef.current || !rows[0]) return;
        restoreSession(rows[0]);
      })
      .catch((e) => console.error('恢复上次会话失败', e));

    const unwatch = watchPendingCapture((value) => {
      if (value) consume();
    });
    return () => {
      cancelled = true;
      unwatch();
    };
  }, [cfgLoaded]);

  /**
   * 进入原文对照视图。
   * 打开前先把会话和原文字节落盘 —— 对照页是独立页面，只能从库里读，读不到就只能空手。
   */
  async function openParallelReading(): Promise<boolean> {
    const material = paperRef.current;
    const id = sessionIdRef.current;
    if (!material || !id) return false;
    try {
      await saveSession({
        id,
        updatedAt: Date.now(),
        material: stripAttachment(material),
        turns,
        templateId: activeTemplateRef.current?.id ?? selectedTemplateId,
        workspaceId: material.workspaceId,
      });
      if (material.pdf) {
        await putDocument({
          sessionId: id,
          name: material.pdf.name,
          mime: material.pdf.mime,
          data: material.pdf.data,
          updatedAt: Date.now(),
        });
      }
      await openParallelReader(id, cfg.preferLargeWindows);
      setHistoryVersion((value) => value + 1);
      return true;
    } catch (e) {
      setError((e as Error).message || '无法打开对照阅读。');
      return false;
    }
  }

  /** 示例解读只用于首次上手，不进历史。 */
  function loadDemo() {
    setError(null);
    setStatus('idle');
    setProgress(null);
    setPaper(DEMO_PAPER);
    paperRef.current = DEMO_PAPER;
    sessionIdRef.current = null;
    setTurns(() => [{ role: 'assistant', content: DEMO_EXPLANATION }]);
  }

  return {
    cfg,
    mode,
    paper,
    turns,
    status,
    busy,
    progress,
    error,
    toolTrace,
    patches,
    applyingPatchId,
    selectedTemplateId,
    configured,
    webMode,
    multiSession,
    historyVersion,
    customTemplates,
    setSelectedTemplateId,
    setError,
    setProgress,
    switchMode,
    readWith,
    importProject,
    projectLimits,
    ask,
    stopCurrentTask,
    confirmPatch,
    rejectPatch,
    restoreSession,
    removeSession,
    removeWorkspace,
    reuseWorkspace,
    reindexLocal,
    openParallelReading,
    loadDemo,
  };
}
