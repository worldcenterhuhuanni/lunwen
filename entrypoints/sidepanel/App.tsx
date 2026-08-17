import { useEffect, useRef, useState } from 'react';
import { browser } from 'wxt/browser';
import { DEEPSEEK_CHAT_URL } from '@/lib/deepseek-web';
import { openReaderWindow, openSettingsWindow } from '@/lib/extension-windows';
import { MarkdownLite } from './MarkdownLite';
import { MarkdownModal } from './MarkdownModal';
import { RecentMaterials } from './RecentMaterials';
import { TemplatePicker } from './TemplatePicker';
import { ToolTrace } from './ToolTrace';
import { useAnalysis } from './useAnalysis';
import { GitHubPanel } from './panels/GitHubPanel';
import { LocalPanel } from './panels/LocalPanel';
import { PaperPanel } from './panels/PaperPanel';
import { IconDownload, IconExpand, IconPage, IconSend, IconSettings, IconStop } from './icons';

function ThinkingDots() {
  return (
    <div className="thinking" aria-label="思考中">
      <span />
      <span />
      <span />
    </div>
  );
}

/** 本地索引的 version 存的是建立时间戳，GitHub 存的是 commit sha。 */
function indexedAtLabel(version?: string): string | null {
  if (!version || !/^\d+$/.test(version)) return null;
  return new Date(Number(version)).toLocaleString();
}

export default function App() {
  const a = useAnalysis();
  const [followup, setFollowup] = useState('');
  const [expandedMarkdown, setExpandedMarkdown] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const askRef = useRef<HTMLTextAreaElement>(null);

  const { paper, turns, status, busy, cfg, webMode, multiSession } = a;

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [turns, a.progress]);

  // 追问框随内容增高，到上限后内部滚动。
  useEffect(() => {
    const el = askRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 116)}px`;
  }, [followup]);

  const openSettings = () => {
    if (cfg.preferLargeWindows) {
      void openSettingsWindow();
      return;
    }
    void browser.runtime.openOptionsPage();
  };

  async function expandReading(content: string) {
    // 论文有原文可对照，直接进对照视图；项目模式没有原文这一侧，仍是纯 Markdown 放大。
    if (paper?.mode === 'paper' && (await a.openParallelReading())) return;
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
      a.setError((e as Error).message || '无法打开放大阅读窗口');
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
    const el = document.createElement('a');
    const href = URL.createObjectURL(blob);
    el.href = href;
    el.download = `${paper.title.replace(/[\\/:*?"<>|\n]+/g, '_').slice(0, 80).trim() || 'paper'}.md`;
    el.click();
    URL.revokeObjectURL(href);
  }

  function submitAsk() {
    if (!followup.trim()) return;
    a.ask(followup);
    setFollowup('');
  }

  const indexedAt = indexedAtLabel(paper?.version);

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
        {(
          [
            ['paper', '论文'],
            ['github', 'GitHub 项目'],
            ['local', '本地工作区'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            className={a.mode === id ? 'active' : ''}
            disabled={busy}
            onClick={() => a.switchMode(id)}
          >
            {label}
          </button>
        ))}
      </nav>

      {!a.configured && (
        <div className="banner warn">
          还没配置模型服务。
          <button className="link" onClick={openSettings}>
            现在去设置
          </button>
        </div>
      )}

      {a.configured && webMode && (
        <div className="banner warn">
          {a.mode === 'paper'
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
          customTemplates={a.customTemplates}
          mode={a.mode}
          value={a.selectedTemplateId}
          disabled={busy}
          onChange={a.setSelectedTemplateId}
          onManage={openSettings}
        />
        {a.mode === 'paper' ? (
          <PaperPanel
            busy={busy}
            extracting={status === 'extracting'}
            webMode={webMode}
            readWith={(getPaper) => void a.readWith(getPaper)}
          />
        ) : a.mode === 'github' ? (
          <GitHubPanel
            busy={busy}
            limits={a.projectLimits}
            onProgress={(m) => a.setProgress(m)}
            importProject={(getMaterial) => void a.importProject(getMaterial)}
          />
        ) : (
          <LocalPanel
            busy={busy}
            limits={a.projectLimits}
            onProgress={(m) => a.setProgress(m)}
            importProject={(getMaterial) => void a.importProject(getMaterial)}
          />
        )}
        <RecentMaterials
          version={a.historyVersion}
          busy={busy}
          onRestore={a.restoreSession}
          onRemoveSession={a.removeSession}
          onReuse={(id) => void a.reuseWorkspace(id)}
          onReindex={(id) => void a.reindexLocal(id)}
          onRemoveWorkspace={a.removeWorkspace}
        />
      </div>

      {a.progress && <div className="banner warn">{a.progress}</div>}
      {a.error && <div className="banner error">{a.error}</div>}

      <div className="reader" ref={scrollRef}>
        {paper && (
          <div className="paper-head">
            <div className="paper-meta">
              <span className={`kind-tag kind-${paper.kind}`}>
                {paper.mode === 'paper'
                  ? paper.kind === 'pdf'
                    ? 'PDF 线'
                    : 'HTML 线'
                  : paper.mode === 'github'
                    ? 'GitHub 索引'
                    : '本地索引'}
              </span>
              {webMode && paper.kind === 'pdf' && paper.pdf ? (
                <span className="kind-note">上传至 DeepSeek</span>
              ) : null}
              {paper.stats ? (
                <span className="kind-note">
                  {paper.stats.indexedFiles} 文件 · {(paper.stats.indexedBytes / 1024 / 1024).toFixed(1)}MB
                  {paper.stats.excludedFiles ? ` · 排除 ${paper.stats.excludedFiles}` : ''}
                </span>
              ) : null}
              {indexedAt && <span className="kind-note">索引于 {indexedAt}</span>}
              {paper.mode === 'local' && paper.workspaceId && (
                <button
                  type="button"
                  className="inline-action"
                  disabled={busy}
                  onClick={() => void a.reindexLocal(paper.workspaceId!)}
                >
                  重新索引
                </button>
              )}
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

        {paper?.mode !== 'paper' && <ToolTrace items={a.toolTrace} />}

        {turns.map((t, i) => {
          const isCurrentStreaming = t.role === 'assistant' && status === 'streaming' && i === turns.length - 1;
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
              {t.content ? <MarkdownLite text={t.content} streaming={isCurrentStreaming} /> : <ThinkingDots />}
            </article>
          ) : (
            <div key={i} className="ask-bubble">
              {t.content}
            </div>
          );
        })}

        {a.patches.map((patch) => (
          <section className="patch-review" key={patch.id}>
            <div className="patch-head">
              <div>
                <small>候选修改 · 尚未写入</small>
                <strong>{patch.path}</strong>
              </div>
              <div>
                <button
                  className="ghost"
                  disabled={Boolean(a.applyingPatchId)}
                  onClick={() => a.rejectPatch(patch.id)}
                >
                  拒绝
                </button>
                <button
                  className="primary"
                  disabled={Boolean(a.applyingPatchId)}
                  onClick={() => void a.confirmPatch(patch)}
                >
                  {a.applyingPatchId === patch.id ? '写入中…' : '确认写入'}
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
              {a.mode === 'paper'
                ? '把难懂的论文，读成大白话'
                : a.mode === 'github'
                  ? '从源码理解一个项目'
                  : '在授权目录内读写协作'}
            </p>
            <p className="empty-hint">
              {a.mode === 'paper'
                ? 'PDF、HTML 与粘贴文字使用论文专用方法。也可在网页选中文字后右键解读。'
                : a.mode === 'github'
                  ? '索引公开仓库全部合规文本源码，再按问题检索。'
                  : '读取整个选定目录；修改必须先审阅 diff。'}
            </p>
            {a.mode === 'paper' && (
              <button className="demo-btn" onClick={a.loadDemo}>
                先看一个示例解读
              </button>
            )}
          </div>
        )}
      </div>

      <div className="composer">
        {(status === 'streaming' || (status === 'extracting' && a.mode !== 'paper')) && (
          <button
            className="icon-btn stop"
            title="停止当前任务"
            aria-label="停止当前任务"
            onClick={a.stopCurrentTask}
          >
            <IconStop size={18} />
          </button>
        )}
        <textarea
          ref={askRef}
          className="ask-input"
          rows={1}
          placeholder={
            paper
              ? paper.mode !== 'paper'
                ? '继续询问项目，Enter 发送 / Shift+Enter 换行'
                : multiSession
                  ? '在同一会话里继续追问，Shift+Enter 换行'
                  : '追问会新开会话，Shift+Enter 换行'
              : a.mode === 'paper'
                ? '先读一篇论文'
                : '先导入一个项目'
          }
          value={followup}
          disabled={!paper || busy}
          onChange={(e) => setFollowup(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              submitAsk();
            }
          }}
        />
        <button
          className="icon-btn send"
          title="发送"
          aria-label="发送"
          disabled={!paper || busy || !followup.trim()}
          onClick={submitAsk}
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
