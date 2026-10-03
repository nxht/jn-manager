import assert from 'node:assert/strict';
import { test } from 'vitest';
import { groupKernels, visibleKernels } from '../src/grouping';
import type { KernelRow } from '../src/model';

const base: KernelRow = {
  process: {
    pid: 100,
    uid: 1000,
    startTicks: '1',
    kernelId: 'plain',
    executable: '/usr/bin/python',
    state: 'S',
    cpuTicks: 0,
    rssBytes: 100,
    ageSeconds: 1,
  },
};
const server: KernelRow = { ...base, serverId: 'server-one', serverUrl: 'http://localhost:8888/' };
const current: KernelRow = { ...server, currentWindow: true };
const editor: KernelRow = { ...base, process: { ...base.process, kernelId: 'v3-editor' } };
const loggedEditor: KernelRow = {
  ...base,
  metadata: {
    id: 'plain',
    name: 'Python',
    executionState: 'idle',
    notebookPaths: ['/other.ipynb'],
    source: 'editor-log',
  },
};
const rows = [current, server, editor, loggedEditor, base];

test('visibility toggles independently filter server and other editor groups', () => {
  assert.deepEqual(
    visibleKernels(rows, { includeExternalServers: true, includeOtherWindows: true }),
    rows,
  );
  assert.deepEqual(
    visibleKernels(rows, { includeExternalServers: false, includeOtherWindows: true }),
    [current, editor, loggedEditor, base],
  );
  assert.deepEqual(
    visibleKernels(rows, { includeExternalServers: true, includeOtherWindows: false }),
    [current, server, base],
  );
  assert.deepEqual(
    visibleKernels(rows, { includeExternalServers: false, includeOtherWindows: false }),
    [current, base],
  );
});

test('current-window membership takes precedence and filtering preserves server routing identity', () => {
  const result = visibleKernels([current, server], {
    includeExternalServers: false,
    includeOtherWindows: false,
  });
  assert.equal(result.length, 1);
  assert.equal(result[0], current);
  assert.equal(result[0]?.serverId, 'server-one');
  assert.equal(result[0]?.serverUrl, server.serverUrl);
  assert.equal(groupKernels(result)[0]?.id, 'current-window');
});

test('server-backed editor kernels follow the server visibility setting', () => {
  const attached = { ...loggedEditor, serverId: server.serverId, serverUrl: server.serverUrl };
  assert.deepEqual(
    visibleKernels([attached], { includeExternalServers: true, includeOtherWindows: false }),
    [attached],
  );
  assert.deepEqual(
    visibleKernels([attached], { includeExternalServers: false, includeOtherWindows: true }),
    [],
  );
});

test('unclassified kernels remain visible and empty inputs stay empty', () => {
  const settings = { includeExternalServers: false, includeOtherWindows: false };
  assert.deepEqual(visibleKernels([base], settings), [base]);
  assert.equal(groupKernels(visibleKernels([base], settings))[0]?.id, 'other');
  assert.deepEqual(visibleKernels([], settings), []);
});
