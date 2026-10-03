import * as path from 'node:path';
import type { KernelRow } from './model';

export interface NotebookResource {
  uri: string;
  path: string;
  name: string;
}
export interface KernelIdentity {
  pid: number;
  connectionFile: string;
}
export interface EditorKernel {
  handle: object;
  status: string;
  language: string;
  identity(signal: AbortSignal): Promise<KernelIdentity | undefined>;
}

export const identityCode =
  "print(__import__('json').dumps({'pid': __import__('os').getpid(), 'connection_file': __import__('ipykernel').get_connection_file()}))";

export async function readKernelIdentity(
  outputs: AsyncIterable<{ items: { mime: string; data: Uint8Array }[] }>,
): Promise<KernelIdentity | undefined> {
  let text = '';
  const decoder = new TextDecoder();
  for await (const output of outputs) {
    for (const item of output.items) {
      if (
        !['application/vnd.code.notebook.stdout', 'application/x.notebook.stream.stdout'].includes(
          item.mime,
        )
      )
        continue;
      text += decoder.decode(item.data, { stream: true });
      if (text.length > 4096) return;
    }
  }
  text += decoder.decode();
  try {
    const value = JSON.parse(text.trim()) as Record<string, unknown>;
    if (
      typeof value.pid === 'number' &&
      Number.isSafeInteger(value.pid) &&
      value.pid > 1 &&
      typeof value.connection_file === 'string' &&
      path.isAbsolute(value.connection_file)
    ) {
      return { pid: value.pid, connectionFile: path.normalize(value.connection_file) };
    }
  } catch {
    /* No diagnostic data is logged. */
  }
  return;
}

export class EditorTracker {
  private readonly cache = new Map<
    string,
    { handle: object; pid: number; startTicks: string; connectionFile: string }
  >();

  async enrich(
    rows: KernelRow[],
    notebooks: NotebookResource[],
    getKernel: (uri: string) => Promise<EditorKernel | undefined>,
    timeoutMs = 1500,
  ): Promise<KernelRow[]> {
    const associations = new Map<number, { paths: Set<string>; name: string; status: string }>();
    const opened = new Set(notebooks.map((n) => n.uri));
    for (const uri of this.cache.keys()) if (!opened.has(uri)) this.cache.delete(uri);
    for (const notebook of notebooks) {
      const controller = new AbortController();
      let timer: NodeJS.Timeout | undefined;
      try {
        const work = async () => {
          const kernel = await getKernel(notebook.uri);
          if (kernel?.language !== 'python' || controller.signal.aborted) return;
          const cached = this.cache.get(notebook.uri);
          let p =
            cached?.handle === kernel.handle
              ? rows.find(
                  (r) =>
                    r.process.pid === cached.pid &&
                    r.process.startTicks === cached.startTicks &&
                    r.process.connectionFile === cached.connectionFile,
                )?.process
              : undefined;
          if (!p) {
            this.cache.delete(notebook.uri);
            // Avoid queuing diagnostics behind busy/stuck computation or starting a kernel.
            if (kernel.status !== 'idle') return;
            const identity = await kernel.identity(controller.signal);
            if (!identity || controller.signal.aborted) return;
            p = rows.find(
              (r) =>
                r.process.pid === identity.pid &&
                r.process.connectionFile === identity.connectionFile,
            )?.process;
            if (!p) return; // Reject remote kernels and identities outside the verified owned process list.
            this.cache.set(notebook.uri, {
              handle: kernel.handle,
              pid: p.pid,
              startTicks: p.startTicks,
              connectionFile: identity.connectionFile,
            });
          }
          const association = associations.get(p.pid) ?? {
            paths: new Set<string>(),
            name: notebook.name,
            status: kernel.status,
          };
          association.paths.add(notebook.path);
          associations.set(p.pid, association);
        };
        await Promise.race([
          work(),
          new Promise<void>((resolve) => {
            timer = setTimeout(() => {
              controller.abort();
              resolve();
            }, timeoutMs);
          }),
        ]);
      } catch {
        /* API access or kernel diagnostics may be unavailable; process rows remain usable. */
      } finally {
        if (timer) clearTimeout(timer);
        controller.abort();
      }
    }
    return rows.map((row) => {
      const match = associations.get(row.process.pid);
      if (!match) return row;
      if (row.metadata)
        return {
          ...row,
          currentWindow: true,
          metadata: {
            ...row.metadata,
            notebookPaths: [...new Set([...row.metadata.notebookPaths, ...match.paths])],
          },
        };
      return {
        ...row,
        currentWindow: true,
        metadata: {
          id: row.process.kernelId,
          name: match.name,
          executionState: match.status,
          notebookPaths: [...match.paths],
          source: 'editor' as const,
        },
      };
    });
  }
}
