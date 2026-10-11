import { cpus, totalmem } from 'node:os';
import * as vscode from 'vscode';
import { groupKernels, type KernelGroup } from './grouping.js';
import {
  defaultHighlights,
  type HighlightSettings,
  highestSeverity,
  resourceHighlights,
  type Severity,
} from './highlights.js';
import type { KernelRow } from './model.js';
import {
  type Detail,
  formatBytes,
  formatKernelMemory,
  formatUptime,
  kernelDetails,
  kernelText,
  kernelTitle,
} from './presentation.js';

export class KernelItem extends vscode.TreeItem {
  constructor(
    readonly row: KernelRow,
    severity?: Severity,
  ) {
    super(kernelTitle(row), vscode.TreeItemCollapsibleState.Collapsed);
    const p = row.process;
    this.id = `${p.pid}:${p.startTicks}`;
    this.contextValue = 'ownedKernel';
    const cpu = p.cpuPercent === undefined ? '' : `${p.cpuPercent.toFixed(1)}% · `;
    const uptime = p.ageSeconds < 60 ? '<1m' : formatUptime(Math.floor(p.ageSeconds / 60) * 60);
    this.description = `${cpu}${formatBytes(p.rssBytes)} · ${uptime}`;
    this.tooltip = kernelDetails(row)
      .map((d) => `${d.label}: ${d.value}`)
      .join('\n');
    this.iconPath = new vscode.ThemeIcon(
      row.metadata?.executionState === 'busy' ? 'sync' : 'notebook',
      severityColor(severity),
    );
    this.resourceUri = highlightUri(row, 'kernel', severity);
  }
}

export class DetailItem extends vscode.TreeItem {
  constructor(
    readonly detail: Detail,
    row: KernelRow,
    severity?: Severity,
  ) {
    super(detail.label, vscode.TreeItemCollapsibleState.None);
    if (detail.label === 'Uptime') this.id = `${row.process.pid}:${row.process.startTicks}:uptime`;
    this.description = detail.value;
    this.contextValue = 'kernelDetail';
    this.tooltip = detail.value;
    this.command = { command: 'jnManager.copy', title: 'Copy Value', arguments: [this] };
    this.resourceUri = highlightUri(row, detail.label, severity);
    const icons: Record<string, string> = {
      Notebook: 'notebook',
      Kernel: 'symbol-method',
      PID: 'symbol-number',
      CPU: 'chip',
      RAM: 'circuit-board',
      Uptime: 'clock',
      Interpreter: 'terminal',
      Status: 'pulse',
    };
    this.iconPath = new vscode.ThemeIcon(icons[detail.label] ?? 'info', severityColor(severity));
  }

  updateUptime(row: KernelRow, severity?: Severity): boolean {
    const value = formatUptime(row.process.ageSeconds);
    const color = severityColor(severity);
    if (this.detail.value === value && (this.iconPath as vscode.ThemeIcon).color?.id === color?.id)
      return false;
    this.detail.value = value;
    this.description = value;
    this.tooltip = value;
    this.iconPath = new vscode.ThemeIcon('clock', color);
    this.resourceUri = highlightUri(row, 'Uptime', severity);
    return true;
  }
}

export class GroupItem extends vscode.TreeItem {
  constructor(readonly group: KernelGroup) {
    super(group.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = group.id;
    this.contextValue = 'kernelGroup';
    this.description = `Total ${formatKernelMemory(group.rows.map((row) => row.process))}`;
    this.tooltip = `${group.rows.length} ${group.rows.length === 1 ? 'kernel' : 'kernels'} · ${this.description}`;
    this.iconPath = new vscode.ThemeIcon(
      group.id === 'current-window'
        ? 'window'
        : group.id.startsWith('server:')
          ? 'server'
          : 'notebook',
    );
  }
}

export type Entry = KernelItem | DetailItem | GroupItem | vscode.TreeItem;

function severityColor(severity?: Severity): vscode.ThemeColor | undefined {
  return severity ? new vscode.ThemeColor(`jnManager.${severity}Foreground`) : undefined;
}

function highlightUri(row: KernelRow, field: string, severity?: Severity): vscode.Uri | undefined {
  if (!severity) return;
  return vscode.Uri.from({
    scheme: 'jn-manager-highlight',
    authority: severity,
    path: `/${row.process.pid}-${row.process.startTicks}/${field}`,
  });
}

export const highlightDecorations: vscode.FileDecorationProvider = {
  provideFileDecoration(uri) {
    if (uri.scheme !== 'jn-manager-highlight') return;
    if (uri.authority !== 'warning' && uri.authority !== 'critical') return;
    return { color: severityColor(uri.authority), propagate: false };
  },
};

export function copyText(item: unknown): string | undefined {
  if (item instanceof DetailItem) return item.detail.value;
  if (item instanceof KernelItem) return kernelText(item.row);
  return;
}

export class KernelView implements vscode.TreeDataProvider<Entry>, vscode.Disposable {
  private readonly changed = new vscode.EventEmitter<Entry | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private rows: KernelRow[] = [];
  private groups: GroupItem[] = [];
  private readonly kernels = new Map<KernelRow, KernelItem>();
  private readonly details = new Map<KernelRow, DetailItem[]>();
  private sampledAges: number[] = [];
  private sampledAt = 0;
  private message = 'Loading kernels…';

  constructor(private readonly settings: () => HighlightSettings = () => defaultHighlights) {}

  update(rows: KernelRow[], message = 'No running kernels.', sampledAt = performance.now()): void {
    this.rows = rows;
    this.groups = groupKernels(rows).map((group) => new GroupItem(group));
    this.kernels.clear();
    this.details.clear();
    this.sampledAges = rows.map((row) => row.process.ageSeconds);
    this.sampledAt = sampledAt;
    this.message = message;
    this.advanceUptime();
    this.changed.fire(undefined);
  }

  private advanceUptime(): void {
    const elapsedSeconds = Math.max(0, performance.now() - this.sampledAt) / 1000;
    for (const [index, row] of this.rows.entries()) {
      row.process.ageSeconds = (this.sampledAges[index] ?? 0) + elapsedSeconds;
    }
  }

  tick(): void {
    if (!this.rows.length) return;
    this.advanceUptime();
    const settings = this.settings();
    const host = { cpuCount: cpus().length, totalMemory: totalmem() };
    for (const [row, details] of this.details) {
      const uptime = details.find((detail) => detail.detail.label === 'Uptime');
      if (uptime?.updateUptime(row, resourceHighlights(row.process, host, settings).Uptime)) {
        this.changed.fire(uptime);
      }
    }
  }

  contains(row: KernelRow): boolean {
    return this.rows.some((r) => r === row);
  }
  getTreeItem(item: Entry): vscode.TreeItem {
    return item;
  }

  getChildren(item?: Entry): Entry[] {
    const settings = this.settings();
    const host = { cpuCount: cpus().length, totalMemory: totalmem() };
    if (item instanceof GroupItem)
      return item.group.rows
        .filter((row) => this.contains(row))
        .map((row) => {
          let kernel = this.kernels.get(row);
          if (!kernel) {
            kernel = new KernelItem(
              row,
              highestSeverity(Object.values(resourceHighlights(row.process, host, settings))),
            );
            this.kernels.set(row, kernel);
          }
          return kernel;
        });
    if (item instanceof KernelItem) {
      if (!this.contains(item.row)) return [];
      const cached = this.details.get(item.row);
      if (cached) return cached;
      const highlights = resourceHighlights(item.row.process, host, settings);
      const details = kernelDetails(item.row).map(
        (d) => new DetailItem(d, item.row, highlights[d.label as keyof typeof highlights]),
      );
      this.details.set(item.row, details);
      return details;
    }
    if (item) return [];
    if (this.rows.length) return this.groups;
    return [new vscode.TreeItem(this.message)];
  }

  dispose(): void {
    this.details.clear();
    this.kernels.clear();
    this.groups = [];
    this.changed.dispose();
  }
}
