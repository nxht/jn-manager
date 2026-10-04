# Release readiness

Packaging requires an exact stable release tag on HEAD and has no manifest fallback. The source manifest uses `0.0.0` only as a development placeholder. Packaging writes the tag version into the VSIX without modifying the source manifest or Git tags.

- Release metadata links to the source repository and issue tracker.
- Package contents are explicitly limited to runtime files and end-user documentation.
- Notebook launch fallback rejects duplicate/conflicting evidence and preserves live metadata, current-window membership and server shutdown routing.
- Metadata joins use indexed lookups and withhold ambiguous process/server IDs.
- Process collection checks start ticks before and after reading identity data.

Before release, run `pnpm format`, `pnpm check`, `pnpm test` and `pnpm package`, then inspect the VSIX. Automated tests use fixtures and mocks; no live kernel lifecycle actions are needed. Manual installation/UI checks in VS Code/Cursor and verification of Marketplace publisher access remain release steps. Publish the validated VSIX. Do not create or push release tags without an explicit request.

Cleanup removes unused discovery counters, unused server metadata and the test-only kernel-ID wrapper and an unused shutdown callback in the signal helper. Server shutdown continues through the revalidated discovery route. Editor mapping and HTTP request setup are consolidated, and process collection uses two identity samples instead of three while preserving start-time/ownership checks.

The status bar totals RSS across all discovered owned kernel processes, independent of sidebar visibility filters. It activates after startup and keeps lightweight process monitoring running with the sidebar closed. Shared kernels count once; workers and GPU memory are excluded.

Compact sidebar layout: CPU → MB → uptime kernel summaries, separate detail labels/values, `Total n MB` group totals and an `mm:ss` refresh countdown in the header. Copy actions and full-path tooltips are preserved.

Sidebar polish: clock uptime icon and native theme icons for groups, details and lifecycle actions. Launch matching uses process start ticks rather than proc-directory timestamps and allows less than one minute of client/host clock skew with unique exact connection-path evidence.

CPU detail icon: `chip`, selected by the user. RAM uses `circuit-board` for the first trial; usage-style alternatives are being compared.

Tests live in `test/` outside runtime source. Vitest runs TypeScript tests with native spies, module mocks and fake timers; `pnpm test` also type-checks the tests. Runtime compilation excludes tests, and packaging keeps test tooling out of the VSIX.

Native ESM: manifest uses `type: module` and VS Code 1.100+; source/tooling use ESM, including URL-based packaging entry detection. TypeScript 7 checks and emits native ESM modules directly using NodeNext resolution and explicit `.js` imports. Runtime modules are shipped; tests and packaging tooling are excluded, with source maps available locally. No bundler is needed.

Sidebar icons: native VS Code icons throughout, including the activity bar; no custom icon colors or SVG assets. Threshold text highlighting remains available. Other editor kernels use the concise **Other Kernels** label; the separate fallback is **Unclassified Kernels**. Packaging uses the current `dist/` layout and still requires an exact release tag.
