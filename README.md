# Jupyter Notebook Manager

Inspect and stop your own Python Jupyter kernels on a Linux server from VS Code or Cursor. The extension runs on the Remote SSH, WSL or dev-container host and automatically handles both editor-launched kernels and JupyterLab/Notebook kernels. No server URL, token, environment activation or Python path configuration is required.

**Jupyter Notebook Manager** shows PID, interpreter, CPU, resident RAM and process uptime. Notebook paths, kernel name and execution status are added when exact metadata can be resolved. Ordinary Python scripts, server processes and other users' kernels are excluded.

## Use

1. Install the VSIX with **Extensions → Install from VSIX…**. For Remote SSH, install it on the SSH host.
2. Open **Jupyter Notebook Manager** from the notebook icon in the activity bar.
3. Expand a kernel for details. CPU becomes available after a second sample. The visible view refreshes every five seconds; `jnManager.refreshSeconds` adjusts this interval.
4. Use a kernel's toolbar/context menu to interrupt, stop or force kill it.

Kernels associated with this editor window appear under **Current window**, first. Remaining kernels are grouped by Jupyter server; other editor-launched kernels have a separate group. Kernel labels show notebook filenames, with a compact CPU/RAM summary. Expand a kernel to see its process uptime and other details. Click a detail value or its copy button to copy the full value; Ctrl/Cmd+C in the sidebar copies the selected value (or the selected kernel's details). No text files open when selecting kernels.

## Kernel visibility

Both settings default to `true` and take effect on refresh after changing Settings:

- `jnManager.includeExternalServers`: show locally discovered JupyterLab/Notebook server groups outside this editor window.
- `jnManager.includeOtherWindows`: show other VS Code/Cursor kernels, including editor kernels whose window cannot be verified.

Verified **Current window** kernels always remain visible, including kernels attached to a Jupyter server. Server grouping takes precedence for remaining kernels, so server-backed kernels follow `includeExternalServers`. Unclassified **Other kernels** remain visible because their origin is unknown. These settings filter the sidebar and its count after notebook identity discovery; they preserve server routing for lifecycle actions. External servers here means automatically discovered loopback servers on the Linux workspace host, not remote HTTP servers without owned local processes.

## Resource highlights

CPU, RAM and uptime detail text and icons use yellow for warnings and red for critical values. The kernel label also takes the highest severity. CPU thresholds use the percentage of **all host logical CPUs** (a process using 800% CPU on eight CPUs reaches 100% of the host). RAM thresholds use process RSS as a percentage of total host RAM. Uptime means process lifetime.

| Setting (`jnManager.highlights.` prefix) | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable resource highlights |
| `cpuWarningPercent` / `cpuCriticalPercent` | `80` / `100` | At or above this percentage of all CPUs |
| `memoryWarningPercent` / `memoryCriticalPercent` | `80` / `90` | Above this percentage of total RAM |
| `uptimeWarningHours` / `uptimeCriticalHours` | `24` / `48` | Above this many hours |

Change these in Settings under **Jupyter Notebook Manager**. Critical takes precedence; keep critical thresholds at or above warning thresholds. Customize the colors with `jnManager.warningForeground` and `jnManager.criticalForeground` in `workbench.colorCustomizations`. Text decorations follow VS Code's `explorer.decorations.colors` setting; colored icons remain visible when text decorations are disabled. Selected text follows the editor theme's selection styling.

The Refresh button retains its normal appearance while discovery runs in the background. Repeated refresh requests share the current discovery operation.

## Automatic notebook discovery

**JupyterLab / Notebook:** The extension finds the current user's `jpserver-*.json` and `nbserver-*.json` runtime files. It searches the directories of running kernels' connection files as well as standard Jupyter/XDG locations. This works when an editor kernel and a Lab kernel use different virtual environments or runtime directories. Existing credentials are read from private, owned runtime files and held briefly in memory; they are never displayed, logged or requested from the user. Endpoints must be on loopback, and the server PID must be a live Jupyter process belonging to the same Unix account. Only exact kernel-ID joins to owned processes appear in the view.

**VS Code / Cursor:** The supported Microsoft Jupyter extension API maps open notebooks to live kernels. For an idle Python kernel, a small diagnostic reads its PID and connection-file path, then matches both to the owned process list. The Jupyter API executes this without adding notebook cells or changing execution history/count. It does execute a short Python request, which may briefly affect kernel status. Jupyter may show its native kernel-access permission prompt once; denying access still leaves process monitoring and actions available. No connection-file contents are read for editor mapping.

Notebook associations are cached against kernel handle, PID, process start ticks and connection-file path. Busy kernels use a previously verified mapping. The extension does not queue diagnostics behind a busy kernel, start a kernel, read the editor's private credential database or guess notebook names from the focused file/working directory. Open notebooks sharing a kernel appear together.

The Jupyter API sees only its own editor window. For kernels from another window, or unavailable API mappings, a read-only fallback checks this account's local Jupyter extension logs. A notebook is associated only when a single completed launch records the exact connection-file path and a matching process creation time. Overlapping or conflicting launch evidence is withheld. This also works while a kernel is busy. Logs are size bounded, owned files only, and never echoed. A log association identifies the notebook at launch; later renames or additional attachments in another window may be unavailable. Current-window API/session metadata takes precedence over launch logs.

## Actions

- **Interrupt:** Sends SIGINT after ownership/identity revalidation. Requests cancellation of the current computation.
- **Stop:** For an automatically matched Jupyter server, revalidates the live server and kernel, then uses Jupyter's kernel shutdown API. For a raw/unmapped kernel, sends SIGTERM.
- **Force Kill:** Sends SIGKILL explicitly, without allowing cleanup.

Every action asks for confirmation identifying the affected notebook/kernel, PID and host. Process identity and ownership are rechecked after confirmation. Stop never silently escalates or falls back to process signals after an API failure. A signal being sent does not prove the process has exited. Supervising servers can restart kernels after SIGTERM/SIGKILL; the matched server shutdown route avoids that behavior. No action shuts down the entire Jupyter server.

## Development

Use Node.js 22+ and pnpm 11.14.0. Repository guidance is in `AGENTS.md`; Biome formats and checks TypeScript and JSON.

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test
pnpm package
```

Open this folder in VS Code and press F5 to run the extension development host. Compilation writes to `build/dist/`; packaging creates `build/jupyter-notebook-manager-<version>.vsix`. Generated output is ignored by Git. The extension has no production dependencies. The unused signing-tool build script is explicitly disabled in `pnpm-workspace.yaml`.

Version changes are tied to releases rather than ordinary edits. `pnpm package` uses an exact stable Git tag on HEAD (`vX.Y.Z` or `X.Y.Z`), including annotated tags. Without a matching tag, a Git checkout, or any commits, it uses the existing `package.json` version. Older ancestor tags are not used; conflicting release versions on HEAD fail packaging. The packaged manifest and VSIX filename use the resolved version; the source `package.json` and Git tags are never modified by packaging. Create release tags explicitly when ready to release, then run `pnpm package` from that tagged commit. The checked-in manifest version remains the development fallback until you explicitly change it.

Tests use temporary process/runtime fixtures, mock editor APIs, injected signal callbacks and a mock HTTP server. They verify both discovery modes, Python launch flags, idle-only diagnostics, busy-kernel caching, PID reuse, ownership isolation, credential handling and lifecycle routing. Tests never signal a real process. Mock-server shutdown tests only stop mock kernels.

## Current limits

- Linux only, with standard Python ipykernel module/script launches. Python `-X`, `-W`, unbuffered and common isolation/optimization flags are supported. Non-Python kernels and custom launch wrappers are not yet collected.
- CPU uses process tick deltas: one CPU core = 100%, so multithreaded jobs may exceed 100%. RAM is kernel-process RSS; worker subprocesses and GPU memory are not included. Process age is not notebook execution duration.
- Unix UID is the isolation boundary. People sharing an account share visibility and management privileges.
- External remote HTTP servers without local kernel processes are outside this extension's current scope. Password-only servers, Unix-socket endpoints and inaccessible/private runtime locations may prevent Lab metadata discovery; owned processes remain manageable.
- Connections and last activity are available from Jupyter server metadata, not the public editor API. Unmapped kernels are not automatically labeled orphans.
- Node's portable process signal API has a small check-to-signal race despite start-time revalidation; atomic protection would require Linux pidfd support.
- Read-only live checks found both kernels, resolved JupyterLab metadata, and matched editor PID 42566 to `test.ipynb`. Current-window API mapping and grouping are covered by tests; full installation and UI behavior in VS Code/Cursor still need manual verification.

