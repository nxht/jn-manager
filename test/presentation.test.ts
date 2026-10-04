import assert from 'node:assert/strict';
import { test } from 'vitest';
import { readKernelIdentity } from '../src/editor.js';
import type { KernelRow } from '../src/model.js';
import { kernelDetails, kernelText, kernelTitle, memoryStatus } from '../src/presentation.js';

const row: KernelRow = {
  process: {
    pid: 23456,
    uid: 1000,
    kernelId: 'v3-very-long-kernel-connection-identifier',
    startTicks: '100',
    state: 'S',
    cpuTicks: 10,
    cpuPercent: 3.2,
    rssBytes: 80 * 1024 ** 2,
    ageSeconds: 60,
    executable: '/usr/bin/python3',
    launchExecutable: '/project/.venv/bin/python',
  },
  metadata: {
    id: 'v3-very-long-kernel-connection-identifier',
    name: 'Python (project)',
    executionState: 'idle',
    notebookPaths: ['/project/deep/folder/analysis.ipynb'],
    source: 'editor',
  },
};

test('parse the actual VS Code notebook stdout format and ignore actual stderr', async () => {
  async function* outputs() {
    yield {
      items: [
        { mime: 'application/vnd.code.notebook.stderr', data: Buffer.from('ignore warning') },
      ],
    };
    yield {
      items: [
        {
          mime: 'application/vnd.code.notebook.stdout',
          data: Buffer.from('{"pid":23456,"connection_file":"/run/kernel-one.json"}\n'),
        },
      ],
    };
  }
  assert.deepEqual(await readKernelIdentity(outputs()), {
    pid: 23456,
    connectionFile: '/run/kernel-one.json',
  });
});

test('decode notebook identity paths correctly when UTF-8 characters cross stream chunks', async () => {
  const file = '/run/分析/kernel-one.json';
  const bytes = Buffer.from(JSON.stringify({ pid: 23456, connection_file: file }));
  const split = bytes.indexOf(Buffer.from('分')) + 1;
  async function* outputs() {
    for (const data of [bytes.subarray(0, split), bytes.subarray(split)])
      yield { items: [{ mime: 'application/vnd.code.notebook.stdout', data }] };
  }
  assert.equal((await readKernelIdentity(outputs()))?.connectionFile, file);
});

test('sidebar uses notebook filenames and short shared-kernel or unmapped labels', () => {
  assert.equal(kernelTitle(row), 'analysis.ipynb');
  assert.equal(kernelTitle({ ...row, metadata: undefined }), 'Python · 23456');
  assert.equal(
    kernelTitle({
      ...row,
      metadata: {
        ...row.metadata,
        id: row.process.kernelId,
        name: 'Python',
        executionState: 'idle',
        notebookPaths: ['/a/analysis.ipynb', '/b/other.ipynb'],
      },
    }),
    'analysis.ipynb +1',
  );
});

test('copyable details retain full notebook and virtual-environment paths despite short sidebar labels', () => {
  const details = kernelDetails(row);
  assert.equal(
    details.find((d) => d.label === 'Notebook')?.value,
    '/project/deep/folder/analysis.ipynb',
  );
  assert.equal(details.find((d) => d.label === 'Interpreter')?.value, '/project/.venv/bin/python');
  assert.match(kernelText(row), /Notebook: \/project\/deep\/folder\/analysis.ipynb/);
  assert.match(kernelText(row), /PID: 23456/);
});

test('compact details omit explanatory prose and unavailable metadata', () => {
  const text = kernelText({ ...row, metadata: undefined });
  assert.match(text, /CPU: 3.2%/);
  assert.match(text, /RAM: 84 MB/);
  assert.doesNotMatch(
    text,
    /one core|UID|Unavailable|Connections|mapping|age|Linux state|v3-very-long/,
  );
});

test('memory status totals processes across windows, including shared and unmapped kernels', () => {
  const shared = { ...row, metadata: { ...row.metadata, notebookPaths: ['a.ipynb', 'b.ipynb'] } };
  const unmapped = { process: { ...row.process, pid: 34567, rssBytes: 1024 ** 3 } };
  const summary = memoryStatus([shared.process, unmapped.process]);
  assert.equal(summary.text, '$(notebook) 1158 MB');
  assert.match(summary.tooltip, /2 kernel processes/);
  assert.equal(memoryStatus([]).text, '$(notebook) 0 MB');
});
