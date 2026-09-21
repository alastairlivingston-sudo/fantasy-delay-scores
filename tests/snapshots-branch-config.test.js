import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SNAPSHOTS_VERCEL_CONFIG, writeSnapshotsBranchConfig } from '../scripts/snapshots-branch-config.js';

// The whole point of this file is one boolean. Getting it wrong doesn't fail
// anything loudly — it just quietly re-enables a deploy per push, which is how
// the free daily cap got burned (and production deploys blocked) in the first
// place. So assert on the written file, not the exported object alone.

test('the written config disables deployments for the branch it lands on', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-cfg-'));
  await writeSnapshotsBranchConfig(dir);
  const written = JSON.parse(await readFile(join(dir, 'vercel.json'), 'utf8'));
  assert.equal(written.git.deploymentEnabled, false);
});

test('it is a blanket opt-out, not one keyed to the branch name', async () => {
  // A {"snapshots": false} map would stop working the day the branch is
  // renamed, and reads as if it were main's (ineffective) config.
  assert.equal(typeof SNAPSHOTS_VERCEL_CONFIG.git.deploymentEnabled, 'boolean');
});

test('the file is valid JSON with a trailing newline', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'snap-cfg-'));
  await writeSnapshotsBranchConfig(dir);
  const raw = await readFile(join(dir, 'vercel.json'), 'utf8');
  assert.ok(raw.endsWith('\n'));
  assert.doesNotThrow(() => JSON.parse(raw));
});
