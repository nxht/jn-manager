import { execFile } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { performance } from 'node:perf_hooks';
import { promisify } from 'node:util';
import type { KernelProcess } from './model.js';

const runFile = promisify(execFile);

export function kernelLaunchFromArgs(
  args: string[],
): { kernelId: string; connectionFile: string } | undefined {
  const executable = path.basename(args[0] ?? '');
  if (!/^python(?:\d+(?:\.\d+)*)?$/.test(executable)) return;
  // Python options may precede -m (VS Code/Conda commonly supply -Xfrozen_modules=off).
  // Stop at the first script/module target so a training script cannot spoof a kernel.
  let target = 1;
  while (target < args.length) {
    const arg = args[target] ?? '';
    if (['-u', '-B', '-E', '-s', '-S', '-I', '-O', '-OO', '-q'].includes(arg)) target++;
    else if (arg === '-X' || arg === '-W') target += 2;
    else if (arg.startsWith('-X') || arg.startsWith('-W')) target++;
    else break;
  }
  const module = args[target + 1];
  const explicitModule =
    args[target] === '-m' && (module === 'ipykernel_launcher' || module === 'ipykernel');
  const explicitScript = path.basename(args[target] ?? '') === 'ipykernel_launcher.py';
  if (!explicitModule && !explicitScript) return;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i] ?? '';
    const rawConnection =
      arg === '-f' || arg === '--f'
        ? args[i + 1]
        : arg.startsWith('--f=')
          ? arg.slice(4)
          : undefined;
    const connection = rawConnection?.replace(/^"(.*)"$/, '$1');
    const match = connection && /^kernel-([a-zA-Z0-9_-]+)\.json$/.exec(path.basename(connection));
    if (match?.[1] && connection) return { kernelId: match[1], connectionFile: connection };
  }
  return;
}

export function parseStat(raw: string): { state: string; cpuTicks: number; startTicks: string } {
  // The process name may contain spaces and parentheses: split after its last ')'.
  const end = raw.lastIndexOf(')');
  if (end < 0) throw new Error('Invalid process stat');
  const fields = raw
    .slice(end + 1)
    .trim()
    .split(/\s+/);
  const state = fields[0];
  const user = Number(fields[11]);
  const system = Number(fields[12]);
  const startTicks = fields[19];
  if (
    !state ||
    !startTicks ||
    !/^\d+$/.test(startTicks) ||
    !Number.isFinite(user) ||
    !Number.isFinite(system)
  ) {
    throw new Error('Invalid process stat fields');
  }
  return { state, cpuTicks: user + system, startTicks };
}

function transient(error: unknown): boolean {
  return ['ENOENT', 'ESRCH', 'EACCES', 'EPERM'].includes(
    (error as NodeJS.ErrnoException).code ?? '',
  );
}

export class LinuxCollector {
  private previous = new Map<number, { startTicks: string; cpuTicks: number; time: number }>();
  private ticks?: number;
  constructor(
    private readonly root = '/proc',
    private readonly uid = process.geteuid?.(),
    private readonly fixedTicks?: number,
  ) {}

  async readProcess(
    pid: number,
    ticks: number,
    uptime: number,
    bootEpochMs = Date.now() - uptime * 1000,
  ): Promise<KernelProcess | undefined> {
    if (this.uid === undefined || !Number.isSafeInteger(pid) || pid <= 1 || pid === process.pid)
      return;
    const dir = path.join(this.root, String(pid));
    try {
      // Ownership is checked before accessing another user's command line or executable.
      const owner = await fs.stat(dir);
      if (owner.uid !== this.uid) return;
      const status = await fs.readFile(path.join(dir, 'status'), 'utf8');
      const ids = /^Uid:\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)/m.exec(status);
      if (!ids || ids.slice(1).some((id) => Number(id) !== this.uid)) return;
      const stat = parseStat(await fs.readFile(path.join(dir, 'stat'), 'utf8'));
      if (stat.state === 'Z' || stat.state === 'X') return;
      const args = (await fs.readFile(path.join(dir, 'cmdline'), 'utf8'))
        .split('\0')
        .filter(Boolean);
      const launch = kernelLaunchFromArgs(args);
      if (!launch) return;
      const cwd = await fs.readlink(path.join(dir, 'cwd'));
      const connectionFile = path.resolve(cwd, launch.connectionFile);
      const rss = /^VmRSS:\s+(\d+)\s+kB/m.exec(status);
      if (!rss) return;
      const executable = await fs.readlink(path.join(dir, 'exe'));
      // Reject PID reuse during collection as well as immediately before an action.
      const again = parseStat(await fs.readFile(path.join(dir, 'stat'), 'utf8'));
      if (
        again.startTicks !== stat.startTicks ||
        ['Z', 'X'].includes(again.state) ||
        (await fs.stat(dir)).uid !== this.uid
      )
        return;
      return {
        pid,
        uid: this.uid,
        kernelId: launch.kernelId,
        connectionFile,
        launchExecutable: args[0],
        executable,
        ...stat,
        rssBytes: Number(rss[1]) * 1024,
        ageSeconds: Math.max(0, uptime - Number(stat.startTicks) / ticks),
        createdAtEpochMs: bootEpochMs + (Number(stat.startTicks) / ticks) * 1000,
      };
    } catch (error) {
      if (transient(error)) return;
      throw error;
    }
  }

  private async clockTicks(): Promise<number> {
    if (this.fixedTicks !== undefined) return this.fixedTicks;
    if (this.ticks !== undefined) return this.ticks;
    const result = await runFile('getconf', ['CLK_TCK'], { timeout: 3000 });
    const ticks = Number(result.stdout.trim());
    if (!Number.isSafeInteger(ticks) || ticks <= 0)
      throw new Error('Cannot determine Linux CPU clock ticks');
    this.ticks = ticks;
    return ticks;
  }

  async snapshot(): Promise<KernelProcess[]> {
    if (process.platform !== 'linux')
      throw new Error('Use this extension on a Linux host through Remote SSH, WSL or a container.');
    const ticks = await this.clockTicks();
    const uptime = Number(
      (await fs.readFile(path.join(this.root, 'uptime'), 'utf8')).split(' ')[0],
    );
    if (!Number.isFinite(uptime)) throw new Error('Cannot read host uptime');
    const bootEpochMs = Date.now() - uptime * 1000;
    const entries = (await fs.readdir(this.root)).filter((n) => /^\d+$/.test(n));
    const output: KernelProcess[] = [];
    const next = new Map<number, { startTicks: string; cpuTicks: number; time: number }>();
    // Bound file I/O rather than reading every process concurrently on large shared servers.
    for (let start = 0; start < entries.length; start += 24) {
      const batch = await Promise.all(
        entries
          .slice(start, start + 24)
          .map((n) => this.readProcess(Number(n), ticks, uptime, bootEpochMs)),
      );
      for (const p of batch) {
        if (!p) continue;
        const now = performance.now();
        const old = this.previous.get(p.pid);
        if (
          old &&
          old.startTicks === p.startTicks &&
          now > old.time &&
          p.cpuTicks >= old.cpuTicks
        ) {
          p.cpuPercent = ((p.cpuTicks - old.cpuTicks) / ticks / ((now - old.time) / 1000)) * 100;
        }
        next.set(p.pid, { startTicks: p.startTicks, cpuTicks: p.cpuTicks, time: now });
        output.push(p);
      }
    }
    this.previous = next;
    return output.sort((a, b) => b.rssBytes - a.rssBytes);
  }

  async current(pid: number): Promise<KernelProcess | undefined> {
    const ticks = await this.clockTicks();
    const uptime = Number(
      (await fs.readFile(path.join(this.root, 'uptime'), 'utf8')).split(' ')[0],
    );
    return this.readProcess(pid, ticks, uptime);
  }
}
