import * as fs from 'node:fs/promises';
import { homedir } from 'node:os';
import * as path from 'node:path';
import type { KernelRow } from './model';

export function editorHostDirectory(logPath: string): string | undefined {
  let dir = logPath;
  while (path.dirname(dir) !== dir) {
    if (/^exthost\d*$/.test(path.basename(dir))) return dir;
    dir = path.dirname(dir);
  }
  return;
}

export interface NotebookLaunch {
  notebook: string;
  connectionFile: string;
  time: number;
  host?: string;
}

export function editorLogRoots(logPath?: string, home = homedir()): string[] {
  const roots = [
    path.join(home, '.vscode-server', 'data', 'logs'),
    path.join(home, '.vscode-server-insiders', 'data', 'logs'),
    path.join(home, '.cursor-server', 'data', 'logs'),
  ];
  let dir = logPath;
  while (dir && path.dirname(dir) !== dir) {
    if (/^exthost\d*$/.test(path.basename(dir))) {
      roots.unshift(path.dirname(path.dirname(dir)));
      break;
    }
    dir = path.dirname(dir);
  }
  return [...new Set(roots)];
}

interface Launch {
  notebook: string;
  time: number;
  connections: string[];
  ambiguous: boolean;
}

export function logSessionOffset(stamp: string, createdAt: number): number | undefined {
  if (!/^\d{8}T\d{6}$/.test(stamp) || createdAt <= 0) return;
  const encoded = Date.UTC(
    Number(stamp.slice(0, 4)),
    Number(stamp.slice(4, 6)) - 1,
    Number(stamp.slice(6, 8)),
    Number(stamp.slice(9, 11)),
    Number(stamp.slice(11, 13)),
    Number(stamp.slice(13, 15)),
  );
  const offset = Math.round((encoded - createdAt) / 900000) * 900000;
  if (Math.abs(offset) > 14 * 3600000 || Math.abs(encoded - createdAt - offset) > 60000) return;
  return offset;
}

function expandHome(value: string, home: string): string {
  return value.startsWith('~/') ? path.join(home, value.slice(2)) : value;
}

// Correlate a single, completed launch block. Overlapping launches are deliberately withheld.
export function notebookLaunches(
  text: string,
  date: string,
  home = homedir(),
  offset = 0,
): NotebookLaunch[] {
  const active: Launch[] = [];
  const launches: NotebookLaunch[] = [];
  for (const line of text.split('\n')) {
    const start =
      /^([\d:.]+) \[info\] Starting Kernel .* for '(.+)' \(disableUI=(?:true|false)\)/.exec(line);
    if (start) {
      const time = new Date(`${date}T${start[1]}Z`).getTime() - offset;
      const notebook = expandHome(start[2] ?? '', home);
      if (!Number.isFinite(time) || !notebook.endsWith('.ipynb')) continue;
      if (active.length) for (const launch of active) launch.ambiguous = true;
      active.push({ notebook, time, connections: [], ambiguous: active.length > 0 });
      continue;
    }
    if (
      active.length === 1 &&
      line.includes('[info] Process Execution:') &&
      /\s-m\s+ipykernel(?:_launcher)?(?:\s|$)/.test(line)
    ) {
      const file = /(?:^|\s)(?:--f=|-f\s+|--f\s+)(?:"([^"]+)"|(\S+))/.exec(line);
      const value = file?.[1] ?? file?.[2];
      const launch = active[0];
      if (value && launch) {
        launch.connections.push(expandHome(value, home));
        launch.time = new Date(`${date}T${line.split(' ')[0]}Z`).getTime() - offset;
      }
    }
    if (line.includes('[info] Kernel successfully started')) {
      const launch = active.shift();
      if (launch && !launch.ambiguous && launch.connections.length === 1 && launch.connections[0]) {
        const file = launch.connections[0];
        if (path.isAbsolute(file))
          launches.push({
            notebook: launch.notebook,
            connectionFile: path.normalize(file),
            time: launch.time,
          });
      }
    }
  }
  return launches;
}

export function applyLaunches(
  rows: KernelRow[],
  launches: ReturnType<typeof notebookLaunches>,
  now = Date.now(),
  currentHost?: string,
): KernelRow[] {
  return rows.map((row) => {
    if (row.metadata?.notebookPaths.length) return row;
    const p = row.process;
    const start = p.createdAtEpochMs ?? now - p.ageSeconds * 1000;
    // Client log clocks can differ from the Linux host; require one exact path
    // within a bounded minute, consistent with log-session clock validation.
    const matches = launches.filter(
      (l) => l.connectionFile === p.connectionFile && Math.abs(l.time - start) < 60000,
    );
    const match = matches.length === 1 ? matches[0] : undefined;
    if (!match) return row;
    return {
      ...row,
      currentWindow: row.currentWindow || (currentHost !== undefined && match.host === currentHost),
      metadata: row.metadata
        ? { ...row.metadata, notebookPaths: [match.notebook] }
        : {
            id: p.kernelId,
            name: 'Python',
            executionState: 'unknown',
            notebookPaths: [match.notebook],
            source: 'editor-log' as const,
          },
    };
  });
}

export class EditorLogDiscovery {
  private readonly cache = new Map<
    string,
    { size: number; mtime: number; launches: ReturnType<typeof notebookLaunches> }
  >();
  constructor(
    private readonly roots = editorLogRoots(),
    private readonly uid = process.geteuid?.(),
    private readonly home = homedir(),
    private readonly currentHost?: string,
  ) {}

  private async directories(dir: string): Promise<string[]> {
    try {
      if ((await fs.stat(dir)).uid !== this.uid) return [];
      return (await fs.readdir(dir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => path.join(dir, e.name));
    } catch {
      return [];
    }
  }

  async enrich(rows: KernelRow[], now = Date.now()): Promise<KernelRow[]> {
    if (this.uid === undefined || rows.every((r) => r.metadata?.notebookPaths.length)) return rows;
    const launches: ReturnType<typeof notebookLaunches> = [];
    const seen = new Set<string>();
    for (const root of this.roots) {
      const sessions = (await this.directories(root))
        .filter((d) => /^\d{8}T\d{6}$/.test(path.basename(d)))
        .sort()
        .reverse()
        .slice(0, 8);
      for (const session of sessions) {
        const stamp = path.basename(session);
        const stat = await fs.stat(session).catch(() => undefined);
        if (!stat) continue;
        const offset = logSessionOffset(stamp, stat.birthtimeMs);
        if (offset === undefined) continue;
        const date = `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}`;
        for (const host of (await this.directories(session)).filter((d) =>
          /^exthost\d*$/.test(path.basename(d)),
        )) {
          for (const output of (await this.directories(host)).filter((d) =>
            path.basename(d).startsWith('output_logging_'),
          )) {
            let names: string[];
            try {
              names = (await fs.readdir(output)).filter((n) => /^\d+-Jupyter\.log$/.test(n));
            } catch {
              continue;
            }
            for (const name of names) {
              const file = path.join(output, name);
              seen.add(file);
              try {
                const handle = await fs.open(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
                try {
                  const stat = await handle.stat();
                  if (!stat.isFile() || stat.uid !== this.uid || stat.size > 4 * 1024 * 1024)
                    continue;
                  let cached = this.cache.get(file);
                  if (!cached || cached.size !== stat.size || cached.mtime !== stat.mtimeMs) {
                    cached = {
                      size: stat.size,
                      mtime: stat.mtimeMs,
                      launches: notebookLaunches(
                        await handle.readFile('utf8'),
                        date,
                        this.home,
                        offset,
                      ).map((launch) => ({ ...launch, host })),
                    };
                    this.cache.set(file, cached);
                  }
                  launches.push(...cached.launches);
                } finally {
                  await handle.close();
                }
              } catch {
                /* Logs are optional and never echoed, including process arguments. */
              }
            }
          }
        }
      }
    }
    for (const file of this.cache.keys()) if (!seen.has(file)) this.cache.delete(file);
    return applyLaunches(rows, launches, now, this.currentHost);
  }
}
