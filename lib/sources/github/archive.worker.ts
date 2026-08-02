/// <reference lib="webworker" />
import { parseTar } from './archive';
import type { WorkspaceCandidate } from '../../workspace/types';

type WorkerRequest = { id: string; gzip: ArrayBuffer };
type WorkerResponse =
  | { id: string; ok: true; files: WorkspaceCandidate[] }
  | { id: string; ok: false; error: string };

async function gunzip(input: ArrayBuffer): Promise<Uint8Array> {
  if (!('DecompressionStream' in globalThis)) {
    throw new Error('当前浏览器不支持 gzip 解压。请升级 Chrome 后重试。');
  }
  const stream = new Blob([input]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, gzip } = event.data;
  try {
    const files = parseTar(await gunzip(gzip));
    self.postMessage({ id, ok: true, files } satisfies WorkerResponse);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: (error as Error).message || '归档解析失败',
    } satisfies WorkerResponse);
  }
};

export {};
