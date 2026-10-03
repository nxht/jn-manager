import assert from 'node:assert/strict';
import { test } from 'vitest';
import { defaultHighlights, highestSeverity, resourceHighlights } from '../src/highlights';
import type { KernelProcess } from '../src/model';

const process: KernelProcess = {
  pid: 123,
  uid: 1000,
  startTicks: '10',
  kernelId: 'one',
  executable: '/usr/bin/python',
  state: 'S',
  cpuTicks: 10,
  cpuPercent: 100,
  rssBytes: 800,
  ageSeconds: 86400,
};
const host = { cpuCount: 8, totalMemory: 1000 };

test('CPU highlights use all logical CPUs, including inclusive saturation', () => {
  assert.equal(resourceHighlights(process, host, defaultHighlights).CPU, undefined);
  assert.equal(
    resourceHighlights({ ...process, cpuPercent: 640 }, host, defaultHighlights).CPU,
    'warning',
  );
  assert.equal(
    resourceHighlights({ ...process, cpuPercent: 800 }, host, defaultHighlights).CPU,
    'critical',
  );
  assert.equal(
    resourceHighlights({ ...process, cpuPercent: undefined }, host, defaultHighlights).CPU,
    undefined,
  );
});

test('RAM and process uptime thresholds are exclusive', () => {
  assert.deepEqual(resourceHighlights(process, host, defaultHighlights), {
    CPU: undefined,
    RAM: undefined,
    Uptime: undefined,
  });
  const warning = resourceHighlights(
    { ...process, rssBytes: 801, ageSeconds: 86401 },
    host,
    defaultHighlights,
  );
  assert.equal(warning.RAM, 'warning');
  assert.equal(warning.Uptime, 'warning');
  const critical = resourceHighlights(
    { ...process, rssBytes: 901, ageSeconds: 172801 },
    host,
    defaultHighlights,
  );
  assert.equal(critical.RAM, 'critical');
  assert.equal(critical.Uptime, 'critical');
});

test('highlights can be disabled and thresholds customized', () => {
  const busy = { ...process, cpuPercent: 800, rssBytes: 999, ageSeconds: 200000 };
  assert.deepEqual(resourceHighlights(busy, host, { ...defaultHighlights, enabled: false }), {});
  assert.equal(
    resourceHighlights(process, host, { ...defaultHighlights, cpuWarningPercent: 10 }).CPU,
    'warning',
  );
  assert.equal(
    resourceHighlights(process, host, {
      ...defaultHighlights,
      memoryWarningPercent: 50,
      memoryCriticalPercent: 70,
    }).RAM,
    'critical',
  );
  assert.equal(
    resourceHighlights(process, host, {
      ...defaultHighlights,
      uptimeWarningHours: 1,
      uptimeCriticalHours: 2,
    }).Uptime,
    'critical',
  );
});

test('invalid samples and unavailable host resources do not raise resource alerts', () => {
  const invalid = {
    ...process,
    cpuPercent: Number.NaN,
    rssBytes: Number.NaN,
    ageSeconds: Number.NaN,
  };
  assert.deepEqual(resourceHighlights(invalid, host, defaultHighlights), {
    CPU: undefined,
    RAM: undefined,
    Uptime: undefined,
  });
  const noHost = resourceHighlights(process, { cpuCount: 0, totalMemory: 0 }, defaultHighlights);
  assert.equal(noHost.CPU, undefined);
  assert.equal(noHost.RAM, undefined);
});

test('critical severity wins when a kernel has multiple resource alerts', () => {
  assert.equal(highestSeverity(['warning', 'critical']), 'critical');
  assert.equal(highestSeverity([undefined, 'warning']), 'warning');
  assert.equal(highestSeverity([undefined]), undefined);
});
