import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import * as os from 'node:os';
import * as path from 'node:path';
import { test } from 'vitest';
import { localServerUrl, RuntimeDiscovery, runtimeDirectories } from '../src/discovery.js';
import { type EditorKernel, EditorTracker, readKernelIdentity } from '../src/editor.js';
import type { KernelProcess, KernelRow } from '../src/model.js';
import { kernelLaunchFromArgs } from '../src/proc.js';

const uid = process.geteuid?.() ?? 1000;
const p: KernelProcess = {
  pid: 777777,
  uid,
  startTicks: '100',
  kernelId: 'one',
  executable: '/env/bin/python',
  connectionFile: '/run/kernel-one.json',
  cpuTicks: 5,
  rssBytes: 1000,
  ageSeconds: 30,
  state: 'S',
};
const notebook = {
  uri: 'file:///project/a.ipynb',
  path: '/project/a.ipynb',
  name: 'Python (project)',
};

function editorKernel(status = 'idle'): EditorKernel {
  return {
    handle: {},
    status,
    language: 'python',
    identity: async () => ({ pid: p.pid, connectionFile: p.connectionFile ?? '' }),
  };
}

test('support VS Code Python flags and quoted connection-file paths without accepting unrelated scripts', () => {
  assert.deepEqual(
    kernelLaunchFromArgs([
      'python',
      '-Xfrozen_modules=off',
      '-m',
      'ipykernel_launcher',
      '--f="/run/a b/kernel-one.json"',
    ]),
    { kernelId: 'one', connectionFile: '/run/a b/kernel-one.json' },
  );
  assert.equal(
    kernelLaunchFromArgs([
      'python',
      '-u',
      '-X',
      'frozen_modules=off',
      '-m',
      'ipykernel_launcher',
      '-f',
      '/run/kernel-one.json',
    ])?.kernelId,
    'one',
  );
  assert.equal(
    kernelLaunchFromArgs([
      'python',
      'train.py',
      '-Xfrozen_modules=off',
      '-m',
      'ipykernel_launcher',
      '-f',
      '/run/kernel-one.json',
    ]),
    undefined,
  );
});

test('runtime directories include both process environments even when extension-host variables differ', () => {
  const dirs = runtimeDirectories(
    [{ ...p, connectionFile: '/custom/conda/runtime/kernel-one.json' }],
    {
      JUPYTER_RUNTIME_DIR: '/env/runtime',
      XDG_RUNTIME_DIR: '/run/user/1000',
      XDG_DATA_HOME: '/data',
    },
    '/home/alice',
  );
  assert(dirs.includes('/custom/conda/runtime'));
  assert(dirs.includes('/env/runtime'));
  assert(dirs.includes('/run/user/1000/jupyter/runtime'));
  assert(dirs.includes('/data/jupyter/runtime'));
});

test('runtime credentials can only target loopback URLs', () => {
  assert.equal(
    localServerUrl('http://0.0.0.0:8888/user/alice/'),
    'http://127.0.0.1:8888/user/alice/',
  );
  assert.equal(localServerUrl('http://[::]:8888/'), 'http://[::1]:8888/');
  for (const url of [
    'https://outside.example',
    'http://127.0.0.1:8888/?token=secret',
    'http://user:pass@localhost:8888/',
  ])
    assert.throws(() => localServerUrl(url));
});

test('editor diagnostic parser accepts only bounded PID/connection-file output', async () => {
  async function* outputs(text: string) {
    yield {
      items: [{ mime: 'application/x.notebook.stream.stderr', data: Buffer.from('ignored') }],
    };
    yield {
      items: [
        { mime: 'application/x.notebook.stream.stdout', data: Buffer.from(text.slice(0, 5)) },
      ],
    };
    yield {
      items: [{ mime: 'application/x.notebook.stream.stdout', data: Buffer.from(text.slice(5)) }],
    };
  }
  assert.deepEqual(
    await readKernelIdentity(
      outputs(JSON.stringify({ pid: p.pid, connection_file: p.connectionFile })),
    ),
    { pid: p.pid, connectionFile: p.connectionFile },
  );
  for (const value of [
    'invalid',
    'x'.repeat(5000),
    '{"pid":1,"connection_file":"/run/file"}',
    '{"pid":777777,"connection_file":"relative"}',
  ])
    assert.equal(await readKernelIdentity(outputs(value)), undefined);
});

test('idle editor kernels map by exact PID and connection file; busy kernels use the verified cache', async () => {
  const tracker = new EditorTracker();
  const kernel = editorKernel();
  let probes = 0;
  kernel.identity = async () => {
    probes++;
    return { pid: p.pid, connectionFile: p.connectionFile ?? '' };
  };
  const first = await tracker.enrich([{ process: p }], [notebook], async () => kernel);
  assert.deepEqual(first[0]?.metadata?.notebookPaths, [notebook.path]);
  assert.equal(first[0]?.currentWindow, true);
  assert.equal(first[0]?.metadata?.source, 'editor');
  kernel.status = 'busy';
  const second = await tracker.enrich([{ process: p }], [notebook], async () => kernel);
  assert.equal(second[0]?.metadata?.executionState, 'busy');
  assert.equal(probes, 1);
});

test('new busy kernels are not probed, started or guessed from the focused notebook', async () => {
  const kernel = editorKernel('busy');
  kernel.identity = async () => assert.fail('must not queue a diagnostic');
  const rows = await new EditorTracker().enrich([{ process: p }], [notebook], async () => kernel);
  assert.equal(rows[0]?.metadata, undefined);
  assert.equal(rows[0]?.process, p);
});

test('editor identities outside the owned process list or using another connection file are rejected', async () => {
  for (const identity of [
    { pid: p.pid + 1, connectionFile: p.connectionFile ?? '' },
    { pid: p.pid, connectionFile: '/other/kernel-one.json' },
  ]) {
    const kernel = editorKernel();
    kernel.identity = async () => identity;
    assert.equal(
      (await new EditorTracker().enrich([{ process: p }], [notebook], async () => kernel))[0]
        ?.metadata,
      undefined,
    );
  }
});

test('PID reuse and kernel switches invalidate cached editor notebook mappings', async () => {
  const tracker = new EditorTracker();
  const kernel = editorKernel();
  await tracker.enrich([{ process: p }], [notebook], async () => kernel);
  kernel.status = 'busy';
  const reused = await tracker.enrich(
    [{ process: { ...p, startTicks: '200' } }],
    [notebook],
    async () => kernel,
  );
  assert.equal(reused[0]?.metadata, undefined);
  kernel.status = 'idle';
  await tracker.enrich([{ process: p }], [notebook], async () => kernel);
  const switched = editorKernel('busy');
  assert.equal(
    (await tracker.enrich([{ process: p }], [notebook], async () => switched))[0]?.metadata,
    undefined,
  );
});

test('shared editor kernels combine notebook paths while preserving discovered server lifecycle routing', async () => {
  const kernel = editorKernel();
  const serverRow: KernelRow = {
    process: p,
    serverId: 'server',
    serverUrl: 'http://localhost:8888/',
    metadata: {
      id: p.kernelId,
      name: 'python3',
      executionState: 'idle',
      notebookPaths: ['lab.ipynb'],
      source: 'server',
    },
  };
  const rows = await new EditorTracker().enrich(
    [serverRow],
    [notebook, { ...notebook, uri: 'file:///project/b.ipynb', path: '/project/b.ipynb' }],
    async () => kernel,
  );
  assert.deepEqual(rows[0]?.metadata?.notebookPaths, [
    'lab.ipynb',
    notebook.path,
    '/project/b.ipynb',
  ]);
  assert.equal(rows[0]?.serverId, 'server');
});

test('editor diagnostics have a deadline and access denial preserves manageable process rows', async () => {
  const kernel = editorKernel();
  let aborted = false;
  kernel.identity = (signal) =>
    new Promise((resolve) => {
      signal.addEventListener(
        'abort',
        () => {
          aborted = true;
          resolve(undefined);
        },
        { once: true },
      );
    });
  const rows = [{ process: p }];
  assert.deepEqual(
    await new EditorTracker().enrich(rows, [notebook], async () => kernel, 10),
    rows,
  );
  assert.equal(aborted, true);
  assert.deepEqual(
    await new EditorTracker().enrich(rows, [notebook], async () => {
      throw new Error('Access denied');
    }),
    rows,
  );
});

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'jn-discovery-test-'));
  const runtime = path.join(root, 'runtime');
  const serverDir = path.join(root, '900009');
  await fs.mkdir(runtime);
  await fs.mkdir(serverDir);
  const fields = Array<string>(22).fill('0');
  fields[0] = 'S';
  fields[19] = '500';
  await fs.writeFile(path.join(serverDir, 'stat'), `900009 (jupyter-lab) ${fields.join(' ')}`);
  await fs.writeFile(path.join(serverDir, 'status'), `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
  await fs.writeFile(path.join(serverDir, 'cmdline'), '/env/bin/python\0/env/bin/jupyter-lab\0');
  const file = path.join(runtime, 'jpserver-900009.json');
  const write = async (url = 'http://127.0.0.1:8888/') =>
    fs.writeFile(file, JSON.stringify({ pid: 900009, url, token: 'test-secret' }), { mode: 0o600 });
  await write();
  return { root, runtime, file, serverDir, write };
}

test('discover private owned server runtime files and deduplicate directories without manual settings', async (t) => {
  const f = await fixture();
  t.onTestFinished(() => fs.rm(f.root, { recursive: true, force: true }));
  const discovery = new RuntimeDiscovery(f.root, uid);
  const servers = await discovery.servers([f.runtime, f.runtime]);
  assert.equal(servers.length, 1);
  assert.equal(servers[0]?.token, 'test-secret');
  assert.equal(servers[0]?.url, 'http://127.0.0.1:8888/');
  assert.deepEqual(await new RuntimeDiscovery(f.root, uid + 1).servers([f.runtime]), []);
});

test('ignore unsafe permissions, symlinks, foreign UID, stale PIDs, malformed JSON, and non-local runtime URLs', async (t) => {
  const f = await fixture();
  t.onTestFinished(() => fs.rm(f.root, { recursive: true, force: true }));
  const discovery = new RuntimeDiscovery(f.root, uid);
  await fs.chmod(f.file, 0o644);
  assert.deepEqual(await discovery.servers([f.runtime]), []);
  await fs.chmod(f.file, 0o600);
  await f.write('https://outside.example');
  assert.deepEqual(await discovery.servers([f.runtime]), []);
  await fs.writeFile(f.file, 'malformed token data');
  assert.deepEqual(await discovery.servers([f.runtime]), []);
  await f.write();
  await fs.writeFile(
    path.join(f.serverDir, 'status'),
    `Uid:\t${uid}\t${uid + 1}\t${uid}\t${uid}\n`,
  );
  assert.deepEqual(await discovery.servers([f.runtime]), []);
  await fs.writeFile(path.join(f.serverDir, 'status'), `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\n`);
  const target = path.join(f.root, 'target.json');
  await fs.rename(f.file, target);
  await fs.symlink(target, f.file);
  assert.deepEqual(await discovery.servers([f.runtime]), []);
  await fs.unlink(f.file);
  await f.write();
  await fs.rm(f.serverDir, { recursive: true });
  assert.deepEqual(await discovery.servers([f.runtime]), []);
});

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
}

test('automatic metadata GET and confirmed shutdown use discovered credentials; stale server identity blocks DELETE', async (t) => {
  const f = await fixture();
  t.onTestFinished(() => fs.rm(f.root, { recursive: true, force: true }));
  const requests: string[] = [];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, 'token test-secret');
    requests.push(`${req.method} ${req.url}`);
    if (req.method === 'DELETE') {
      res.writeHead(204);
      res.end();
      return;
    }
    res.setHeader('content-type', 'application/json');
    res.end(
      JSON.stringify(
        req.url === '/api/kernels'
          ? [
              {
                id: p.kernelId,
                name: 'python3',
                execution_state: 'idle',
                connections: 1,
                last_activity: '2026-10-03T00:00:00Z',
              },
            ]
          : [{ type: 'notebook', path: 'lab.ipynb', kernel: { id: p.kernelId } }],
      ),
    );
  });
  const url = await listen(server);
  t.onTestFinished(() => {
    server.closeAllConnections();
    return new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await f.write(url);
  const discovery = new RuntimeDiscovery(f.root, uid);
  const owned = { ...p, connectionFile: path.join(f.runtime, 'kernel-one.json') };
  const found = await discovery.enrich([owned]);
  const row = found[0];
  assert(row);
  assert.deepEqual(row.metadata?.notebookPaths, ['lab.ipynb']);
  assert.equal(row.metadata?.source, 'server');
  assert.equal(
    requests.some((r) => r.startsWith('DELETE')),
    false,
  );
  let checked = false;
  await discovery.shutdown(row, async () => {
    checked = true;
  });
  assert.equal(checked, true);
  assert(requests.includes('DELETE /api/kernels/one'));
  requests.length = 0;
  await assert.rejects(
    discovery.shutdown({ ...row, serverId: 'stale' }, async () => assert.fail()),
    /server changed/,
  );
  assert.equal(requests.length, 0);
  await assert.rejects(
    discovery.shutdown(row, async () => {
      throw new Error('Changed process owner');
    }),
    /Changed process owner/,
  );
  assert.equal(
    requests.some((r) => r.startsWith('DELETE')),
    false,
  );
});
