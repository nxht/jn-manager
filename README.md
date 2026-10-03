# Jupyter Notebook Manager

Monitor and manage your Python Jupyter kernels in VS Code 1.100+ or a compatible Cursor version. Works on Linux, including Remote SSH, WSL and dev containers, with editor kernels and local JupyterLab/Notebook servers. No server URL or token setup is needed.

## Getting started

1. Install the VSIX using **Extensions → Install from VSIX…**. For Remote SSH, install it on the SSH host.
2. Open **Jupyter Notebook Manager** using the notebook icon in the activity bar.
3. Expand a kernel to see CPU, RAM, process uptime, PID, notebook paths and interpreter, with separate labels and values.

Kernels from **Current window** appear first, followed by Jupyter servers and other editor kernels. Each group shows `Total n MB`; kernel rows show CPU, RAM in decimal MB, then process uptime. When a notebook name is unavailable, the kernel is shown by PID. CPU uses a chip icon; RAM uses a circuit-board icon. CPU appears after the second sample; the view refreshes every five seconds, with an `mm:ss` countdown in the header before the refresh controls.

The status bar shows total RAM across all your discovered kernel processes on the Linux host, including kernels hidden by sidebar settings. Shared kernels count once. It updates every five seconds even with the sidebar closed; click it to open the manager.

Click a detail or its copy button to copy the value. **Ctrl+C** / **Cmd+C** copies the selected detail or kernel's information.

## Kernel actions

Use a kernel's buttons or context menu:

- **Interrupt** requests cancellation of the current computation.
- **Stop** ends the kernel and clears its in-memory state.
- **Force Kill** ends it immediately, without cleanup.

Each action asks for confirmation. A supervising server may restart a stopped or force-killed kernel.

## Settings

Search for **Jupyter Notebook Manager** in Settings.

| Setting | Default |
| --- | --- |
| `jnManager.refreshSeconds` | 5 seconds |
| `jnManager.includeExternalServers` | Show local Jupyter server kernels |
| `jnManager.includeOtherWindows` | Show other VS Code/Cursor kernels |
| `jnManager.highlights.enabled` | Enable yellow/red highlights |

Verified current-window kernels always stay visible. Kernels with an unknown origin also remain visible. External servers means servers on the Linux workspace host.

Highlight thresholds are customizable under `jnManager.highlights.*`:

| Metric | Yellow | Red |
| --- | --- | --- |
| CPU, across all host CPUs | ≥80% | ≥100% |
| RAM, as a share of total host RAM | >80% | >90% |
| Process uptime | >24 hours | >48 hours |

Use `cpuWarningPercent` / `cpuCriticalPercent`, `memoryWarningPercent` / `memoryCriticalPercent`, and `uptimeWarningHours` / `uptimeCriticalHours` to adjust them. Colors can be customized with `jnManager.warningForeground` and `jnManager.criticalForeground` in `workbench.colorCustomizations`.

## Notes

- Only kernels owned by your Linux account are shown. Ownership and process identity are rechecked before kernel actions. Remote servers without local kernel processes are not supported.
- CPU and RAM describe the kernel process; worker processes and GPU memory are excluded. The displayed CPU percentage uses 100% per core. Uptime is process lifetime, not cell execution time.
- Jupyter may ask for kernel-access permission to identify notebooks. Declining still allows resource monitoring; some notebook names may be unavailable.
- Live notebook and server details take precedence over launch logs. Log-based names describe a single verified launch and may miss later renames or attachments.
