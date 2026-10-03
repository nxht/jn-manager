import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { RuntimeDiscovery } from '../src/discovery';
import { EditorLogDiscovery } from '../src/editorLogs';
import type { KernelProcess, KernelRow } from '../src/model';
import { LinuxCollector } from '../src/proc';

test('status memory refreshes with the sidebar hidden, ignores filters and clears on failure', async (t) => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  t.onTestFinished(() => {
    vi.useRealTimers();
    vi.doUnmock('vscode');
    vi.doUnmock('../src/view');
  });
  const disposable = { dispose() {} };
  const subscriptions: { dispose(): void }[] = [];
  let shown = false;
  const status = {
    text: '',
    name: '',
    tooltip: '',
    command: '',
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
  const api = {
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
        get: (key: string, fallback: unknown) => (key === 'includeOtherWindows' ? false : fallback),
      }),
      onDidOpenNotebookDocument: () => disposable,
      onDidCloseNotebookDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
  };
  vi.doMock('vscode', () => api);
  vi.doMock('../src/view', () => ({
    KernelView: View,
    KernelItem: class {},
    highlightDecorations: {},
  }));
  let scans = 0;
  let fail = false;
  let bytes = 128 * 1024 ** 2;
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
    return [{ ...process, rssBytes: bytes }];
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
  const { activate } = await import('../src/extension');
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
  fail = true;
  vi.advanceTimersByTime(5000);
  await settle();
  assert.equal(shown, false);
  for (const subscription of subscriptions) subscription.dispose();
  const lastScans = scans;
  vi.advanceTimersByTime(5000);
  await settle();
  assert.equal(scans, lastScans);
});
