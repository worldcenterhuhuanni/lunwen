import { useEffect, useState } from 'react';
import {
  type AppConfig,
  type ProviderId,
  DEFAULT_CONFIG,
  PROVIDERS,
  getPreset,
  isWebBridgeProvider,
} from '@/lib/config';
import { getConfig, setConfig } from '@/lib/storage';
import { streamChat } from '@/lib/llm';
import { checkDeepSeekWebStatus, DEEPSEEK_CHAT_URL } from '@/lib/deepseek-web';
import { PromptTemplateManager } from './PromptTemplateManager';

export default function App() {
  const [cfg, setCfg] = useState<AppConfig>(DEFAULT_CONFIG);
  const [saved, setSaved] = useState(false);
  const [test, setTest] = useState<{ ok?: boolean; msg: string } | null>(null);

  useEffect(() => {
    getConfig().then(setCfg);
  }, []);

  function patch(p: Partial<AppConfig>) {
    setSaved(false);
    setCfg((c) => ({ ...c, ...p }));
  }

  // 切换 provider:自动填入其 baseURL 与建议模型(custom / 网页模式特殊处理)。
  function onProvider(id: ProviderId) {
    const preset = getPreset(id);
    if (preset.webBridge) {
      patch({ provider: id, baseURL: '', model: '' });
      return;
    }
    patch({
      provider: id,
      baseURL: id === 'custom' ? cfg.baseURL : preset.baseURL,
      model: preset.models[0] ?? cfg.model,
    });
  }

  async function save() {
    await setConfig(cfg);
    setSaved(true);
  }

  async function runTest() {
    setTest({ msg: '测试中…' });
    try {
      if (isWebBridgeProvider(cfg.provider)) {
        const st = await checkDeepSeekWebStatus();
        if (!st.loggedIn || !st.hasInput) {
          setTest({
            ok: false,
            msg: `未检测到已登录的 DeepSeek 聊天页。请打开 ${DEEPSEEK_CHAT_URL} 并登录后重试。`,
          });
          return;
        }
        setTest({ ok: true, msg: '已连接到 DeepSeek 网页 ✓ 保持该标签页打开即可解读。' });
        return;
      }
      let got = '';
      for await (const d of streamChat(cfg, [{ role: 'user', content: '回复“ok”两个字' }])) {
        got += d;
        if (got.length > 20) break;
      }
      setTest({ ok: true, msg: `连接成功 ✓ 模型回复:${got.trim() || '(空)'}` });
    } catch (e) {
      setTest({ ok: false, msg: `连接失败:${(e as Error).message}` });
    }
  }

  const preset = getPreset(cfg.provider);
  const web = isWebBridgeProvider(cfg.provider);

  return (
    <div className="wrap">
      <header className="masthead">
        <span className="mark" />
        <h1>材料解读 · 设置</h1>
      </header>
      <p className="hint">
        论文、GitHub 项目与本地工作区共用模型配置。DeepSeek 网页无需 API Key；
        API 模型可使用原生项目工具调用。
      </p>

      <label>模型服务</label>
      <div className="providers">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            className={cfg.provider === p.id ? 'chip active' : 'chip'}
            onClick={() => onProvider(p.id)}
          >
            {p.label}
          </button>
        ))}
      </div>

      {web ? (
        <div className="result" style={{ marginTop: 12 }}>
          <p style={{ margin: 0 }}>
            使用方式:
            <br />
            1. 加载扩展目录 <code>output/chrome-mv3</code>
            <br />
            2. 打开并登录{' '}
            <a href={DEEPSEEK_CHAT_URL} target="_blank" rel="noreferrer">
              chat.deepseek.com
            </a>
            <br />
            3. 「解读当前页面」会优先找论文页的 PDF 下载链接并上传到附件
            <br />
            4. 下方可选单轮/多轮会话策略
          </p>
        </div>
      ) : (
        <>
          <label>接口地址 (baseURL)</label>
          <input
            value={cfg.baseURL}
            placeholder="如 https://api.deepseek.com/v1 或 http://localhost:4000/v1"
            onChange={(e) => patch({ baseURL: e.target.value })}
          />

          <label>API Key</label>
          <input
            type="password"
            value={cfg.apiKey}
            placeholder="sk-..."
            onChange={(e) => patch({ apiKey: e.target.value })}
          />

          <label>模型 (model)</label>
          <input
            value={cfg.model}
            list="model-suggestions"
            placeholder="如 deepseek-chat"
            onChange={(e) => patch({ model: e.target.value })}
          />
          <datalist id="model-suggestions">
            {preset.models.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>
        </>
      )}

      {web && (
        <>
          <label>DeepSeek 会话策略</label>
          <div className="providers">
            <button
              className={(cfg.webSessionMode ?? 'single') === 'single' ? 'chip active' : 'chip'}
              onClick={() => patch({ webSessionMode: 'single' })}
            >
              单轮（每次新开）
            </button>
            <button
              className={cfg.webSessionMode === 'multi' ? 'chip active' : 'chip'}
              onClick={() => patch({ webSessionMode: 'multi' })}
            >
              多轮（同会话追问）
            </button>
          </div>
          <p className="hint" style={{ marginTop: 0 }}>
            单轮:每次回答都新开 DeepSeek 对话,互不污染。
            <br />
            多轮:同一篇材料在同一对话里继续追问,不再重复上传 PDF。
          </p>
        </>
      )}

      <label>正文截断上限(字符,仅 HTML/API 文本通路)</label>
      <input
        type="number"
        value={cfg.maxContextChars}
        onChange={(e) => patch({ maxContextChars: Number(e.target.value) || DEFAULT_CONFIG.maxContextChars })}
      />

      <label>项目索引上限</label>
      <div className="template-defaults">
        <label>
          最大文件数
          <input
            type="number"
            min={100}
            max={20000}
            value={cfg.maxProjectFiles}
            onChange={(e) => patch({ maxProjectFiles: Number(e.target.value) || DEFAULT_CONFIG.maxProjectFiles })}
          />
        </label>
        <label>
          总文本上限（MB）
          <input
            type="number"
            min={1}
            max={200}
            value={Math.round(cfg.maxProjectTotalBytes / 1024 / 1024)}
            onChange={(e) => patch({
              maxProjectTotalBytes: (Number(e.target.value) || 20) * 1024 * 1024,
            })}
          />
        </label>
        <label>
          单文件上限（KB）
          <input
            type="number"
            min={64}
            max={4096}
            value={Math.round(cfg.maxProjectFileBytes / 1024)}
            onChange={(e) => patch({
              maxProjectFileBytes: (Number(e.target.value) || 1024) * 1024,
            })}
          />
        </label>
        <label>
          GitHub 压缩包上限（MB）
          <input
            type="number"
            min={5}
            max={300}
            value={Math.round(cfg.maxProjectArchiveBytes / 1024 / 1024)}
            onChange={(e) => patch({
              maxProjectArchiveBytes: (Number(e.target.value) || 80) * 1024 * 1024,
            })}
          />
        </label>
      </div>
      <label>项目追加忽略规则（每行一条）</label>
      <textarea
        rows={3}
        value={cfg.projectIgnorePatterns.join('\n')}
        placeholder={'例如：fixtures/**\n*.generated.ts'}
        onChange={(e) => patch({
          projectIgnorePatterns: e.target.value
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean),
        })}
      />
      <p className="hint" style={{ marginTop: 0 }}>
        项目索引默认跳过依赖、构建产物、二进制与疑似密钥；达到总量上限时会停止，不会静默截断。
      </p>

      <label>界面与跳转</label>
      <div className="toggle-list">
        <label className="toggle-row">
          <span>
            <strong>独立大窗口</strong>
            <small>默认关闭：设置与放大阅读留在侧栏/系统页。开启后跳到居中独立大窗。</small>
          </span>
          <input
            type="checkbox"
            checked={Boolean(cfg.preferLargeWindows)}
            onChange={(e) => patch({ preferLargeWindows: e.target.checked })}
          />
        </label>
        {web && (
          <label className="toggle-row">
            <span>
              <strong>解读时跳转 DeepSeek</strong>
              <small>默认开启：网页模式解读时自动切到 DeepSeek 标签。关闭后后台桥接，不抢焦点。</small>
            </span>
            <input
              type="checkbox"
              checked={cfg.autoFocusDeepSeek !== false}
              onChange={(e) => patch({ autoFocusDeepSeek: e.target.checked })}
            />
          </label>
        )}
      </div>

      <div className="actions">
        <button className="primary" onClick={save}>
          保存
        </button>
        <button onClick={runTest}>{web ? '检测网页连接' : '测试连接'}</button>
        {saved && <span className="ok">已保存 ✓</span>}
      </div>

      {test && <div className={test.ok === false ? 'result err' : 'result'}>{test.msg}</div>}

      <PromptTemplateManager config={cfg} patchConfig={patch} />
    </div>
  );
}
