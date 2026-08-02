import type { PromptTemplate } from '@/lib/prompt-templates';
import { allTemplates } from '@/lib/prompt-templates';
import type { AnalysisMode } from '@/lib/material/types';

interface Props {
  customTemplates: PromptTemplate[];
  mode: AnalysisMode;
  value: string;
  disabled?: boolean;
  onChange: (id: string) => void;
  onManage: () => void;
}

export function TemplatePicker({
  customTemplates,
  mode,
  value,
  disabled,
  onChange,
  onManage,
}: Props) {
  const compatible = allTemplates(customTemplates).filter((template) => {
    if (template.scope === 'all') return true;
    if (mode === 'paper') return ['pdf', 'html', 'both'].includes(template.scope);
    if (mode === 'github') return template.scope === 'github' || template.scope === 'project';
    return template.scope === 'local' || template.scope === 'project';
  });
  return (
    <div className="template-picker">
      <div className="template-picker-head">
        <label htmlFor="prompt-template">解读模板</label>
        <button type="button" className="template-manage" onClick={onManage}>
          管理
        </button>
      </div>
      <select
        id="prompt-template"
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="auto">
          {mode === 'paper' ? '自动（按 PDF / HTML 默认）' : '自动（按当前模式默认）'}
        </option>
        {compatible.map((template) => (
          <option key={template.id} value={template.id}>
            {template.name} · {template.scope === 'both' ? '通用' : template.scope.toUpperCase()}
          </option>
        ))}
      </select>
    </div>
  );
}
