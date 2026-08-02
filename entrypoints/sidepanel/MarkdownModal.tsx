import { useEffect } from 'react';
import { MarkdownLite } from './MarkdownLite';
import { IconClose } from './icons';

interface Props {
  title: string;
  source?: string;
  content: string | null;
  onClose: () => void;
}

/** 侧栏内放大阅读（小窗口模式）；独立大窗由 extension-windows 负责。 */
export function MarkdownModal({ title, source, content, onClose }: Props) {
  useEffect(() => {
    if (!content) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [content, onClose]);

  if (!content) return null;

  return (
    <div
      className="reading-overlay"
      role="presentation"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <section
        className="reading-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="reading-dialog-title"
      >
        <header className="reading-dialog-head">
          <div>
            <p className="reading-kicker">沉浸阅读</p>
            <h2 id="reading-dialog-title">{title || '论文解读'}</h2>
            {source && <p className="reading-source">{source}</p>}
          </div>
          <button className="reading-close" type="button" aria-label="关闭放大阅读" onClick={onClose}>
            <IconClose size={20} />
          </button>
        </header>
        <div className="reading-paper">
          <MarkdownLite text={content} />
        </div>
      </section>
    </div>
  );
}
