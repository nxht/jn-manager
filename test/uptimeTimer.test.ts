import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { RuntimeDiscovery } from '../src/discovery.js';
import { EditorLogDiscovery } from '../src/editorLogs.js';
import { LinuxCollector } from '../src/proc.js';
import type { DetailItem, GroupItem, KernelItem, KernelView } from '../src/view.js';

test('the activation timer updates the registered uptime leaf between discovery refreshes', async (t) => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date', 'performance'] });
  const subscriptions: vscode.Disposable[] = [];
  t.onTestFinished(() => {
    for (const subscription of subscriptions) subscription.dispose();
    vi.useRealTimers();
    vi.doUnmock('vscode');
  });
  const disposable = { dispose() {} };
  let provider: KernelView | undefined;
  let visibilityChanged = () => {};
  const tree = {
    ...disposable,
    visible: true,
    selection: [],
    description: '',
    onDidChangeVisibility(callback: () => void) {
      visibilityChanged = callback;
      return disposable;
    },
  };
  vi.doMock('vscode', () => ({
    TreeItem: class {
      constructor(
        public label: string,
        public collapsibleState: number,
      ) {}
    },
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class {
      constructor(
        public id: string,
        public color?: { id: string },
      ) {}
    },
    ThemeColor: class {
      constructor(public id: string) {}
    },
    Uri: { from: (value: unknown) => value },
    EventEmitter: class {
      private listeners = new Set<(value: unknown) => void>();
      event = (listener: (value: unknown) => void) => {
        this.listeners.add(listener);
        return { dispose: () => this.listeners.delete(listener) };
      };
      fire(value: unknown) {
        for (const listener of this.listeners) listener(value);
      }
      dispose() {
        this.listeners.clear();
      }
    },
    StatusBarAlignment: { Right: 2 },
    window: {
      createTreeView: (_id: string, options: { treeDataProvider: KernelView }) => {
        provider = options.treeDataProvider;
        return tree;
      },
      createStatusBarItem: () => ({ ...disposable, show() {}, hide() {} }),
      registerFileDecorationProvider: () => disposable,
    },
    commands: { registerCommand: () => disposable },
    workspace: {
      notebookDocuments: [],
      getConfiguration: () => ({ get: (_key: string, fallback: unknown) => fallback }),
      onDidOpenNotebookDocument: () => disposable,
      onDidCloseNotebookDocument: () => disposable,
      onDidChangeConfiguration: () => disposable,
    },
  }));
  const snapshot = vi.spyOn(LinuxCollector.prototype, 'snapshot').mockImplementation(async () => [
    {
      pid: 123,
      uid: 1000,
      startTicks: '100',
      kernelId: 'fixture',
      executable: '/env/python',
      state: 'S',
      cpuTicks: 0,
      rssBytes: 800,
      ageSeconds: 10 + performance.now() / 1000,
    },
  ]);
  vi.spyOn(RuntimeDiscovery.prototype, 'enrich').mockImplementation(async (processes) =>
    processes.map((process) => ({ process })),
  );
  vi.spyOn(EditorLogDiscovery.prototype, 'enrich').mockImplementation(async (rows) => rows);
  const { activate } = await import('../src/extension.js');
  activate({
    subscriptions,
    logUri: { fsPath: '/logs/session/exthost1/extension' },
  } as unknown as vscode.ExtensionContext);
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  await settle();
  assert.ok(provider);
  const view = provider;
  const group = view.getChildren()[0] as GroupItem;
  const kernel = view.getChildren(group)[0] as KernelItem;
  const details = view.getChildren(kernel) as DetailItem[];
  const uptime = details.find((detail) => detail.detail.label === 'Uptime');
  assert.ok(uptime);
  const events: unknown[] = [];
  view.onDidChangeTreeData((item) => events.push(item));
  // VS Code identifies changes by the registered element objects, including ancestors.
  assert.equal(view.getChildren()[0], group);
  assert.equal(view.getChildren(group)[0], kernel);
  assert.equal(view.getChildren(kernel), details);
  assert.equal(uptime.description, '10s');
  for (let second = 1; second <= 4; second++) {
    vi.advanceTimersByTime(1000);
    await settle();
    assert.equal(snapshot.mock.calls.length, 1);
    assert.equal(uptime.description, `${10 + second}s`);
    assert.equal(view.getTreeItem(uptime).description, `${10 + second}s`);
    assert.equal(events[second - 1], uptime);
    assert.equal(kernel.description, '0 MB · <1m');
  }
  vi.advanceTimersByTime(1000);
  await settle();
  assert.equal(snapshot.mock.calls.length, 2);
  assert.equal(events.at(-1), undefined);
  const nextGroup = view.getChildren()[0] as GroupItem;
  const nextKernel = view.getChildren(nextGroup)[0] as KernelItem;
  const nextUptime = (view.getChildren(nextKernel) as DetailItem[]).find(
    (detail) => detail.detail.label === 'Uptime',
  );
  assert.ok(nextUptime);
  assert.equal(nextUptime.id, uptime.id);
  events.length = 0;
  vi.advanceTimersByTime(1000);
  await settle();
  assert.equal(snapshot.mock.calls.length, 2);
  assert.equal(nextUptime.description, '16s');
  assert.deepEqual(events, [nextUptime]);
  assert.equal(uptime.description, '15s');
  tree.visible = false;
  visibilityChanged();
  events.length = 0;
  vi.advanceTimersByTime(1000);
  await settle();
  assert.deepEqual(events, []);
});
