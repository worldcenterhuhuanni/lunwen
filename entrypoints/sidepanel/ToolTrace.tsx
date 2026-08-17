import { useState } from 'react';
import { formatToolArgs, summarizeToolResult } from '@/lib/agent/tool-summary';
import type { ToolTrace as Trace } from './useAnalysis';

export function ToolTrace({ items }: { items: Trace[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  if (!items.length) return null;

  return (
    <div className="tool-trace" aria-label="项目工具轨迹">
      <span>来源轨迹</span>
      <div>
        {items.map((item) => {
          const args = formatToolArgs(item.args);
          const result = summarizeToolResult(item.result);
          const expandable = Boolean(args || result);
          const open = openId === item.id;
          return (
            <div key={item.id} className="trace-item">
              <button
                type="button"
                className={`trace-chip ${item.status}`}
                aria-expanded={expandable ? open : undefined}
                disabled={!expandable}
                onClick={() => setOpenId(open ? null : item.id)}
              >
                {item.name}
                {expandable && <em>{open ? '收起' : '详情'}</em>}
              </button>
              {open && (
                <div className="trace-detail">
                  {args && (
                    <>
                      <small>参数</small>
                      <pre>{args}</pre>
                    </>
                  )}
                  {result && (
                    <>
                      <small>结果</small>
                      <pre>{result}</pre>
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
