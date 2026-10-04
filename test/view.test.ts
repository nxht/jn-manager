import assert from 'node:assert/strict';
import { test, vi } from 'vitest';
import type * as vscode from 'vscode';
import { defaultHighlights } from '../src/highlights.js';
import type { KernelRow } from '../src/model.js';
import { type DetailItem, GroupItem, KernelItem, KernelView } from '../src/view.js';

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
    event = () => ({ dispose() {} });
    fire() {}
    dispose() {}
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
