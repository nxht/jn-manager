# Jupyter Notebook Manager

Monitor and manage your Python Jupyter kernels in VS Code 1.100+ or compatible Cursor. Supports Linux, Remote SSH, WSL and dev containers. No server setup needed.

## Quick start

1. **Extensions → Install from VSIX…** (install on the remote host when using Remote SSH).
2. Click the **notebook icon** in the activity bar.
3. Expand a kernel to see its details.

| Control | Use |
| --- | --- |
| Countdown / Refresh | Next update / update now |
| Status bar | Total kernel RAM; click to open the sidebar |
| Detail / Copy button | Copy the value |

Groups: **Current window → Jupyter servers → Other Kernels → Unclassified Kernels**.

## Kernel actions

| Action | Effect |
| --- | --- |
| Interrupt | Request cancellation of the current computation |
| Stop | End the kernel; clear its in-memory state |
| Force Kill | End immediately, without cleanup |

Use kernel buttons or the context menu. Actions require confirmation.

## Settings

Search **Jupyter Notebook Manager** in Settings.

| Setting | Description | Default |
| --- | --- | --- |
| `jnManager.refreshSeconds` | Refresh interval (seconds) | `5` |
| `jnManager.includeExternalServers` | Show other local server kernels | `true` |
| `jnManager.includeOtherWindows` | Show other editor kernels | `true` |
| `jnManager.highlights.enabled` | Enable yellow warnings and red critical alerts | `true` |

Current-window and unclassified kernels always remain visible.

### Highlights

Prefix: `jnManager.highlights.`. Thresholds use **all host CPUs** and **total host RAM**.

| Setting | Description | Default |
| --- | --- | --- |
| `cpuWarningPercent` | 🟡 CPU ≥ threshold (%) | `80` |
| `cpuCriticalPercent` | 🔴 CPU ≥ threshold (%) | `100` |
| `memoryWarningPercent` | 🟡 RAM > threshold (%) | `80` |
| `memoryCriticalPercent` | 🔴 RAM > threshold (%) | `90` |
| `totalMemoryWarningPercent` | 🟡 Status-bar total kernel RAM > threshold (%) | `80` |
| `totalMemoryCriticalPercent` | 🔴 Status-bar total kernel RAM > threshold (%) | `90` |
| `uptimeWarningHours` | 🟡 Process uptime > threshold (hours) | `24` |
| `uptimeCriticalHours` | 🔴 Process uptime > threshold (hours) | `48` |

| Display | Behavior |
| --- | --- |
| Icons | Detail: metric severity; kernel: highest severity |
| Status bar | Total kernel RAM, including hidden groups; warning/error icon and background |
| Text | Follows `explorer.decorations.colors` and selection styling |
| Uptime warning = `0` | Warns for positive process uptime |
| Custom colors | Set `jnManager.warningForeground` / `jnManager.criticalForeground` in `workbench.colorCustomizations` |

## Measurement limits

| Metric | Measures |
| --- | --- |
| CPU | Kernel process usage; 100% per core; appears after the second sample |
| RAM | Kernel process RSS; excludes worker processes and GPU memory |
| Uptime | Process lifetime, not cell execution time |

Only your Linux account’s kernels appear. Remote HTTP servers are unsupported. Jupyter permission is optional for monitoring.
