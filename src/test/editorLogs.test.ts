import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import {
  applyLaunches,
  EditorLogDiscovery,
  editorHostDirectory,
  logSessionOffset,
  notebookLaunches,
} from '../editorLogs';
import { groupKernels } from '../grouping';
import type { KernelRow } from '../model';
import { formatUptime, kernelDetails } from '../presentation';

const time = Date.parse('2026-10-03T09:35:31.437Z');
const row: KernelRow = {
  process: {
    pid: 42566,
    uid: process.geteuid?.() ?? 1000,
    startTicks: '577889',
    kernelId: 'v3-one',
    executable: '/usr/bin/python',
    state: 'S',
    cpuTicks: 0,
    rssBytes: 1024,
    ageSeconds: 60,
    createdAtEpochMs: time,
    connectionFile: '/run/kernel-v3-one.json',
  },
};
const log = `17:35:31.437 [info] Starting Kernel (Python Path: ~/project/.venv/bin/python, Venv) for '~/project/test.ipynb' (disableUI=false)
17:35:31.454 [info] Process Execution: /project/.venv/bin/python -m ipykernel_launcher --f=/run/kernel-v3-one.json
17:35:31.876 [info] Kernel successfully started`;

test('resolve notebook with exact launch identity and client timezone', () => {
  const launches = notebookLaunches(log, '2026-10-03', '/home/test', 8 * 3600000);
  assert.equal(launches.length, 1);
  assert.equal(launches[0]?.time, time);
  const result = applyLaunches([row], launches)[0];
  assert.deepEqual(result?.metadata?.notebookPaths, ['/home/test/project/test.ipynb']);
  assert.equal(result?.metadata?.source, 'editor-log');
  assert.equal(result?.currentWindow, false);
});

test('withhold stale, mismatched, conflicting or incomplete launch evidence', () => {
  const launches = notebookLaunches(log, '2026-10-03', '/home/test', 8 * 3600000);
  assert.equal(
    applyLaunches(
      [{ ...row, process: { ...row.process, createdAtEpochMs: time + 60000 } }],
      launches,
    )[0]?.metadata,
    undefined,
  );
  assert.equal(
    applyLaunches(
      [{ ...row, process: { ...row.process, connectionFile: '/run/other.json' } }],
      launches,
    )[0]?.metadata,
    undefined,
  );
  const first = launches[0];
  assert.ok(first);
  assert.equal(
    applyLaunches([row], [...launches, { ...first, notebook: '/different.ipynb' }])[0]?.metadata,
    undefined,
  );
  assert.deepEqual(notebookLaunches(log.split('\n').slice(0, 2).join('\n'), '2026-10-03'), []);
  const overlap = log.split('\n');
  overlap.splice(1, 0, overlap[0]?.replace('test.ipynb', 'other.ipynb') ?? '');
  assert.deepEqual(notebookLaunches(overlap.join('\n'), '2026-10-03'), []);
});

test('exact extension host determines current window; API metadata takes precedence', () => {
  const launches = notebookLaunches(log, '2026-10-03', '/home/test', 8 * 3600000).map((l) => ({
    ...l,
    host: '/logs/session/exthost2',
  }));
  assert.equal(
    applyLaunches([row], launches, Date.now(), '/logs/session/exthost2')[0]?.currentWindow,
    true,
  );
  assert.equal(
    applyLaunches([row], launches, Date.now(), '/logs/session/exthost4')[0]?.currentWindow,
    false,
  );
  const apiRow = {
    ...row,
    currentWindow: true,
    metadata: {
      id: 'v3-one',
      name: 'Python',
      executionState: 'idle',
      notebookPaths: ['/renamed.ipynb'],
      source: 'editor' as const,
    },
  };
  assert.equal(applyLaunches([apiRow], launches)[0], apiRow);
  assert.equal(
    editorHostDirectory('/logs/session/exthost2/publisher.extension'),
    '/logs/session/exthost2',
  );
  assert.equal(editorHostDirectory('/unrelated/logs'), undefined);
  assert.equal(
    logSessionOffset('20261003T173413', Date.parse('2026-10-03T09:34:13.773Z')),
    8 * 3600000,
  );
  assert.equal(logSessionOffset('bad', time), undefined);
});

test('owned log discovery reads completed launches and rejects symbolic link logs', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jn-editor-logs-'));
  try {
    const now = new Date();
    const iso = now.toISOString();
    const stamp = iso.slice(0, 19).replace(/[-:]/g, '');
    const host = path.join(root, stamp, 'exthost2');
    const output = path.join(host, 'output_logging_fixture');
    await fs.mkdir(output, { recursive: true });
    const text = log.replaceAll('17:35:31.437', iso.slice(11, 23));
    const file = path.join(output, '1-Jupyter.log');
    await fs.writeFile(file, text);
    const current = { ...row, process: { ...row.process, createdAtEpochMs: now.getTime() } };
    const discovery = new EditorLogDiscovery([root], process.geteuid?.(), '/home/test', host);
    assert.equal((await discovery.enrich([current]))[0]?.currentWindow, true);
    await fs.rename(file, path.join(root, 'external.log'));
    await fs.symlink(path.join(root, 'external.log'), file);
    assert.equal((await discovery.enrich([current]))[0]?.metadata, undefined);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test('current window is first and takes priority over server grouping', () => {
  const server = { ...row, serverId: 'a', serverUrl: 'http://localhost:8888/' };
  const groups = groupKernels([
    server,
    { ...server, process: { ...row.process, pid: 2 } },
    { ...server, currentWindow: true },
    { ...row, serverId: 'b', serverUrl: 'http://localhost:8889/' },
    row,
  ]);
  assert.equal(groups[0]?.label, 'Current window');
  assert.equal(groups[0]?.rows.length, 1);
  assert.equal(groups.find((g) => g.id === 'server:a')?.rows.length, 2);
  assert.equal(groups.find((g) => g.id === 'server:b')?.rows.length, 1);
  assert.equal(groups.find((g) => g.id === 'editor')?.rows.length, 1);
  assert.deepEqual(groupKernels([]), []);
});

test('uptime is compact, copyable and handles seconds through days', () => {
  assert.equal(formatUptime(0), '0s');
  assert.equal(formatUptime(61.9), '1m 1s');
  assert.equal(formatUptime(3601), '1h 1s');
  assert.equal(formatUptime(90061), '1d 1h 1m 1s');
  assert.equal(kernelDetails(row).find((d) => d.label === 'Uptime')?.value, '1m');
});
