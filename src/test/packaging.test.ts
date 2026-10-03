import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import test from 'node:test';
import { packageVersion, taggedVersion } from '../packaging';

test('use an exact stable release tag and normalize its optional v prefix', () => {
  assert.equal(taggedVersion(['v1.2.3', 'notes'], '0.1.4'), '1.2.3');
  assert.equal(taggedVersion(['1.2.3', 'v1.2.3'], '0.1.4'), '1.2.3');
});

test('retain the manifest version without an exact stable tag and reject conflicting releases', () => {
  assert.equal(taggedVersion([], '0.1.4'), '0.1.4');
  assert.equal(taggedVersion(['v01.2.3', 'v1.2.3-beta', 'release', 'v1.2'], '0.1.4'), '0.1.4');
  assert.throws(() => taggedVersion(['v1.2.3', 'v2.0.0'], '0.1.4'), /Conflicting release tags/);
});

test('read lightweight and annotated HEAD tags without using previous commits or changing Git', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jn-packaging-'));
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
  try {
    assert.equal(packageVersion(root, '0.1.4'), '0.1.4');
    git('init');
    assert.equal(packageVersion(root, '0.1.4'), '0.1.4');
    git(
      '-c',
      'user.name=Packaging Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'fixture',
    );
    git('tag', 'v2.3.4');
    assert.equal(packageVersion(root, '0.1.4'), '2.3.4');
    git('tag', '-d', 'v2.3.4');
    git(
      '-c',
      'user.name=Packaging Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'tag',
      '-a',
      'v2.3.4',
      '-m',
      'fixture release',
    );
    const before = git('show-ref');
    assert.equal(packageVersion(root, '0.1.4'), '2.3.4');
    assert.equal(git('show-ref'), before);
    git(
      '-c',
      'user.name=Packaging Fixture',
      '-c',
      'user.email=fixture@example.invalid',
      'commit',
      '--allow-empty',
      '-m',
      'next fixture',
    );
    assert.equal(packageVersion(root, '0.1.4'), '0.1.4');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
