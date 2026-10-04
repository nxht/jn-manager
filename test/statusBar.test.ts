import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { RuntimeDiscovery } from '../src/discovery.js';
import { EditorLogDiscovery } from '../src/editorLogs.js';
import type { KernelProcess, KernelRow } from '../src/model.js';
import { LinuxCollector } from '../src/proc.js';

test('status memory refreshes with the sidebar hidden, ignores filters and clears on failure', async (t) => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  t.onTestFinished(() => {
    vi.useRealTimers();
    vi.doUnmock('vscode');
    vi.doUnmock('../src/view.js');
    vi.doUnmock('node:os');
  });
  const disposable = { dispose() {} };
  const subscriptions: { dispose(): void }[] = [];
  let shown = false;
  const status = {
    text: '',
    name: '',
    tooltip: '',
    command: '',
    backgroundColor: undefined as { id: string } | undefined,
    show() {
      shown = true;
    },
    hide() {
      shown = false;
    },
    dispose() {
      shown = false;
    },
  };
  const background = () => status.backgroundColor?.id;
  let visibilityChanged = () => {};
  const tree = {
    ...disposable,
    visible: false,
    description: '',
    onDidChangeVisibility(callback: () => void) {
      visibilityChanged = callback;
      return disposable;
    },
  };
  let visibleRows: KernelRow[] = [];
  class View {
    update(rows: KernelRow[]) {
      visibleRows = rows;
    }
    dispose() {}
  }
  const settings: Record<string, unknown> = {};
  let configurationChanged = (_event: { affectsConfiguration(section: string): boolean }) => {};
  const api = {
    ThemeColor: class {
      constructor(public id: string) {}
    },
    StatusBarAlignment: { Right: 2 },
    window: {
      createTreeView: () => tree,
      createStatusBarItem: () => status,
      registerFileDecorationProvider: () => disposable,
    },
    commands: { registerCommand: () => disposable },
    workspace: {
      notebookDocuments: [],
      getConfiguration: () => ({
        get: (key: string, fallback: unknown) =>
          key === 'includeOtherWindows' ? false : (settings[key] ?? fallback),
      }),
      onDidOpenNotebookDocument: () => disposable,
      onDidCloseNotebookDocument: () => disposable,
      onDidChangeConfiguration: (callback: typeof configurationChanged) => {
        configurationChanged = callback;
        return disposable;
      },
    },
  };
  vi.doMock('node:os', async () => ({
    ...(await vi.importActual<typeof import('node:os')>('node:os')),
    totalmem: () => 1_000_000_000,
  }));
  vi.doMock('vscode', () => api);
  vi.doMock('../src/view.js', () => ({
    KernelView: View,
    KernelItem: class {},
    highlightDecorations: {},
  }));
  let scans = 0;
  let fail = false;
  let bytes = 128 * 1024 ** 2;
  let secondBytes = 0;
  const process = {
    pid: 123456,
    uid: 1000,
    startTicks: '100',
    kernelId: 'shared',
    executable: '/env/python',
    state: 'S',
    cpuTicks: 0,
    rssBytes: bytes,
    ageSeconds: 1,
  };
  vi.spyOn(LinuxCollector.prototype, 'snapshot').mockImplementation(async () => {
    scans++;
    if (fail) throw new Error('Fixture collection failure');
    return [
      { ...process, rssBytes: bytes },
      ...(secondBytes
        ? [{ ...process, pid: 234567, kernelId: 'second', rssBytes: secondBytes }]
        : []),
    ];
  });
  const discovery = vi
    .spyOn(RuntimeDiscovery.prototype, 'enrich')
    .mockImplementation(async (processes: KernelProcess[]) =>
      processes.map((process) => ({
        process,
        metadata: {
          id: process.kernelId,
          name: 'Python',
          executionState: 'idle',
          notebookPaths: ['a.ipynb', 'b.ipynb'],
          source: 'editor' as const,
        },
      })),
    );
  vi.spyOn(EditorLogDiscovery.prototype, 'enrich').mockImplementation(
    async (rows: KernelRow[]) => rows,
  );
  const { activate } = await import('../src/extension.js');
  activate({
    subscriptions,
    logUri: { fsPath: '/logs/session/exthost1/extension' },
  } as unknown as vscode.ExtensionContext);
  t.onTestFinished(() => {
    for (const subscription of subscriptions) subscription.dispose();
  });
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  await settle();
  assert.equal(shown, true);
  assert.equal(status.text, '$(notebook) 134 MB');
  assert.equal(status.command, 'jnManager.kernels.focus');
  assert.equal(background(), undefined);
  assert.equal(discovery.mock.calls.length, 0);
  assert.equal(tree.description, '00:05');
  vi.advanceTimersByTime(2000);
  assert.equal(tree.description, '00:03');
  assert.equal(scans, 1);
  bytes = 512 * 1024 ** 2;
  vi.advanceTimersByTime(3000);
  await settle();
  assert.equal(tree.description, '00:05');
  assert.equal(scans, 2);
  assert.equal(status.text, '$(notebook) 537 MB');
  assert.equal(discovery.mock.calls.length, 0);
  tree.visible = true;
  visibilityChanged();
  await settle();
  assert.equal(discovery.mock.calls.length, 1);
  assert.deepEqual(visibleRows, []);
  assert.equal(status.text, '$(notebook) 537 MB');
  tree.visible = false;
  visibilityChanged();
  const refreshStatus = async () => {
    vi.advanceTimersByTime(5000);
    await settle();
  };
  bytes = 425_000_000;
  secondBytes = 425_000_000;
  await refreshStatus();
  assert.equal(status.text, '$(warning) 850 MB');
  assert.equal(background(), 'statusBarItem.warningBackground');
  assert.match(status.tooltip, /2 kernel processes/);
  assert.match(status.tooltip, /85.0% of host RAM/);
  assert.match(status.tooltip, /Warning/);

  secondBytes = 500_000_000;
  await refreshStatus();
  assert.equal(status.text, '$(error) 925 MB');
  assert.equal(background(), 'statusBarItem.errorBackground');
  assert.match(status.tooltip, /Critical/);

  secondBytes = 0;
  await refreshStatus();
  assert.equal(status.text, '$(notebook) 425 MB');
  assert.equal(background(), undefined);
  assert.doesNotMatch(status.tooltip, /Warning|Critical/);

  settings['highlights.totalMemoryWarningPercent'] = 0;
  configurationChanged({ affectsConfiguration: () => true });
  await settle();
  assert.equal(status.text, '$(warning) 425 MB');
  assert.equal(background(), 'statusBarItem.warningBackground');

  settings['highlights.enabled'] = false;
  configurationChanged({ affectsConfiguration: () => true });
  await settle();
  assert.equal(status.text, '$(notebook) 425 MB');
  assert.equal(background(), undefined);

  settings['highlights.enabled'] = true;
  configurationChanged({ affectsConfiguration: () => true });
  await settle();
  assert.equal(background(), 'statusBarItem.warningBackground');
  fail = true;
  vi.advanceTimersByTime(5000);
  await settle();
  assert.equal(shown, false);
  assert.equal(background(), undefined);
  for (const subscription of subscriptions) subscription.dispose();
  const lastScans = scans;
  vi.advanceTimersByTime(5000);
  await settle();
  assert.equal(scans, lastScans);
});
