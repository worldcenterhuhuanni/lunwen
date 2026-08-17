import type { Material } from '../material/types';

export type Turn = {
  role: 'user' | 'assistant';
  content: string;
  /** 这轮针对的原文片段；缺省表示面向整篇材料。 */
  excerptId?: string;
};

export interface ExcerptRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 对照阅读中被追问过的原文片段。
 * 关联由用户的选中动作产生，不解析模型输出里的引用标记 —— 那条路一旦模型不听话就静默断链。
 */
export interface Excerpt {
  id: string;
  text: string;
  /** PDF 页码（从 1 起）；纯文本材料没有页的概念 */
  page?: number;
  /** 归一化到 0-1 的页内矩形，缩放和窗口宽度变化后仍能对齐 */
  rects?: ExcerptRect[];
}

/**
 * 持久化材料：剥掉 PDF 字节只留元信息。
 * 一篇论文的附件动辄几十 MB，而恢复历史会话是用来「读」已生成的解读；
 * 真要在恢复的会话里追问，重新选一次文件比常驻几十 MB 更划算。
 */
export type StoredMaterial = Omit<Material, 'pdf'> & {
  pdf?: { name: string; mime: string; byteLength: number };
};

export interface StoredSession {
  id: string;
  updatedAt: number;
  material: StoredMaterial;
  turns: Turn[];
  /** 本篇材料锁定的模板，恢复后追问不因全局配置变化而漂移。 */
  templateId: string;
  /** 对照阅读中产生的原文片段；旧会话没有这个字段。 */
  excerpts?: Excerpt[];
  /** 冗余一份便于按工作区级联删除；论文模式为空。 */
  workspaceId?: string;
}

/** 历史条数上限：够肉眼扫，又不会无限增长。 */
export const MAX_SESSIONS = 50;

export function stripAttachment(material: Material): StoredMaterial {
  const { pdf, ...rest } = material;
  if (!pdf) return rest;
  return {
    ...rest,
    pdf: { name: pdf.name, mime: pdf.mime, byteLength: pdf.data.byteLength },
  };
}
