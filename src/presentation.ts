import * as path from 'node:path';
import {
  defaultHighlights,
  type HighlightSettings,
  type Severity,
  totalMemoryHighlight,
} from './highlights.js';
import type { KernelProcess, KernelRow } from './model.js';

export interface Detail {
  label: string;
  value: string;
}

export function formatUptime(seconds: number): string {
  let remaining = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const parts: string[] = [];
  for (const [unit, length] of [
    ['d', 86400],
    ['h', 3600],
    ['m', 60],
    ['s', 1],
  ] as const) {
    const value = Math.floor(remaining / length);
    remaining %= length;
    if (value || (unit === 's' && !parts.length)) parts.push(`${value}${unit}`);
  }
  return parts.join(' ');
}

export function formatBytes(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`;
}

export function formatKernelMemory(processes: KernelProcess[]): string {
  return formatBytes(processes.reduce((bytes, process) => bytes + process.rssBytes, 0));
}

export function memoryStatus(
  processes: KernelProcess[],
  totalMemory?: number,
  settings: HighlightSettings = defaultHighlights,
): { text: string; tooltip: string; severity?: Severity } {
  const bytes = processes.reduce((sum, process) => sum + process.rssBytes, 0);
  const total = formatBytes(bytes);
  const severity = totalMemoryHighlight(bytes, totalMemory ?? 0, settings);
  // const percent =
  //   totalMemory !== undefined && Number.isFinite(totalMemory) && totalMemory > 0
  //     ? `\n${((bytes / totalMemory) * 100).toFixed(1)}% of host RAM.`
  //     : '';
  const alert = severity
    ? `\n${severity === 'critical' ? 'Critical' : 'Warning'}: total kernel RAM.`
    : '';
  return {
    text: `$(${severity === 'critical' ? 'error' : severity === 'warning' ? 'warning' : 'notebook'}) ${total}`,
    tooltip: `${total} across ${processes.length} kernel processes.${alert}`,
    severity,
  };
}

export function kernelTitle(row: KernelRow): string {
  const notebooks = row.metadata?.notebookPaths ?? [];
  if (!notebooks.length) return `Python · ${row.process.pid}`;
  const first = path.basename(notebooks[0] ?? '');
  return notebooks.length === 1 ? first : `${first} +${notebooks.length - 1}`;
}

export function kernelDetails(row: KernelRow): Detail[] {
  const p = row.process;
  const m = row.metadata;
  return [
    ...(p.cpuPercent === undefined ? [] : [{ label: 'CPU', value: `${p.cpuPercent.toFixed(1)}%` }]),
    { label: 'RAM', value: formatBytes(p.rssBytes) },
    { label: 'Uptime', value: formatUptime(p.ageSeconds) },
    { label: 'PID', value: String(p.pid) },
    ...(m?.notebookPaths ?? []).map((value) => ({ label: 'Notebook', value })),
    ...(m?.name ? [{ label: 'Kernel', value: m.name }] : []),
    { label: 'Interpreter', value: p.launchExecutable || p.executable },
    ...(m?.executionState && m.executionState !== 'unknown'
      ? [{ label: 'Status', value: m.executionState }]
      : []),
  ];
}

export function kernelText(row: KernelRow): string {
  return `${kernelTitle(row)}\n\n${kernelDetails(row)
    .map((d) => `${d.label}: ${d.value}`)
    .join('\n')}\n`;
}
