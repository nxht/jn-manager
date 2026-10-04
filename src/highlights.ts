import type { KernelProcess } from './model.js';

export type Severity = 'warning' | 'critical';
export interface HighlightSettings {
  enabled: boolean;
  cpuWarningPercent: number;
  cpuCriticalPercent: number;
  memoryWarningPercent: number;
  memoryCriticalPercent: number;
  totalMemoryWarningPercent: number;
  totalMemoryCriticalPercent: number;
  uptimeWarningHours: number;
  uptimeCriticalHours: number;
}

export const defaultHighlights: HighlightSettings = {
  enabled: true,
  cpuWarningPercent: 80,
  cpuCriticalPercent: 100,
  memoryWarningPercent: 80,
  memoryCriticalPercent: 90,
  totalMemoryWarningPercent: 80,
  totalMemoryCriticalPercent: 90,
  uptimeWarningHours: 24,
  uptimeCriticalHours: 48,
};

export interface HostResources {
  cpuCount: number;
  totalMemory: number;
}

function severity(
  value: number | undefined,
  warning: number,
  critical: number,
  inclusive = false,
): Severity | undefined {
  if (value === undefined || !Number.isFinite(value)) return;
  const exceeds = (threshold: number) => (inclusive ? value >= threshold : value > threshold);
  if (exceeds(critical)) return 'critical';
  if (exceeds(warning)) return 'warning';
  return;
}

export function totalMemoryHighlight(
  bytes: number,
  totalMemory: number,
  settings: HighlightSettings,
): Severity | undefined {
  if (!settings.enabled || !Number.isFinite(totalMemory) || totalMemory <= 0) return;
  return severity(
    (bytes / totalMemory) * 100,
    settings.totalMemoryWarningPercent,
    settings.totalMemoryCriticalPercent,
  );
}

export function resourceHighlights(
  process: KernelProcess,
  host: HostResources,
  settings: HighlightSettings,
): Partial<Record<'CPU' | 'RAM' | 'Uptime', Severity>> {
  if (!settings.enabled) return {};
  return {
    CPU: severity(
      host.cpuCount > 0 && process.cpuPercent !== undefined
        ? process.cpuPercent / host.cpuCount
        : undefined,
      settings.cpuWarningPercent,
      settings.cpuCriticalPercent,
      true,
    ),
    RAM: severity(
      host.totalMemory > 0 ? (process.rssBytes / host.totalMemory) * 100 : undefined,
      settings.memoryWarningPercent,
      settings.memoryCriticalPercent,
    ),
    Uptime: severity(
      process.ageSeconds / 3600,
      settings.uptimeWarningHours,
      settings.uptimeCriticalHours,
    ),
  };
}

export function highestSeverity(values: (Severity | undefined)[]): Severity | undefined {
  return values.includes('critical')
    ? 'critical'
    : values.includes('warning')
      ? 'warning'
      : undefined;
}
