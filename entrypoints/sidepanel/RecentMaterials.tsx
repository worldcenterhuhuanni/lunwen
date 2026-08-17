import { useEffect, useState } from 'react';
import { listSessions } from '@/lib/session/store';
import type { StoredSession } from '@/lib/session/types';
import { listWorkspaces } from '@/lib/workspace/store';
import type { WorkspaceRecord } from '@/lib/workspace/types';
import { materialModeLabel } from '@/lib/material/types';
import { IconChevron } from './icons';

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const minute = 60_000;
  if (diff < minute) return '刚刚';
  if (diff < 60 * minute) return `${Math.floor(diff / minute)} 分钟前`;
  if (diff < 24 * 60 * minute) return `${Math.floor(diff / (60 * minute))} 小时前`;
  if (diff < 30 * 24 * 60 * minute) return `${Math.floor(diff / (24 * 60 * minute))} 天前`;
  return new Date(ts).toLocaleDateString();
}

interface Props {
  version: number;
  busy: boolean;
  onRestore: (session: StoredSession) => void;
  onRemoveSession: (session: StoredSession) => Promise<void>;
  onReuse: (workspaceId: string) => void;
  onReindex: (workspaceId: string) => void;
  onRemoveWorkspace: (workspaceId: string) => Promise<void>;
}

export function RecentMaterials({
  version,
  busy,
  onRestore,
  onRemoveSession,
  onReuse,
  onReindex,
  onRemoveWorkspace,
}: Props) {
  const [open, setOpen] = useState(false);
  const [sessions, setSessions] = useState<StoredSession[]>([]);
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([listSessions(), listWorkspaces()])
      .then(([rows, spaces]) => {
        if (cancelled) return;
        setSessions(rows);
        setWorkspaces(spaces);
      })
      .catch((e) => console.error('读取历史失败', e));
    return () => {
      cancelled = true;
    };
  }, [version]);

  const total = sessions.length + workspaces.length;
  if (!total) return null;

  return (
    <div className={open ? 'recent open' : 'recent'}>
      <button type="button" className="recent-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          <strong>最近材料</strong>
          <small>
            {sessions.length} 条解读 · {workspaces.length} 个索引
          </small>
        </span>
        <IconChevron size={16} />
      </button>

      {open && (
        <div className="recent-body">
          {sessions.length > 0 && (
            <>
              <p className="recent-group">解读记录</p>
              {sessions.map((session) => (
                <div className="recent-row" key={session.id}>
                  <button
                    type="button"
                    className="recent-main"
                    disabled={busy}
                    onClick={() => onRestore(session)}
                    title="恢复这次解读"
                  >
                    <strong>{session.material.title}</strong>
                    <small>
                      {materialModeLabel(session.material.mode)} · {relativeTime(session.updatedAt)} ·{' '}
                      {session.turns.filter((turn) => turn.role === 'assistant').length} 条回答
                    </small>
                  </button>
                  <button
                    type="button"
                    className="recent-del"
                    aria-label="删除这条记录"
                    onClick={() => void onRemoveSession(session)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </>
          )}

          {workspaces.length > 0 && (
            <>
              <p className="recent-group">已建索引</p>
              {workspaces.map((space) => (
                <div className="recent-row" key={space.id}>
                  <button
                    type="button"
                    className="recent-main"
                    disabled={busy}
                    onClick={() => onReuse(space.id)}
                    title="复用这个索引直接分析"
                  >
                    <strong>{space.title}</strong>
                    <small>
                      {materialModeLabel(space.mode)} · 索引于 {relativeTime(space.createdAt)} ·{' '}
                      {space.stats.indexedFiles} 文件 ·{' '}
                      {(space.stats.indexedBytes / 1024 / 1024).toFixed(1)}MB
                    </small>
                  </button>
                  {space.mode === 'local' && space.rootHandle && (
                    <button
                      type="button"
                      className="recent-del"
                      disabled={busy}
                      onClick={() => onReindex(space.id)}
                      title="重新读取磁盘内容"
                    >
                      重索引
                    </button>
                  )}
                  <button
                    type="button"
                    className="recent-del"
                    aria-label="删除这个索引"
                    onClick={() => void onRemoveWorkspace(space.id)}
                  >
                    删除
                  </button>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}
