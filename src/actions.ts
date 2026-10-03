import type { KernelProcess } from './model';

export type KernelAction = 'interrupt' | 'stop' | 'forceKill';
const signals: Record<KernelAction, NodeJS.Signals> = {
  interrupt: 'SIGINT',
  stop: 'SIGTERM',
  forceKill: 'SIGKILL',
};

export function assertSameKernel(
  expected: KernelProcess,
  actual: KernelProcess | undefined,
  uid: number,
): asserts actual is KernelProcess {
  if (
    !actual ||
    expected.pid <= 1 ||
    expected.pid === process.pid ||
    actual.pid !== expected.pid ||
    actual.uid !== uid ||
    expected.uid !== uid ||
    actual.startTicks !== expected.startTicks ||
    actual.kernelId !== expected.kernelId ||
    actual.executable !== expected.executable ||
    (expected.connectionFile !== undefined && actual.connectionFile !== expected.connectionFile) ||
    (expected.launchExecutable !== undefined &&
      actual.launchExecutable !== expected.launchExecutable) ||
    actual.state === 'Z' ||
    actual.state === 'X'
  ) {
    throw new Error('Kernel identity or ownership changed. Refresh the list before trying again.');
  }
}

export async function actOnKernel(
  expected: KernelProcess,
  action: KernelAction,
  readCurrent: (pid: number) => Promise<KernelProcess | undefined>,
  signal: (pid: number, signal: NodeJS.Signals) => void = process.kill,
  uid = process.geteuid?.(),
  shutdown?: (id: string) => Promise<void>,
): Promise<void> {
  if (uid === undefined) throw new Error('Linux user identity is unavailable');
  const actual = await readCurrent(expected.pid);
  assertSameKernel(expected, actual, uid);
  if (action === 'stop' && shutdown) await shutdown(actual.kernelId);
  else signal(actual.pid, signals[action]);
}
