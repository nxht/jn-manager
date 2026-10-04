# Development

## Setup

| Tool | Requirement |
| --- | --- |
| Node.js | 22.12+ |
| pnpm | 11.14.0 |
| VS Code | 1.100+ |
| Repository rules | [AGENTS.md](AGENTS.md) |

```sh
pnpm install --frozen-lockfile
```

Open the workspace in VS Code and press **F5** to launch the extension development host.

## Commands

| Command | Purpose |
| --- | --- |
| `pnpm format` | Format TypeScript and JSON with Biome |
| `pnpm check` | Check formatting and lint |
| `pnpm test` | Type-check source/tests and run Vitest |
| `pnpm exec vitest` | Run tests in watch mode |
| `pnpm compile` | Compile native ESM into `dist/` |
| `pnpm package` | Build a VSIX in `build/` |

Keep `pnpm-lock.yaml`. Do not bump the manifest version or create release tags for routine edits.

| Packaged | Excluded |
| --- | --- |
| Runtime modules, manifest, README, licenses, icon | Tests, source maps, development tooling |

## Discovery

| Source | Required evidence | Limits |
| --- | --- | --- |
| Linux processes | Current account's live ipykernel process | Excludes other users, servers and ordinary Python jobs |
| Jupyter server | Private owned runtime file, live owned server, loopback endpoint, exact kernel ID | Searches standard runtime locations and kernel connection directories; credentials stay private |
| Current-window API | Exact PID and connection path | Bounded diagnostics on idle kernels only; never starts kernels or queues behind busy work |
| Editor launch logs | One completed launch, exact connection path and matching process creation time | Owned, size-bounded logs; stale, overlapping or conflicting evidence rejected |

API mappings are cached by kernel handle, PID, start ticks and connection path. Live API/server metadata takes precedence over launch logs. Missing logs must not block monitoring. Never infer notebook identity from the working directory or focused notebook.

## Sidebar

User settings, defaults and measurements are in the [README](README.md#settings).

| Group | Membership |
| --- | --- |
| Current window | Verified by this window's API or exact extension-host log location; always first |
| Jupyter servers | Remaining server-backed kernels |
| Other Kernels | Remaining editor kernels |
| Unclassified Kernels | Unknown origin; always visible |

Current-window membership overrides display grouping while preserving server routing for shutdown.

| Feature | Behavior |
| --- | --- |
| Resource alerts | Native detail icons carry metric severity; kernel icon carries highest severity |
| Text decorations | Follow `explorer.decorations.colors` and editor selection styling |
| Copy | Details stay in the tree; selection never opens a text document |
| Status bar | Total owned-process RSS before visibility filters; shared kernels counted once |
| Total RAM alerts | Separate `totalMemoryWarningPercent` / `totalMemoryCriticalPercent` thresholds; warning/error icon and native status-bar background; cleared below threshold or when highlights are disabled |
| Hidden sidebar | Continue memory sampling; skip server metadata, editor diagnostics and launch logs |
| Collection failure | Hide the status item |
| Countdown | Update every second; collect only at the configured interval |
| Refresh | Coalesce repeated requests; restart the interval after collection completes |

## Lifecycle

Confirm the action, then recheck process identity and ownership.

| Action | Route |
| --- | --- |
| Interrupt | SIGINT |
| Stop: matched server kernel | Revalidated Jupyter kernel shutdown API |
| Stop: raw/unmapped kernel | SIGTERM |
| Force Kill | Explicit SIGKILL |

Never escalate a failed stop, signal after an API shutdown failure, or shut down the whole server. Sending a signal does not prove exit; supervisors may restart the process. Portable signal handling retains a small identity-check-to-signal race.

## Verification

| Check | Coverage |
| --- | --- |
| Automated tests | Process/runtime fixtures, mocked editor APIs, injected signals and mock HTTP servers |
| Read-only discovery | Owned process and notebook mapping; no lifecycle actions |
| Manual editor checks | Installation, sidebar layout, countdown, copy, filters and status-bar updates |
| Manual highlight checks | Zero uptime threshold; total RAM status-bar alerts and clearing; warning/critical icons with Explorer colors disabled; selected-row styling |
| Manual lifecycle checks | Disposable fixture notebooks only |
| Package review | Manifest version, file allowlist and final VSIX |

Never interrupt, stop or kill a user's running kernel for validation. Automated tests do not establish installed UI behavior. Before publishing, complete checks, verify publisher access and publish the reviewed VSIX. Keep credentials out of the repository and package.

## Limits

| Area | Limit |
| --- | --- |
| Kernels | Linux Python ipykernel launches; custom wrappers and non-Python kernels unsupported |
| Isolation | Unix UID; users sharing an account share visibility and management access |
| Servers | Local loopback only; inaccessible metadata may leave notebook names unavailable |
| Measurements | Kernel process only; excludes worker RSS and GPU memory |
| Unmapped kernels | Remain monitorable; never automatically labeled orphans |
