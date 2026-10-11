import assert from 'node:assert/strict';
import { afterEach, test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { defaultHighlights } from '../src/highlights.js';
import type { KernelRow } from '../src/model.js';
import { copyText, type DetailItem, GroupItem, KernelItem, KernelView } from '../src/view.js';

afterEach(() => vi.restoreAllMocks());

vi.mock('vscode', () => ({
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
}));

const row: KernelRow = {
  process: {
    pid: 123,
    uid: 1000,
    startTicks: '10',
    kernelId: 'one',
    executable: '/usr/bin/python',
    state: 'S',
    cpuTicks: 10,
    rssBytes: 800,
    ageSeconds: 1,
  },
};

function kernel(view: KernelView): KernelItem {
  const group = view.getChildren()[0];
  assert.ok(group instanceof GroupItem);
  const item = view.getChildren(group)[0];
  assert.ok(item instanceof KernelItem);
  return item;
}

function icon(item: KernelItem | DetailItem): vscode.ThemeIcon {
  return item.iconPath as vscode.ThemeIcon;
}

test('zero uptime warning colors kernel and uptime icons without Explorer decoration settings', () => {
  let settings = { ...defaultHighlights, uptimeWarningHours: 0 };
  const view = new KernelView(() => settings);
  view.update([row]);
  const item = kernel(view);
  assert.equal(icon(item).id, 'notebook');
  assert.equal(icon(item).color?.id, 'jnManager.warningForeground');
  const details = view.getChildren(item) as DetailItem[];
  const uptime = details.find((detail) => detail.detail.label === 'Uptime');
  assert.ok(uptime);
  assert.equal(icon(uptime).id, 'clock');
  assert.equal(icon(uptime).color?.id, 'jnManager.warningForeground');
  for (const detail of details.filter((detail) => detail !== uptime)) {
    assert.equal(icon(detail).color, undefined);
  }
  assert.equal(uptime.command?.command, 'jnManager.copy');
  assert.equal(uptime.description, uptime.detail.value);

  settings = { ...settings, uptimeCriticalHours: 0 };
  view.update([row]);
  const critical = kernel(view);
  assert.equal(icon(critical).color?.id, 'jnManager.criticalForeground');
  const criticalUptime = (view.getChildren(critical) as DetailItem[]).find(
    (detail) => detail.detail.label === 'Uptime',
  );
  assert.ok(criticalUptime);
  assert.equal(icon(criticalUptime).color?.id, 'jnManager.criticalForeground');

  settings = { ...settings, enabled: false };
  view.update([row]);
  const disabled = kernel(view);
  assert.equal(icon(disabled).color, undefined);
  assert.equal(disabled.resourceUri, undefined);
  for (const detail of view.getChildren(disabled) as DetailItem[]) {
    assert.equal(icon(detail).color, undefined);
    assert.equal(detail.resourceUri, undefined);
  }
  view.dispose();
});

test('returning below the threshold clears warning icons on refresh', () => {
  const view = new KernelView();
  view.update([{ ...row, process: { ...row.process, ageSeconds: 86401 } }]);
  assert.equal(icon(kernel(view)).color?.id, 'jnManager.warningForeground');
  view.update([row]);
  const item = kernel(view);
  assert.equal(icon(item).color, undefined);
  for (const detail of view.getChildren(item) as DetailItem[]) {
    assert.equal(icon(detail).color, undefined);
  }
  view.dispose();
});

test('uptime advances between samples without drift and preserves identity and resource values', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const view = new KernelView();
  const sample = {
    ...row,
    serverId: 'server-one',
    serverUrl: 'http://127.0.0.1:8888',
    process: { ...row.process, ageSeconds: 59, cpuPercent: 12.5 },
  };
  view.update([sample]);
  const selected = kernel(view);
  const details = view.getChildren(selected) as DetailItem[];
  const uptime = details.find((detail) => detail.detail.label === 'Uptime');
  assert.ok(uptime);
  const events: unknown[] = [];
  view.onDidChangeTreeData((item) => events.push(item));

  clock.mockReturnValue(2000);
  view.tick();
  assert.deepEqual(events, [uptime]);
  assert.equal(selected.description, '12.5% · 0 MB · <1m');
  assert.match(selected.tooltip as string, /Uptime: 59s/);
  assert.equal(view.getChildren(selected), details);
  assert.equal(uptime.description, '1m');
  assert.equal(uptime.tooltip, '1m');
  assert.equal(uptime.collapsibleState, 0);
  const updated = kernel(view);
  assert.equal(updated, selected);
  assert.equal(updated.description, '12.5% · 0 MB · <1m');
  assert.equal(updated.id, selected.id);
  assert.equal(updated.row, selected.row);
  assert.equal(view.contains(selected.row), true);
  assert.equal(updated.row.serverId, 'server-one');
  assert.equal(updated.row.serverUrl, sample.serverUrl);
  assert.equal(copyText(uptime), '1m');
  assert.match(copyText(selected) ?? '', /Uptime: 1m\n/);
  assert.match(updated.tooltip as string, /Uptime: 59s/);

  // A delayed callback uses elapsed time, rather than adding one second per tick.
  clock.mockReturnValue(5500);
  view.tick();
  view.tick();
  assert.deepEqual(events, [uptime, uptime]);
  assert.equal(copyText(uptime), '1m 3s');
  assert.equal(kernel(view).row.process.ageSeconds, 63.5);
  assert.equal(kernel(view).description, '12.5% · 0 MB · <1m');
  assert.equal(sample.process.cpuPercent, 12.5);
  assert.equal(sample.process.rssBytes, 800);
  for (const [seconds, summary] of [
    [59.9, '<1m'],
    [60, '1m'],
    [119.9, '1m'],
    [7559, '2h 5m'],
    [97259, '1d 3h'],
  ] as const) {
    const item = new KernelItem({ ...sample, process: { ...sample.process, ageSeconds: seconds } });
    assert.equal(item.description, `12.5% · 0 MB · ${summary}`);
  }
  view.dispose();
});

test('uptime accounts for enrichment delay, updates highlights and resets on a new sample', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(3000);
  const view = new KernelView();
  view.update([{ ...row, process: { ...row.process, ageSeconds: 86400 } }], undefined, 1000);
  assert.equal(kernel(view).row.process.ageSeconds, 86402);
  assert.equal(icon(kernel(view)).color?.id, 'jnManager.warningForeground');

  view.update([{ ...row, process: { ...row.process, ageSeconds: 86399 } }]);
  const item = kernel(view);
  assert.equal(icon(item).color, undefined);
  const uptime = (view.getChildren(item) as DetailItem[]).find(
    (detail) => detail.detail.label === 'Uptime',
  );
  assert.ok(uptime);
  const events: unknown[] = [];
  view.onDidChangeTreeData((item) => events.push(item));
  clock.mockReturnValue(5000);
  view.tick();
  assert.equal(item.row.process.ageSeconds, 86401);
  assert.equal(icon(item).color, undefined);
  assert.equal(icon(uptime).color?.id, 'jnManager.warningForeground');
  assert.deepEqual(events, [uptime]);

  view.update([]);
  events.length = 0;
  clock.mockReturnValue(6000);
  view.tick();
  assert.deepEqual(events, []);
  assert.deepEqual(view.getChildren(item), []);
  assert.equal(view.contains(item.row), false);
  assert.equal(view.getChildren()[0]?.label, 'No running kernels.');
  view.dispose();
});

test('ticks do not refresh kernels whose details have not been loaded', () => {
  const clock = vi.spyOn(performance, 'now').mockReturnValue(1000);
  const view = new KernelView();
  view.update([{ ...row, process: { ...row.process } }]);
  const item = kernel(view);
  const events: unknown[] = [];
  view.onDidChangeTreeData((item) => events.push(item));
  clock.mockReturnValue(2000);
  view.tick();
  assert.deepEqual(events, []);
  const uptime = (view.getChildren(item) as DetailItem[]).find(
    (detail) => detail.detail.label === 'Uptime',
  );
  assert.ok(uptime);
  assert.equal(copyText(uptime), '2s');
  view.dispose();
});
