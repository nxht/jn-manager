# Repository guidance

## Workflow

- Use pnpm for dependencies and project commands. Keep `pnpm-lock.yaml`; do not add npm or Yarn lockfiles.
- Keep code in TypeScript and prefer standard VS Code APIs.
- Run `pnpm format` after code edits and `pnpm check` before finishing. Run `pnpm test` for behavior changes and `pnpm package` for runtime or manifest changes.
- Do not bump the manifest version or create release tags unless requested. Packaging requires an exact `vX.Y.Z` or `X.Y.Z` tag on HEAD.
- Keep documentation simple: only core usage and instructions. Avoid implementation details, repeated explanations and work-session notes.
- Use the ignored `temp/` folder for temporary code, Markdown files and other scratch work. Create it when needed; do not commit its contents.
- Test with fixtures and mocks. Live checks must be read-only; never interrupt or stop the user's kernels for validation. Report automated checks separately from manual editor verification.

## Discovery

- Run on the Linux workspace host, including Remote SSH, WSL and containers. Support editor kernels with or without a Jupyter server.
- Discover only the current account's verified kernel processes and private runtime metadata. Exclude ordinary Python jobs and server processes.
- Find runtime directories automatically, including kernel connection directories. Never ask for server URLs or tokens. Verify server ownership and live identity, and use only loopback endpoints.
- Never log credentials, complete process environments, raw launch logs or process arguments.
- Match notebooks using exact identity evidence; never infer from workspace location or the focused notebook.
- Prefer the current-window Jupyter API. Probe only idle kernels with bounded execution; never start kernels or queue probes behind computation. Match PID and connection path, and cache by kernel handle, PID, start ticks and connection path.
- Use bounded, owned launch logs only as an optional fallback. Require one completed launch matching the exact connection path and process creation time; reject stale or conflicting evidence. Prefer live API/server metadata.

## Sidebar

- Show verified current-window kernels first. Use the current-window API or exact extension-host log location to establish membership.
- Group remaining kernels by server, then other editor kernels and unclassified kernels. Preserve server identity and shutdown routing regardless of display group.
- Use short notebook labels, with a count for shared kernels; fall back to Python/PID. Keep full paths copyable.
- Keep summaries and details concise. Use tree details, click-to-copy, Copy actions and Ctrl/Cmd+C; do not open documents on selection.
- Uptime is process lifetime, CPU is sampled process usage, and RAM is process RSS. These exclude worker subprocesses and GPU memory.

## Kernel actions

- Confirm actions, then recheck process identity and ownership.
- Stop matched server kernels through the revalidated Jupyter shutdown API. Use SIGTERM for raw/unmapped kernels, SIGINT for interrupt and SIGKILL only for explicit force kill.
- Never escalate a failed stop, fall back to signals after API failure, or shut down the whole server.
- Sending a signal does not prove that the process exited.
