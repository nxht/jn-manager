import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { actOnKernel } from '../actions';
import { JupyterClient, normalizeServerUrl, parseMetadata } from '../jupyter';
import { type KernelMetadata, type KernelProcess, mergeKernels } from '../model';
import { kernelIdFromArgs, LinuxCollector, parseStat } from '../proc';

const uid = process.geteuid?.() ?? 1000;
const kernel: KernelProcess = {
  pid: 876543,
  uid,
  startTicks: '100',
  kernelId: 'abc-123',
  executable: '/env/bin/python',
  state: 'S',
  cpuTicks: 25,
  rssBytes: 1024,
  ageSeconds: 10,
};
const metadata: KernelMetadata = {
  id: 'abc-123',
  name: 'python3',
  executionState: 'idle',
  connections: 1,
  lastActivity: '2026-10-03T00:00:00Z',
  notebookPaths: ['analysis.ipynb'],
};

function statText(ticks = 25, start = '100', state = 'S'): string {
  const fields = Array<string>(22).fill('0');
  fields[0] = state;
  fields[11] = String(ticks);
  fields[12] = '0';
  fields[19] = start;
  return `${kernel.pid} (python (worker)) ${fields.join(' ')}`;
}

test('accept explicit kernels with separated and equals connection flags', () => {
  assert.equal(
    kernelIdFromArgs([
      '/env/bin/python3.11',
      '-m',
      'ipykernel_launcher',
      '-f',
      '/run/kernel-abc-123.json',
    ]),
    'abc-123',
  );
  assert.equal(
    kernelIdFromArgs(['python', 'ipykernel_launcher.py', '--f=/run/kernel-abc-123.json']),
    'abc-123',
  );
});

test('exclude Python jobs, servers, misleading arguments, and missing connection files', () => {
  for (const args of [
    ['python', 'train.py'],
    ['python', '-m', 'jupyterlab'],
    ['python', 'train.py', '-m', 'ipykernel_launcher', '-f', 'kernel-abc.json'],
    ['python', 'train.py', 'ipykernel_launcher.py', '-f', 'kernel-abc.json'],
    ['python', '-m', 'ipykernel_launcher'],
    ['node', '-m', 'ipykernel_launcher', '-f', 'kernel-abc.json'],
    ['python', '-m', 'ipykernel_launcher', '-f', 'connection.json'],
  ])
    assert.equal(kernelIdFromArgs(args), undefined);
});

test('parse process names containing spaces and parentheses without shifting fields', () => {
  assert.deepEqual(parseStat(statText()), { state: 'S', cpuTicks: 25, startTicks: '100' });
  assert.throws(() => parseStat('invalid'), /Invalid/);
});

test('API-only kernels are excluded and exact identity joins supply notebook metadata', () => {
  assert.deepEqual(mergeKernels([], [metadata]), []);
  assert.equal(mergeKernels([kernel], [metadata])[0]?.metadata, metadata);
  assert.equal(mergeKernels([kernel], [{ ...metadata, id: 'different' }])[0]?.metadata, undefined);
});

test('duplicate process or server IDs suppress ambiguous notebook mapping', () => {
  assert(
    mergeKernels([kernel, { ...kernel, pid: kernel.pid + 1 }], [metadata]).every(
      (r) => !r.metadata,
    ),
  );
  assert.equal(mergeKernels([kernel], [metadata, metadata])[0]?.metadata, undefined);
});

test('each lifecycle action signals the revalidated kernel, using a stub instead of real signals', async () => {
  const expected = { interrupt: 'SIGINT', stop: 'SIGTERM', forceKill: 'SIGKILL' } as const;
  for (const action of ['interrupt', 'stop', 'forceKill'] as const) {
    const calls: unknown[] = [];
    await actOnKernel(
      kernel,
      action,
      async () => ({ ...kernel }),
      (pid, signal) => calls.push([pid, signal]),
      uid,
    );
    assert.deepEqual(calls, [[kernel.pid, expected[action]]]);
  }
});

test('stale PID, changed owner, changed kernel, changed interpreter, and dead processes never receive signals', async () => {
  const variants = [
    undefined,
    { ...kernel, startTicks: '200' },
    { ...kernel, uid: uid + 1 },
    { ...kernel, pid: 1 },
    { ...kernel, kernelId: 'other' },
    { ...kernel, executable: '/other/python' },
    { ...kernel, state: 'Z' },
    { ...kernel, state: 'X' },
  ];
  for (const actual of variants) {
    let called = false;
    await assert.rejects(
      actOnKernel(
        kernel,
        'forceKill',
        async () => actual,
        () => {
          called = true;
        },
        uid,
      ),
      /identity or ownership/,
    );
    assert.equal(called, false);
  }
});

test('PID 1, self, and forged expected ownership are protected', async () => {
  for (const p of [
    { ...kernel, pid: 1 },
    { ...kernel, pid: process.pid },
    { ...kernel, uid: uid + 1 },
  ]) {
    await assert.rejects(
      actOnKernel(
        p,
        'stop',
        async () => p,
        () => assert.fail('must not signal'),
        uid,
      ),
    );
  }
});

test('permission errors are surfaced instead of reporting a successful stop', async () => {
  await assert.rejects(
    actOnKernel(
      kernel,
      'stop',
      async () => kernel,
      () => {
        throw new Error('EPERM');
      },
      uid,
    ),
    /EPERM/,
  );
});

test('mapped stop uses the server shutdown callback after ownership revalidation', async () => {
  const calls: string[] = [];
  await actOnKernel(
    kernel,
    'stop',
    async () => {
      calls.push('revalidate');
      return kernel;
    },
    () => assert.fail('server stop must not signal'),
    uid,
    async (id) => {
      calls.push(id);
    },
  );
  assert.deepEqual(calls, ['revalidate', kernel.kernelId]);
});

test('server shutdown cannot bypass ownership checks or silently fall back to signals', async () => {
  await assert.rejects(
    actOnKernel(
      kernel,
      'stop',
      async () => ({ ...kernel, uid: uid + 1 }),
      () => assert.fail('must not signal'),
      uid,
      async () => assert.fail('must not shutdown'),
    ),
  );
  await assert.rejects(
    actOnKernel(
      kernel,
      'stop',
      async () => kernel,
      () => assert.fail('must not fall back'),
      uid,
      async () => {
        throw new Error('HTTP 403');
      },
    ),
    /HTTP 403/,
  );
});

test('Jupyter shutdown sends DELETE with token headers and accepts only confirmed shutdown', async () => {
  const request: typeof fetch = async (url, options) => {
    assert.equal(String(url), 'https://example.com/user/alice/api/kernels/abc-123');
    assert.equal(options?.method, 'DELETE');
    assert.equal(options?.redirect, 'error');
    assert.deepEqual(options?.headers, { Authorization: 'token secret' });
    return new Response(null, { status: 204 });
  };
  const client = new JupyterClient('https://example.com/user/alice', 'secret', request);
  await client.shutdown('abc-123');
  await assert.rejects(client.shutdown('../other'), /Invalid kernel ID/);
  const forbidden: typeof fetch = async () => new Response('secret', { status: 403 });
  await assert.rejects(
    new JupyterClient('https://example.com', 'secret', forbidden).shutdown('abc-123'),
    /HTTP 403/,
  );
});

async function fixture(): Promise<{ root: string; dir: string }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jn-manager-test-'));
  const dir = path.join(root, String(kernel.pid));
  await fs.mkdir(dir);
  await fs.writeFile(path.join(root, 'uptime'), '1000.00 0.00');
  await fs.writeFile(
    path.join(dir, 'status'),
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nVmRSS:\t2048 kB\n`,
  );
  await fs.writeFile(
    path.join(dir, 'cmdline'),
    '/env/bin/python\0-m\0ipykernel_launcher\0-f\0/run/kernel-abc-123.json\0',
  );
  await fs.writeFile(path.join(dir, 'stat'), statText());
  await fs.symlink('/env/bin/python', path.join(dir, 'exe'));
  await fs.symlink('/workspace', path.join(dir, 'cwd'));
  return { root, dir };
}

test('collector discovers owned kernels, samples CPU, and resets samples on PID reuse', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux collector');
  const { root, dir } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const collector = new LinuxCollector(root, uid, 100);
  const first = await collector.snapshot();
  assert.equal(first.length, 1);
  assert.equal(first[0]?.cpuPercent, undefined);
  assert.equal(first[0]?.rssBytes, 2048 * 1024);
  assert.equal(first[0]?.ageSeconds, 999);
  await fs.writeFile(path.join(dir, 'stat'), statText(30));
  assert(((await collector.snapshot())[0]?.cpuPercent ?? 0) > 0);
  await fs.writeFile(path.join(dir, 'stat'), statText(1, '999'));
  assert.equal((await collector.snapshot())[0]?.cpuPercent, undefined);
});

test('collector excludes other directory owners before reading process contents', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux collector');
  const { root, dir } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  await fs.writeFile(path.join(dir, 'stat'), 'invalid stat would throw if read');
  assert.deepEqual(await new LinuxCollector(root, uid + 1, 100).snapshot(), []);
});

test('collector excludes mismatched effective UID, zombies, non-kernel jobs, and vanished PIDs', async (t) => {
  if (process.platform !== 'linux') return t.skip('Linux collector');
  const { root, dir } = await fixture();
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const collector = new LinuxCollector(root, uid, 100);
  await fs.writeFile(
    path.join(dir, 'status'),
    `Uid:\t${uid}\t${uid + 1}\t${uid}\t${uid}\nVmRSS:\t2048 kB\n`,
  );
  assert.deepEqual(await collector.snapshot(), []);
  await fs.writeFile(
    path.join(dir, 'status'),
    `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nVmRSS:\t2048 kB\n`,
  );
  await fs.writeFile(path.join(dir, 'stat'), statText(25, '100', 'Z'));
  assert.deepEqual(await collector.snapshot(), []);
  await fs.writeFile(path.join(dir, 'stat'), statText());
  await fs.writeFile(path.join(dir, 'cmdline'), 'python\0train.py\0');
  assert.deepEqual(await collector.snapshot(), []);
  await fs.rm(dir, { recursive: true });
  assert.equal(await collector.current(kernel.pid), undefined);
});

test('normalize server base paths and reject URLs carrying credentials or insecure remote transport', () => {
  assert.equal(
    normalizeServerUrl('https://example.com/user/alice'),
    'https://example.com/user/alice/',
  );
  assert.equal(normalizeServerUrl('http://127.0.0.1:8888/'), 'http://127.0.0.1:8888/');
  for (const url of [
    'http://example.com',
    'ftp://localhost',
    'https://u:p@example.com',
    'https://example.com?token=secret',
    'https://example.com#secret',
  ]) {
    assert.throws(() => normalizeServerUrl(url));
  }
});

test('map all notebook sessions sharing a kernel, deduplicate paths, and ignore consoles', () => {
  const kernels = [
    {
      id: 'abc-123',
      name: 'python3',
      execution_state: 'busy',
      connections: 2,
      last_activity: metadata.lastActivity,
    },
  ];
  const sessions = [
    { type: 'notebook', path: 'a.ipynb', kernel: { id: 'abc-123' } },
    { type: 'notebook', path: 'b.ipynb', kernel: { id: 'abc-123' } },
    { type: 'notebook', path: 'a.ipynb', kernel: { id: 'abc-123' } },
    { type: 'console', path: 'console', kernel: { id: 'abc-123' } },
  ];
  assert.deepEqual(parseMetadata(kernels, sessions)[0]?.notebookPaths, ['a.ipynb', 'b.ipynb']);
  assert.throws(() => parseMetadata({}, sessions));
  assert.throws(() => parseMetadata([{ ...kernels[0], connections: -1 }], sessions));
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/user/alice/`;
}

test('HTTP client preserves JupyterHub base path and uses token headers instead of URL tokens', async (t) => {
  const requests: string[] = [];
  const server = createServer((req, res) => {
    requests.push(req.url ?? '');
    assert.equal(req.headers.authorization, 'token secret');
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url?.endsWith('/kernels')
          ? [
              {
                id: metadata.id,
                name: metadata.name,
                execution_state: 'idle',
                connections: 1,
                last_activity: metadata.lastActivity,
              },
            ]
          : [{ type: 'notebook', path: 'analysis.ipynb', kernel: { id: metadata.id } }],
      ),
    );
  });
  const url = await listen(server);
  t.after(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  assert.deepEqual(await new JupyterClient(url, 'secret').metadata(), [metadata]);
  assert.deepEqual(requests.sort(), ['/user/alice/api/kernels', '/user/alice/api/sessions']);
});

test('authentication failures expose status without exposing response bodies or secrets', async () => {
  const request: typeof fetch = async () =>
    new Response('token secret and sensitive response', { status: 403 });
  await assert.rejects(
    new JupyterClient('https://example.com', 'secret', request).metadata(),
    (error) => {
      assert.match((error as Error).message, /HTTP 403/);
      assert.doesNotMatch((error as Error).message, /secret|sensitive/);
      return true;
    },
  );
});

test('request redirects are disabled and network errors are sanitized', async () => {
  const request: typeof fetch = async (_url, options) => {
    assert.equal(options?.redirect, 'error');
    throw new Error('secret network details');
  };
  await assert.rejects(
    new JupyterClient('https://example.com', 'secret', request).metadata(),
    /request failed or timed out/,
  );
});

test('reject malformed JSON and excessively large API responses', async () => {
  for (const body of ['not-json', 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    const request: typeof fetch = async () => new Response(body);
    await assert.rejects(
      new JupyterClient('https://example.com', '', request).metadata(),
      /invalid JSON|too large/,
    );
  }
});
