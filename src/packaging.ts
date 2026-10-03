import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as path from 'node:path';

// Only exact stable release tags are package versions; never infer a release from an ancestor.
export function taggedVersion(tags: string[], fallback: string): string {
  const versions = new Set(
    tags
      .filter((tag) => /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
      .map((tag) => tag.replace(/^v/, '')),
  );
  if (versions.size > 1)
    throw new Error('Conflicting release tags on HEAD; keep one release version.');
  return [...versions][0] ?? fallback;
}

export function packageVersion(root: string, fallback: string): string {
  const options = { cwd: root, encoding: 'utf8' as const, stdio: 'pipe' as const };
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options);
  } catch {
    // Source archives and repositories without commits still support local packaging.
    return fallback;
  }
  const tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], options).trim().split(/\r?\n/);
  return taggedVersion(tags, fallback);
}

if (require.main === module) {
  const root = path.resolve(__dirname, '../..');
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const version = packageVersion(root, manifest.version);
  console.log(`Packaging version ${version} (exact release tag on HEAD, or manifest fallback).`);
  execFileSync(
    'pnpm',
    [
      'exec',
      'vsce',
      'package',
      version,
      '--no-update-package-json',
      '--no-git-tag-version',
      '--no-dependencies',
      '--out',
      'build/',
    ],
    { cwd: root, stdio: 'inherit' },
  );
}
