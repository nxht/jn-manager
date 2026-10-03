export interface KernelProcess {
  pid: number;
  uid: number;
  startTicks: string;
  kernelId: string;
  executable: string;
  state: string;
  cpuTicks: number;
  cpuPercent?: number;
  rssBytes: number;
  ageSeconds: number;
  createdAtEpochMs?: number;
  connectionFile?: string;
  launchExecutable?: string;
}

export interface KernelMetadata {
  id: string;
  name: string;
  executionState: string;
  notebookPaths: string[];
  source?: 'editor' | 'editor-log' | 'server';
}

export interface KernelRow {
  currentWindow?: boolean;
  process: KernelProcess;
  metadata?: KernelMetadata;
  serverUrl?: string;
  serverId?: string;
}

// IDs can collide across independent servers or processes. Ambiguous joins are withheld.
export function mergeKernels(
  processes: KernelProcess[],
  metadata: KernelMetadata[],
  serverUrl?: string,
): KernelRow[] {
  const counts = new Map<string, number>();
  for (const p of processes) counts.set(p.kernelId, (counts.get(p.kernelId) ?? 0) + 1);
  const byId = new Map<string, KernelMetadata | undefined>();
  for (const m of metadata) byId.set(m.id, byId.has(m.id) ? undefined : m);
  return processes.map((p) => {
    const match = counts.get(p.kernelId) === 1 ? byId.get(p.kernelId) : undefined;
    return { process: p, metadata: match, serverUrl: match ? serverUrl : undefined };
  });
}
