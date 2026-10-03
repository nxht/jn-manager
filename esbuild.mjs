import { build } from 'esbuild';

await build({
  entryPoints: ['src/extension.ts', 'src/packaging.ts'],
  outdir: 'build/dist',
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
});
