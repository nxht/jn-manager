import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Only exact stable release tags are package versions; never infer a release from an ancestor.
export function taggedVersion(tags: string[]): string {
  const versions = new Set(
    tags
      .filter((tag) => /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(tag))
      .map((tag) => tag.replace(/^v/, '')),
  );
  if (versions.size > 1)
    throw new Error('Conflicting release tags on HEAD; keep one release version.');
  const version = [...versions][0];
  if (!version)
    throw new Error('Packaging requires an exact release tag on HEAD (vX.Y.Z or X.Y.Z).');
  return version;
}

export function packageVersion(root: string): string {
  const options = { cwd: root, encoding: 'utf8' as const, stdio: 'pipe' as const };
  try {
    execFileSync('git', ['rev-parse', '--verify', 'HEAD'], options);
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & { status?: number };
    if (failure.code !== 'ENOENT' && failure.status !== 128) throw error;
    throw new Error('Packaging requires Git and a committed, release-tagged checkout.');
  }
  const tags = execFileSync('git', ['tag', '--points-at', 'HEAD'], options).trim().split(/\r?\n/);
  return taggedVersion(tags);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const version = packageVersion(root);
  console.log(`Packaging version ${version} from the exact release tag on HEAD.`);
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
