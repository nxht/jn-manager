import { hostname } from 'node:os';
import * as vscode from 'vscode';
import { actOnKernel, assertSameKernel, type KernelAction } from './actions.js';
import { RuntimeDiscovery } from './discovery.js';
import { type EditorKernel, EditorTracker, identityCode, readKernelIdentity } from './editor.js';
import { EditorLogDiscovery, editorHostDirectory, editorLogRoots } from './editorLogs.js';
import { visibleKernels } from './grouping.js';
import { defaultHighlights, type HighlightSettings } from './highlights.js';
import { memoryStatus } from './presentation.js';
import { LinuxCollector } from './proc.js';
import { copyText, highlightDecorations, KernelItem, KernelView } from './view.js';

interface JupyterExports {
  kernels?: {
    getKernel(uri: vscode.Uri): PromiseLike<
      | {
          status: string;
          language: string;
          executeCode(
            code: string,
            token: vscode.CancellationToken,
          ): AsyncIterable<{ items: { mime: string; data: Uint8Array }[] }>;
        }
      | undefined
    >;
  };
}

export function activate(context: vscode.ExtensionContext): void {
  const collector = new LinuxCollector();
  const discovery = new RuntimeDiscovery();
  const editor = new EditorTracker();
  const config = () => vscode.workspace.getConfiguration('jnManager');
  const highlightSettings = (): HighlightSettings => {
    const settings = { ...defaultHighlights };
    settings.enabled = config().get<boolean>('highlights.enabled', true);
    for (const key of Object.keys(defaultHighlights) as (keyof HighlightSettings)[]) {
      if (key === 'enabled') continue;
      const value = config().get<number>(`highlights.${key}`, defaultHighlights[key]);
      settings[key] = Number.isFinite(value)
        ? Math.max(0, Math.min(key.startsWith('uptime') ? Number.MAX_VALUE : 100, value))
        : defaultHighlights[key];
    }
    return settings;
  };
  const provider = new KernelView(highlightSettings);
  const editorLogs = new EditorLogDiscovery(
    editorLogRoots(context.logUri.fsPath),
    process.geteuid?.(),
    undefined,
    editorHostDirectory(context.logUri.fsPath),
  );
  const tree = vscode.window.createTreeView('jnManager.kernels', {
    treeDataProvider: provider,
    showCollapseAll: true,
  });
  const memory = vscode.window.createStatusBarItem(
    'jnManager.memory',
    vscode.StatusBarAlignment.Right,
  );
  memory.name = 'Jupyter Kernel Memory';
  memory.command = 'jnManager.kernels.focus';
  context.subscriptions.push(
    memory,
    provider,
    tree,
    vscode.window.registerFileDecorationProvider(highlightDecorations),
  );
  let disposed = false;
  let refreshing: Promise<void> | undefined;
  let revision = 0;
  let timer: NodeJS.Timeout | undefined;
  let refreshInterval = 5000;
  let nextRefreshAt = Date.now();

  function countdown(): void {
    const seconds = Math.max(0, Math.ceil((nextRefreshAt - Date.now()) / 1000));
    tree.description = `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  }

  async function editorKernel(uri: string): Promise<EditorKernel | undefined> {
    const extension = vscode.extensions.getExtension<JupyterExports>('ms-toolsai.jupyter');
    if (!extension) return;
    const api = extension.isActive ? extension.exports : await extension.activate();
    const kernel = await api.kernels?.getKernel(vscode.Uri.parse(uri));
    if (!kernel) return;
    return {
      handle: kernel,
      status: kernel.status,
      language: kernel.language,
      identity: async (signal) => {
        if (signal.aborted) return;
        const cancellation = new vscode.CancellationTokenSource();
        const cancel = () => cancellation.cancel();
        signal.addEventListener('abort', cancel, { once: true });
        try {
          return await readKernelIdentity(kernel.executeCode(identityCode, cancellation.token));
        } finally {
          signal.removeEventListener('abort', cancel);
          cancellation.dispose();
        }
      },
    };
  }

  async function collect(): Promise<void> {
    const currentRevision = revision;
    try {
      const processes = await collector.snapshot();
      if (!disposed && currentRevision === revision) {
        const summary = memoryStatus(processes);
        memory.text = summary.text;
        memory.tooltip = `${summary.tooltip}\nHost: ${hostname()}\nClick to open Jupyter Notebook Manager.`;
        memory.show();
      }
      if (!tree.visible || disposed || currentRevision !== revision) return;
      const discovered = await discovery.enrich(processes);
      const notebooks = vscode.workspace.notebookDocuments
        .filter((n) => n.notebookType === 'jupyter-notebook')
        .map((n) => {
          const name: unknown = n.metadata?.kernelspec?.display_name;
          return {
            uri: n.uri.toString(),
            path: n.uri.fsPath || n.uri.toString(),
            name: typeof name === 'string' ? name : 'Python',
          };
        });
      const editorRows = processes.length
        ? await editor.enrich(discovered, notebooks, editorKernel)
        : discovered;
      const rows = await editorLogs.enrich(editorRows);
      if (!disposed && currentRevision === revision) {
        const visible = visibleKernels(rows, {
          includeExternalServers: config().get<boolean>('includeExternalServers', true),
          includeOtherWindows: config().get<boolean>('includeOtherWindows', true),
        });
        provider.update(
          visible,
          rows.length ? 'No kernels match the visibility settings.' : 'No running kernels.',
        );
      }
    } catch (error) {
      if (!disposed && currentRevision === revision) {
        memory.hide();
        provider.update([], error instanceof Error ? error.message : 'Kernel discovery failed.');
      }
    }
  }

  async function refresh(): Promise<void> {
    if (disposed) return;
    if (refreshing) return refreshing;
    refreshing = collect();
    try {
      await refreshing;
    } finally {
      refreshing = undefined;
      nextRefreshAt = Date.now() + refreshInterval;
      if (!disposed) countdown();
    }
  }

  function schedule(): void {
    if (timer) clearInterval(timer);
    timer = undefined;
    if (disposed) return;
    const raw = config().get<number>('refreshSeconds', 5);
    const seconds = Number.isFinite(raw) ? Math.max(2, Math.min(300, raw)) : 5;
    refreshInterval = seconds * 1000;
    nextRefreshAt = Date.now() + refreshInterval;
    countdown();
    timer = setInterval(() => {
      countdown();
      if (Date.now() >= nextRefreshAt) void refresh();
    }, 1000);
  }

  async function invalidate(): Promise<void> {
    revision++;
    provider.update([], 'Refreshing kernel information…');
    await refreshing;
    await refresh();
  }

  async function runAction(item: unknown, action: KernelAction): Promise<void> {
    if (!(item instanceof KernelItem) || !provider.contains(item.row)) {
      void vscode.window.showInformationMessage(
        'Refresh and select a current kernel from Jupyter Notebook Manager.',
      );
      return;
    }
    const p = item.row.process;
    const label = action === 'interrupt' ? 'Interrupt' : action === 'stop' ? 'Stop' : 'Force Kill';
    const affected = item.row.metadata?.notebookPaths.join(', ') || `Kernel ${p.kernelId}`;
    const choice = await vscode.window.showWarningMessage(
      `${label} ${affected}?\nPID: ${p.pid}\nHost: ${hostname()}`,
      { modal: true },
      label,
    );
    if (choice !== label || disposed) return;
    try {
      const revalidate = async () => {
        const uid = process.geteuid?.();
        if (uid === undefined) throw new Error('Linux user identity is unavailable');
        assertSameKernel(p, await collector.current(p.pid), uid);
      };
      if (action === 'stop' && item.row.serverId) {
        await discovery.shutdown(item.row, revalidate);
        await vscode.window.showInformationMessage(
          `Jupyter confirmed shutdown of kernel ${p.kernelId}.`,
        );
      } else {
        await actOnKernel(p, action, (pid) => collector.current(pid));
        await vscode.window.showInformationMessage(`${label} signal sent to PID ${p.pid}.`);
      }
    } catch (error) {
      await vscode.window.showErrorMessage(
        error instanceof Error ? error.message : 'Kernel action failed.',
      );
    }
    await invalidate();
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('jnManager.refresh', () => {
      // Discovery is coalesced by refresh(); release the toolbar immediately.
      void refresh();
    }),
    vscode.commands.registerCommand('jnManager.copy', async (item: unknown) => {
      const text = copyText(item ?? tree.selection[0]);
      if (text !== undefined) await vscode.env.clipboard.writeText(text);
    }),
    ...(['interrupt', 'stop', 'forceKill'] as const).map((action) =>
      vscode.commands.registerCommand(`jnManager.${action}`, (item: unknown) =>
        runAction(item, action),
      ),
    ),
    tree.onDidChangeVisibility(() => {
      schedule();
      if (tree.visible) void refresh();
    }),
    vscode.workspace.onDidOpenNotebookDocument(() => {
      if (tree.visible) void invalidate();
    }),
    vscode.workspace.onDidCloseNotebookDocument(() => {
      if (tree.visible) void invalidate();
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('jnManager')) {
        schedule();
        void invalidate();
      }
    }),
    {
      dispose: () => {
        disposed = true;
        revision++;
        if (timer) clearInterval(timer);
      },
    },
  );
  schedule();
  void refresh();
}
