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

## Verification

| Check | Coverage |
| --- | --- |
| Automated tests | `pnpm test`; fixtures and mocks |
| Read-only discovery | Owned process and notebook mapping; no lifecycle actions |
| Manual editor checks | Installation, sidebar layout, countdown, copy, filters and status-bar updates |
| Manual highlight checks | Warning/critical icons, status-bar alerts and selected-row styling |
| Manual lifecycle checks | Disposable fixture notebooks only |
| Package review | Manifest version, file allowlist and final VSIX |

