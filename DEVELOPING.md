# Development

Use Node.js 22.12+, pnpm 11.14.0 and VS Code 1.100+. See [AGENTS.md](AGENTS.md) for repository guidance.

Run `pnpm install --frozen-lockfile`, then press **F5** to launch the extension development host.

| Command | Purpose |
| --- | --- |
| `pnpm format` | Format code |
| `pnpm check` | Check formatting and lint |
| `pnpm test` | Type-check and run tests |
| `pnpm compile` | Compile to `dist/` |
| `pnpm package` | Build a VSIX in `build/` from an exact release tag on HEAD |
