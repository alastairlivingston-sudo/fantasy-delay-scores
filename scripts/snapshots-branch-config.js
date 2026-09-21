// Writes the `snapshots` branch's own opt-out from Vercel deployments.
//
// The snapshots branch lives in the repo Vercel watches, so every push to it
// is a deploy trigger — and the live recorder pushes every ~3 minutes. That
// burns the free tier's 100 deployments/day and then blocks PRODUCTION deploys
// with the same cap (observed 2026-09-21: all 20 most recent deployments came
// from `snapshots`, ~one every 4 minutes, and the cap took the site's own
// deploys down with it).
//
// main's vercel.json has carried `git.deploymentEnabled: {"snapshots": false}`
// since 2026-09-14 and never helped: Vercel reads that setting from the
// vercel.json in the COMMIT BEING PUSHED, and the snapshots branch is an
// orphan branch whose tree is only `data/`. The guard sat on main, where
// nothing needed it, and never saw the branch it was written for.
//
// So the branch has to carry its own. Every path that builds the branch writes
// this file at its root before committing: record.yml, highlights.yml,
// backfill-highlights.yml and scripts/record-live.js.
//
// Usage: node scripts/snapshots-branch-config.js <branchRoot>

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

// Blanket false, not {"snapshots": false}: this file only ever exists on a
// branch that must not deploy, so it shouldn't depend on that branch keeping
// its name. The app is served from main, whose own vercel.json is untouched.
export const SNAPSHOTS_VERCEL_CONFIG = {
  $schema: 'https://openapi.vercel.sh/vercel.json',
  git: { deploymentEnabled: false },
};

/** Write the opt-out into a snapshots-branch working tree. */
export async function writeSnapshotsBranchConfig(branchRoot) {
  await writeFile(
    join(branchRoot, 'vercel.json'),
    `${JSON.stringify(SNAPSHOTS_VERCEL_CONFIG, null, 2)}\n`);
}

// Run directly by the workflows, which build the branch in shell.
if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2];
  if (!root) {
    console.error('usage: node scripts/snapshots-branch-config.js <branchRoot>');
    process.exit(1);
  }
  await writeSnapshotsBranchConfig(root);
  console.log(`wrote ${join(root, 'vercel.json')} (deployments disabled for this branch)`);
}
