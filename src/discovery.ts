import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import { JupyterClient, normalizeServerUrl } from './jupyter.js';
import { type KernelProcess, type KernelRow, mergeKernels } from './model.js';
import { parseStat } from './proc.js';

export interface DiscoveredServer {
  id: string;
  url: string;
  token: string;
}

export function runtimeDirectories(
  processes: KernelProcess[],
  env: NodeJS.ProcessEnv = process.env,
  home = homedir(),
): string[] {
  return [
    ...new Set(
      [
        ...processes.flatMap((p) => (p.connectionFile ? [path.dirname(p.connectionFile)] : [])),
        env.JUPYTER_RUNTIME_DIR,
        env.XDG_RUNTIME_DIR ? path.join(env.XDG_RUNTIME_DIR, 'jupyter', 'runtime') : undefined,
        path.join(
          env.JUPYTER_DATA_DIR ||
            (env.XDG_DATA_HOME && path.join(env.XDG_DATA_HOME, 'jupyter')) ||
            path.join(home, '.local', 'share', 'jupyter'),
          'runtime',
        ),
        path.join(home, '.local', 'share', 'jupyter', 'runtime'),
      ].filter((dir): dir is string => !!dir && path.isAbsolute(dir)),
    ),
  ];
}

export function localServerUrl(raw: string): string {
  const url = new URL(raw);
  // Runtime credentials are only sent to a service on the same machine.
  if (url.hostname === '0.0.0.0') url.hostname = '127.0.0.1';
  if (url.hostname === '[::]') url.hostname = '[::1]';
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Non-local runtime endpoint');
  return normalizeServerUrl(url.toString());
}

function serverArgs(args: string[]): boolean {
  return args
    .slice(0, 3)
    .some(
      (arg) =>
        /^jupyter-(lab|notebook|server)$/.test(path.basename(arg)) ||
        [
          'jupyterlab',
          'jupyter_server',
          'notebook',
          'jupyterlab.labapp',
          'jupyter_server.serverapp',
          'notebook.notebookapp',
        ].includes(arg),
    );
}

export class RuntimeDiscovery {
  constructor(
    private readonly root = '/proc',
    private readonly uid = process.geteuid?.(),
  ) {}

  async servers(directories: string[]): Promise<DiscoveredServer[]> {
    if (this.uid === undefined) return [];
    const servers: DiscoveredServer[] = [];
    const seen = new Set<string>();
    for (const directory of directories) {
      try {
        const owner = await fs.stat(directory);
        if (owner.uid !== this.uid || !owner.isDirectory()) continue;
        const files = (await fs.readdir(directory)).filter((name) =>
          /^(jpserver|nbserver)-\d+\.json$/.test(name),
        );
        for (const name of files.slice(0, 64)) {
          try {
            const file = path.join(directory, name);
            // Open atomically without following file symlinks; bound and check secret-bearing files.
            const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
            let info: Record<string, unknown>;
            try {
              const stat = await handle.stat();
              if (
                !stat.isFile() ||
                stat.uid !== this.uid ||
                (stat.mode & 0o077) !== 0 ||
                stat.size > 65536
              )
                continue;
              info = JSON.parse(await handle.readFile('utf8')) as Record<string, unknown>;
            } finally {
              await handle.close();
            }
            if (!info || typeof info !== 'object') continue;
            const pid = info.pid;
            if (
              typeof pid !== 'number' ||
              !Number.isSafeInteger(pid) ||
              pid <= 1 ||
              (name !== `jpserver-${pid}.json` && name !== `nbserver-${pid}.json`)
            )
              continue;
            const procDir = path.join(this.root, String(pid));
            if ((await fs.stat(procDir)).uid !== this.uid) continue;
            const status = await fs.readFile(path.join(procDir, 'status'), 'utf8');
            const ids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(status);
            if (!ids || ids.slice(1).some((id) => Number(id) !== this.uid)) continue;
            const before = parseStat(await fs.readFile(path.join(procDir, 'stat'), 'utf8'));
            if (['Z', 'X'].includes(before.state)) continue;
            if (
              !serverArgs(
                (await fs.readFile(path.join(procDir, 'cmdline'), 'utf8'))
                  .split('\0')
                  .filter(Boolean),
              )
            )
              continue;
            const after = parseStat(await fs.readFile(path.join(procDir, 'stat'), 'utf8'));
            if (after.startTicks !== before.startTicks || (await fs.stat(procDir)).uid !== this.uid)
              continue;
            if (
              typeof info.url !== 'string' ||
              (info.token !== undefined && typeof info.token !== 'string')
            )
              continue;
            const url = localServerUrl(info.url);
            const id = `${pid}:${before.startTicks}:${url}`;
            if (seen.has(id)) continue;
            seen.add(id);
            servers.push({ id, url, token: typeof info.token === 'string' ? info.token : '' });
          } catch {
            /* Stale, unreadable and malformed files are ignored without logging secrets. */
          }
        }
      } catch {
        /* Runtime directories may not exist or be accessible. */
      }
    }
    return servers;
  }

  async enrich(processes: KernelProcess[]): Promise<KernelRow[]> {
    const servers = await this.servers(runtimeDirectories(processes));
    const matches = await Promise.all(
      servers.map(async (server) => {
        try {
          const metadata = await new JupyterClient(server.url, server.token).metadata();
          return mergeKernels(
            processes,
            metadata.map((m) => ({ ...m, source: 'server' as const })),
            server.url,
          ).map((row) => ({ ...row, serverId: row.metadata ? server.id : undefined }));
        } catch {
          return [];
        }
      }),
    );
    const joined = new Map<KernelProcess, KernelRow | undefined>();
    for (const rows of matches) {
      for (const row of rows) {
        if (row.metadata) joined.set(row.process, joined.has(row.process) ? undefined : row);
      }
    }
    return processes.map((p) => joined.get(p) ?? { process: p });
  }

  async shutdown(row: KernelRow, revalidate: () => Promise<void>): Promise<void> {
    const servers = await this.servers(runtimeDirectories([row.process]));
    const server = servers.find((s) => s.id === row.serverId && s.url === row.serverUrl);
    if (!server)
      throw new Error(
        'The discovered Jupyter server changed. Refresh before stopping this kernel.',
      );
    const client = new JupyterClient(server.url, server.token);
    const matches = (await client.metadata()).filter((m) => m.id === row.process.kernelId);
    if (matches.length !== 1)
      throw new Error('The server kernel mapping changed. Refresh before stopping this kernel.');
    await revalidate();
    await client.shutdown(row.process.kernelId);
  }
}
