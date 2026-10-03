import type { KernelRow } from './model';

export interface KernelGroup {
  id: string;
  label: string;
  rows: KernelRow[];
}

export interface VisibilitySettings {
  includeExternalServers: boolean;
  includeOtherWindows: boolean;
}

function groupIdentity(row: KernelRow): Pick<KernelGroup, 'id' | 'label'> {
  if (row.currentWindow) return { id: 'current-window', label: 'Current window' };
  if (row.serverId && row.serverUrl) {
    const url = new URL(row.serverUrl);
    return {
      id: `server:${row.serverId}`,
      label: `Jupyter · ${url.host}${url.pathname === '/' ? '' : url.pathname}`,
    };
  }
  if (
    row.metadata?.source === 'editor' ||
    row.metadata?.source === 'editor-log' ||
    row.process.kernelId.startsWith('v3')
  )
    return { id: 'editor', label: 'Other VS Code / Cursor kernels' };
  return { id: 'other', label: 'Other kernels' };
}

export function visibleKernels(rows: KernelRow[], settings: VisibilitySettings): KernelRow[] {
  return rows.filter((row) => {
    const { id } = groupIdentity(row);
    if (id.startsWith('server:')) return settings.includeExternalServers;
    if (id === 'editor') return settings.includeOtherWindows;
    return true;
  });
}

export function groupKernels(rows: KernelRow[]): KernelGroup[] {
  const groups = new Map<string, KernelGroup>();
  for (const row of rows) {
    const { id, label } = groupIdentity(row);
    const group = groups.get(id) ?? { id, label, rows: [] };
    group.rows.push(row);
    groups.set(id, group);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.id === 'current-window') return -1;
    if (b.id === 'current-window') return 1;
    return a.label.localeCompare(b.label);
  });
}
