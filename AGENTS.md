# Repository guidance

## Tooling and validation

- Use pnpm for dependency installation and all project commands. Keep `pnpm-lock.yaml` committed; do not introduce npm or Yarn lockfiles.
- Use Biome for TypeScript/JSON formatting and linting. Run `pnpm format` when editing code and `pnpm check` before finishing.
- Validate behavior changes with `pnpm test`; build the extension with `pnpm package` when changing its runtime or manifest.
- Keep the extension in TypeScript and use standard VS Code APIs where possible.
- Do not automatically bump `package.json` version for changes. Packaging derives the release version from an exact `vX.Y.Z` or `X.Y.Z` Git tag on HEAD, falling back to the manifest version. Never create or push release tags unless explicitly requested.
- Use fixtures and mocks for lifecycle tests. Never interrupt, stop or kill the user's running kernels to validate a change. Live discovery checks must remain read-only.
- Distinguish automated tests and read-only discovery checks from manual verification in VS Code/Cursor. Keep README.md and PLAN.md aligned with behavior changes and the packaged version.

## Discovery and notebook identity

- Run on the Linux workspace host, including Remote SSH, WSL and dev containers. Support both editor-launched raw kernels and JupyterLab/Notebook kernels; an editor kernel may have no Jupyter server.
- Discovery must work without asking the user for a Jupyter server URL or token. Read only the current Linux account's runtime metadata and processes. Never log credentials or complete process environments.
- Discover private, owned server runtime files automatically, including directories found from running kernels' connection paths. Different kernels can use different virtual environments and runtime directories. Verify the live server process and allow only loopback endpoints before using discovered credentials.
- Show only verified owned kernel processes. Exclude other users' kernels, ordinary Python jobs and server processes from the kernel list.
- Notebook associations must be based on exact identity evidence; never guess from the working directory or the currently focused notebook.
- Prefer the supported Jupyter extension API for notebooks in the current window. Match diagnostic PID and connection path to the owned process list. Probe only idle kernels, bound diagnostic execution, and cache against kernel handle, PID, start ticks and connection path. Never start a kernel or queue diagnostics behind busy computation.
- The Jupyter API only sees its own editor window. For unavailable mappings and kernels in other windows, use bounded, owned Jupyter extension launch logs as a read-only fallback. Require a single completed launch with the exact connection path and matching process creation time; reject stale, overlapping or conflicting evidence. Never echo raw logs or process arguments.
- Launch-log names describe the notebook at launch and may miss later renames or attachments. Prefer live API/server notebook metadata. Treat log parsing as optional: missing or incompatible logs must not prevent process monitoring.

## Sidebar and copying

- Put kernels verified as belonging to this editor window under **Current window**, first. Determine membership from the current-window API or the exact extension-host log location, never from filename or workspace proximity.
- Group remaining kernels by Jupyter server. Keep other editor kernels separate, with a fallback group for unclassified kernels. Current-window membership takes precedence over server grouping without losing the server identity needed for shutdown.
- Use short notebook filenames as kernel labels; for shared kernels use the first filename plus a count. Fall back to a compact Python/PID label rather than a long connection identifier. Preserve full paths in copyable details.
- Keep the UI concise: show CPU/RAM summaries and process uptime in details. Avoid explanatory prose such as `(one core = 100%)`, redundant descriptions and unavailable metadata placeholders in detail rows.
- Do not open `.txt` files or editor documents when selecting kernels. Keep details in the tree, with click-to-copy, Copy actions and Ctrl/Cmd+C support.
- Uptime means process lifetime, not cell execution duration. CPU is sampled process usage; RAM is process RSS. Do not imply these include worker subprocesses or GPU memory.

## Lifecycle actions

- Recheck process identity and ownership after confirmation before any lifecycle action.
- Stop a matched server kernel through the revalidated Jupyter shutdown API. Use SIGTERM for raw/unmapped kernels, SIGINT for interrupt and SIGKILL only for an explicit force-kill action.
- Do not silently escalate a failed graceful stop to force kill or fall back to signals after an API shutdown failure. Never shut down the entire Jupyter server when acting on a kernel.
- Preserve server routing and identity when enriching notebook metadata or changing display groups. Do not report a signal being sent as proof that the process has exited.
