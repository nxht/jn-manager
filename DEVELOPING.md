# Developing Jupyter Notebook Manager

Use Node.js 22.12+ and pnpm 11.14.0. Repository guidance is in `AGENTS.md`; Biome formats and checks TypeScript and JSON.

```sh
pnpm install --frozen-lockfile
pnpm format
pnpm check
pnpm test
pnpm package
```

Open this folder in VS Code and press F5 to run the extension development host. The project uses native ESM (`type: module`) and requires VS Code 1.100+ (including the corresponding API types). `pnpm compile` uses TypeScript 7 to check and emit native ESM files into `dist/`; packaging creates `build/jupyter-notebook-manager-<version>.vsix`. Generated output is ignored by Git. The extension has no production dependencies. The unused signing-tool build script is disabled in `pnpm-workspace.yaml`; esbuild binary setup remains enabled only for Vitest/Vite’s transitive dependency. The VSIX uses an explicit file allowlist: only the runtime ESM modules, manifest, README and license are shipped; tests, packaging tooling and source maps are excluded. NodeNext module resolution checks native ESM imports, including explicit `.js` suffixes. The editor supplies the `vscode` module. Source maps remain available locally for debugging.

Version changes are tied to releases rather than ordinary edits. `pnpm package` uses an exact stable Git tag on HEAD (`vX.Y.Z` or `X.Y.Z`), including annotated tags. Without a matching tag, a Git checkout, or any commits, packaging fails. Older ancestor tags are not used; conflicting release versions on HEAD fail packaging. The packaged manifest and VSIX filename use the resolved version; the source `package.json` and Git tags are never modified by packaging. Create release tags explicitly when ready to release, then run `pnpm package` from that tagged commit. The checked-in manifest version is `0.0.0`, a development placeholder; it is never used as a release version.

Tests live in the top-level `test/` directory. `pnpm test` type-checks the source and tests, then runs Vitest directly against TypeScript; tests are not compiled into `dist/`. Use `pnpm exec vitest` for watch mode. Tests use temporary process/runtime fixtures, mock editor APIs, injected signal callbacks and a mock HTTP server. They verify both discovery modes, Python launch flags, idle-only diagnostics, busy-kernel caching, PID reuse, ownership isolation, credential handling and lifecycle routing. Tests never signal a real process. Mock-server shutdown tests only stop mock kernels.

## Discovery and notebook identity

**JupyterLab / Notebook:** The extension finds the current user's `jpserver-*.json` and `nbserver-*.json` runtime files. It searches the directories of running kernels' connection files as well as standard Jupyter/XDG locations. This works when an editor kernel and a Lab kernel use different virtual environments or runtime directories. Existing credentials are read from private, owned runtime files and held briefly in memory; they are never displayed, logged or requested from the user. Endpoints must be on loopback, and the server PID must be a live Jupyter process belonging to the same Unix account. Only exact kernel-ID joins to owned processes appear in the view.

**VS Code / Cursor:** The supported Microsoft Jupyter extension API maps open notebooks to live kernels. For an idle Python kernel, a small diagnostic reads its PID and connection-file path, then matches both to the owned process list. The Jupyter API executes this without adding notebook cells or changing execution history/count. It does execute a short Python request, which may briefly affect kernel status. Jupyter may show its native kernel-access permission prompt once; denying access still leaves process monitoring and actions available. No connection-file contents are read for editor mapping.

Notebook associations are cached against kernel handle, PID, process start ticks and connection-file path. Busy kernels use a previously verified mapping. The extension does not queue diagnostics behind a busy kernel, start a kernel, read the editor's private credential database or guess notebook names from the focused file/working directory. Open notebooks sharing a kernel appear together.

The Jupyter API sees only its own editor window. For kernels from another window, or unavailable API mappings, a read-only fallback checks this account's local Jupyter extension logs. A notebook is associated only when a single completed launch records the exact connection-file path and a matching process creation time. Overlapping or conflicting launch evidence is withheld. This also works while a kernel is busy. Logs are size bounded, owned files only, and never echoed. A log association identifies the notebook at launch; later renames or additional attachments in another window may be unavailable. Current-window API/session metadata takes precedence over launch logs.

## Visibility and presentation

Both settings default to `true` and take effect on refresh after changing Settings:

- `jnManager.includeExternalServers`: show locally discovered JupyterLab/Notebook server groups outside this editor window.
- `jnManager.includeOtherWindows`: show other VS Code/Cursor kernels, including editor kernels whose window cannot be verified.

Verified **Current window** kernels always remain visible, including kernels attached to a Jupyter server. Server grouping takes precedence for remaining kernels, so server-backed kernels follow `includeExternalServers`. **Unclassified Kernels** remain visible because their origin is unknown. These settings filter the sidebar and its count after notebook identity discovery; they preserve server routing for lifecycle actions. External servers here means automatically discovered loopback servers on the Linux workspace host, not remote HTTP servers without owned local processes.

CPU, RAM and uptime detail text uses yellow for warnings and red for critical values. The kernel label also takes the highest severity. CPU thresholds use the percentage of **all host logical CPUs** (a process using 800% CPU on eight CPUs reaches 100% of the host). RAM thresholds use process RSS as a percentage of total host RAM. Uptime means process lifetime.

| Setting (`jnManager.highlights.` prefix) | Default | Meaning |
| --- | --- | --- |
| `enabled` | `true` | Enable resource highlights |
| `cpuWarningPercent` / `cpuCriticalPercent` | `80` / `100` | At or above this percentage of all CPUs |
| `memoryWarningPercent` / `memoryCriticalPercent` | `80` / `90` | Above this percentage of total RAM |
| `uptimeWarningHours` / `uptimeCriticalHours` | `24` / `48` | Above this many hours |

Change these in Settings under **Jupyter Notebook Manager**. Critical takes precedence; keep critical thresholds at or above warning thresholds. Customize the colors with `jnManager.warningForeground` and `jnManager.criticalForeground` in `workbench.colorCustomizations`. Text decorations follow VS Code's `explorer.decorations.colors` setting. All icons use native theme icons with no assigned colors. Selected text follows the editor theme's selection styling.

The Refresh button retains its normal appearance while discovery runs in the background. Repeated refresh requests share the current discovery operation.

## Lifecycle actions

- **Interrupt:** Sends SIGINT after ownership/identity revalidation. Requests cancellation of the current computation.
- **Stop:** For an automatically matched Jupyter server, revalidates the live server and kernel, then uses Jupyter's kernel shutdown API. For a raw/unmapped kernel, sends SIGTERM.
- **Force Kill:** Sends SIGKILL explicitly, without allowing cleanup.

Every action asks for confirmation identifying the affected notebook/kernel, PID and host. Process identity and ownership are rechecked after confirmation. Stop never silently escalates or falls back to process signals after an API failure. A signal being sent does not prove the process has exited. Supervising servers can restart kernels after SIGTERM/SIGKILL; the matched server shutdown route avoids that behavior. No action shuts down the entire Jupyter server.

## Implementation limits and verification

- Linux only, with standard Python ipykernel module/script launches. Python `-X`, `-W`, unbuffered and common isolation/optimization flags are supported. Non-Python kernels and custom launch wrappers are not yet collected.
- CPU uses process tick deltas: one CPU core = 100%, so multithreaded jobs may exceed 100%. RAM is kernel-process RSS; worker subprocesses and GPU memory are not included. Process age is not notebook execution duration.
- Unix UID is the isolation boundary. People sharing an account share visibility and management privileges.
- External remote HTTP servers without local kernel processes are outside this extension's current scope. Password-only servers, Unix-socket endpoints and inaccessible/private runtime locations may prevent Lab metadata discovery; owned processes remain manageable.
- Unmapped kernels are not automatically labeled orphans.
- Node's portable process signal API has a small check-to-signal race despite start-time revalidation; atomic protection would require Linux pidfd support.
- Current-window API mapping, grouping and lifecycle routing are covered by fixture tests. Full installation and UI behavior in VS Code/Cursor still need manual verification.

Manual verification in VS Code/Cursor should cover activity-bar placement, refresh behavior, copy actions, visibility settings, threshold text colors and selected-row styling. Automated fixture tests and read-only discovery checks do not establish that the installed UI works. Never interrupt, stop or kill a user's running kernel to validate a change.

## Before publishing

Run the checks above from the final source state and inspect the packaged manifest and file list. An exact stable release tag on HEAD is required; there is no manifest fallback. Confirm that the Marketplace publisher `jn-manager` exists and that your publishing account has access. Publish the already validated VSIX so its tag-derived version is preserved; do not run a separate publish build against the development manifest. Publisher access is a release-account requirement, not established by local packaging.

Perform the manual VS Code/Cursor verification described above using disposable fixture notebooks. Do not use running user kernels for lifecycle testing. Keep publishing credentials out of the repository and VSIX.

The runtime keeps only metadata used by the sidebar and lifecycle actions. Discovery returns kernel rows directly; editor mappings use PID lookups, and HTTP authentication/redirect handling is shared by metadata reads and shutdown requests.

The status bar shows the sum of RSS from the owned process snapshot before sidebar filtering. Shared notebooks are counted once per kernel process. Monitoring activates after editor startup and continues at `jnManager.refreshSeconds` when the sidebar is hidden; hidden-sidebar refreshes skip server metadata, editor diagnostics and launch-log discovery. Failed collection hides the status item rather than retaining an outdated total. Manual verification should include startup, background updates, status-bar click navigation, zero kernels and visibility settings.

The compact native sidebar separates detail labels from values using tree item descriptions. CPU, RAM, uptime and PID appear before notebook/interpreter details. CPU is omitted until a sample is available. Memory uses rounded decimal MB. Group descriptions show `Total n MB`, and the sidebar header shows an `mm:ss` countdown before the native action toolbar; the status bar still totals all discovered kernels. Full values remain available through tooltips and copy actions. Native tree descriptions use editor-controlled spacing rather than fixed table columns.

The one-second countdown does not collect processes each second: collection follows the configured refresh interval, which restarts when discovery completes. CPU uses the `chip` icon; RAM uses `circuit-board` for the first trial. Notebook launch matching allows less than one minute of client/host clock skew, still requiring a unique completed launch with the exact connection path.

All tree, action, view and activity-bar icons use native VS Code icons, with no custom icon colors or SVG assets. Other editor windows are labeled **Other Kernels**; the separate fallback is **Unclassified Kernels**.
