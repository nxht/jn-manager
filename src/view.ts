import { cpus, totalmem } from 'node:os';
import * as vscode from 'vscode';
import { groupKernels, type KernelGroup } from './grouping';
import {
  defaultHighlights,
  type HighlightSettings,
  highestSeverity,
  resourceHighlights,
  type Severity,
} from './highlights';
import type { KernelRow } from './model';
import { type Detail, formatBytes, kernelDetails, kernelText, kernelTitle } from './presentation';

export class KernelItem extends vscode.TreeItem {
  constructor(
    readonly row: KernelRow,
    severity?: Severity,
  ) {
    super(kernelTitle(row), vscode.TreeItemCollapsibleState.Collapsed);
    const p = row.process;
    this.id = `${p.pid}:${p.startTicks}`;
    this.contextValue = 'ownedKernel';
    const cpu = p.cpuPercent === undefined ? '—' : `${p.cpuPercent.toFixed(1)}%`;
    this.description = `${cpu} CPU · ${formatBytes(p.rssBytes)} RAM`;
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
    super(`${detail.label}: ${detail.value}`, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'kernelDetail';
    this.tooltip = detail.value;
    this.command = { command: 'jnManager.copy', title: 'Copy Value', arguments: [this] };
    this.resourceUri = highlightUri(row, detail.label, severity);
    const icons: Record<string, string> = {
      Notebook: 'notebook',
      Kernel: 'symbol-method',
      PID: 'symbol-number',
      CPU: 'circuit-board',
      RAM: 'database',
      Uptime: 'watch',
      Interpreter: 'terminal',
      Status: 'pulse',
    };
    this.iconPath = new vscode.ThemeIcon(icons[detail.label] ?? 'info', severityColor(severity));
  }
}

export class GroupItem extends vscode.TreeItem {
  constructor(readonly group: KernelGroup) {
    super(group.label, vscode.TreeItemCollapsibleState.Expanded);
    this.id = group.id;
    this.contextValue = 'kernelGroup';
    this.description = `${group.rows.length} ${group.rows.length === 1 ? 'kernel' : 'kernels'}`;
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
  private message = 'Loading kernels…';

  constructor(private readonly settings: () => HighlightSettings = () => defaultHighlights) {}

  update(rows: KernelRow[], message = 'No running kernels.'): void {
    this.rows = rows;
    this.message = message;
    this.changed.fire(undefined);
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
      return item.group.rows.map(
        (row) =>
          new KernelItem(
            row,
            highestSeverity(Object.values(resourceHighlights(row.process, host, settings))),
          ),
      );
    if (item instanceof KernelItem) {
      const highlights = resourceHighlights(item.row.process, host, settings);
      return kernelDetails(item.row).map(
        (d) => new DetailItem(d, item.row, highlights[d.label as keyof typeof highlights]),
      );
    }
    if (item) return [];
    if (this.rows.length) return groupKernels(this.rows).map((group) => new GroupItem(group));
    return [new vscode.TreeItem(this.message)];
  }

  dispose(): void {
    this.changed.dispose();
  }
}
