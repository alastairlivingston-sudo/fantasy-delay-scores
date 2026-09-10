// Marathon recorder for the Sunday-night live window: 17:00 -> 04:00 UK
// wall-clock (~11h), far more than one GitHub-hosted job's 6-hour cap, and
// finer-grained than cron's ~5-minute reliability floor.
//
// Design: a single job loops internally (its own 60s sleep, immune to cron
// jitter once running) for up to ~5h20m, then — if the window isn't over yet
// — dispatches "leg 2" of itself via the Actions API and exits. Leg 2 has no
// further cutoff: by construction it starts with well under 6h left in the
// window, so it just runs to the natural end. The window's start/end are
// evaluated live against Europe/London time (js/schedule.js), so this needs
// no per-year DST date maintenance.
//
// Usage: node scripts/record-live.js <dataDir> [leg]   (leg: '1' or '2', default '1')
// Env: SLEEPER_USERNAME, GITHUB_TOKEN, GITHUB_REPOSITORY (all set by the workflow)

import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getNflState, getUser, getLeagues, getMatchups, getScoreboard, getStats } from '../js/api.js';
import { shouldAppend, isRollover } from '../js/snapshots.js';
import { pickStats } from '../js/newsflash.js';
import { isWindowStartHour, inRecordingWindow } from '../js/schedule.js';

const dataDir = process.argv[2];
const leg = process.argv[3] || '1';
if (!dataDir) { console.error('usage: node scripts/record-live.js <dataDir> [leg]'); process.exit(1); }

// Test-only overrides so a dry run can complete in seconds instead of hours
// (see BUILD_PLAN.md for the `node scripts/record-live.js` smoke-test recipe).
const SAFE_MS = Number(process.env.RECORD_LIVE_SAFE_MS) || 5 * 60 * 60_000 + 20 * 60_000;
const TICK_MS = Number(process.env.RECORD_LIVE_TICK_MS) || 60_000;
const HARD_ITERATION_CAP = Number(process.env.RECORD_LIVE_MAX_ITERATIONS) || 700; // ~11.6h backstop

const username = process.env.SLEEPER_USERNAME || 'AlastairL';
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
// Overridable so a dry run can point at a local bare repo instead of the real
// remote — this script has ambient push access in some environments, so
// testing against the real URL is not a safe default.
const remoteUrl = process.env.RECORD_LIVE_REMOTE || `https://github.com/${repo}.git`;

if (leg === '1' && !isWindowStartHour()) {
  console.log('not the real 17:00 (this is the other DST candidate) — no-op');
  process.exit(0);
}

function git(cmd) { return execSync(`git ${cmd}`, { cwd: dataDir, stdio: 'pipe' }).toString(); }

function ensureRepo() {
  if (!existsSync(join(dataDir, '.git'))) {
    execSync(`git init -q -b snapshots`, { cwd: dataDir });
    execSync(`git config user.name "snapshot-recorder"`, { cwd: dataDir });
    execSync(`git config user.email "actions@github.com"`, { cwd: dataDir });
  }
}

let committedOnce = false;
function commitAndPush(message) {
  git('add -A');
  try {
    git(`commit -q ${committedOnce ? '--amend' : ''} -m ${JSON.stringify(message)}`);
  } catch (err) {
    // Only "nothing to commit" is benign — anything else (bad identity, repo
    // corruption, ...) must surface, or a real failure could go unnoticed for
    // the rest of an unattended multi-hour run.
    const out = `${err.stdout || ''}${err.stderr || ''}`;
    if (!out.includes('nothing to commit')) throw err;
    return;
  }
  committedOnce = true;
  execSync(
    `git -c http.extraHeader="AUTHORIZATION: bearer ${token}" push -qf ${remoteUrl} HEAD:snapshots`,
    { cwd: dataDir, stdio: 'pipe' });
}

async function recordOnce() {
  const state = await getNflState();
  const season = Number(state.season);
  const week = Math.min(Math.max(state.week || 1, 1), 18);
  const user = await getUser(username);
  const [leagues, games, stats] = await Promise.all([
    getLeagues(user.user_id, season),
    getScoreboard(season, week),
    getStats(season, week).catch(() => ({})), // news-flash detail is optional
  ]);
  const gameStates = {};
  for (const g of games) gameStates[g.gameKey] = { state: g.state, progress: g.progress };

  let anyAppended = false;
  for (const league of leagues) {
    const matchups = await getMatchups(league.league_id, week);
    const players_points = {};
    const player_stats = {};
    for (const m of matchups) {
      Object.assign(players_points, m.players_points || {});
      for (const pid of m.starters || []) {
        const picked = pickStats(stats[pid]);
        if (Object.keys(picked).length) player_stats[pid] = picked;
      }
    }
    const snap = { t: Date.now(), players_points, gameStates, player_stats };

    const file = join(dataDir, 'data', `${league.league_id}.json`);
    let stored = null;
    try { stored = JSON.parse(await readFile(file, 'utf8')); } catch { /* new file */ }
    if (isRollover(stored, season, week)) stored = { season, week, leagueId: league.league_id, snapshots: [] };
    const last = stored.snapshots[stored.snapshots.length - 1];
    if (shouldAppend(last, snap)) {
      stored.snapshots.push(snap);
      await writeFile(file, JSON.stringify(stored));
      anyAppended = true;
    }
  }
  return anyAppended;
}

function dispatchLeg2() {
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/record-live.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { leg: '2' } }),
  });
}

await mkdir(join(dataDir, 'data'), { recursive: true });
ensureRepo();
try {
  execSync(`git fetch -q ${remoteUrl} snapshots`, { cwd: dataDir, stdio: 'pipe' });
  execSync(`git checkout -q FETCH_HEAD -- data`, { cwd: dataDir, stdio: 'pipe' });
} catch { /* no snapshots branch yet, or no prior data for this week */ }

console.log(`leg ${leg} starting`);
const start = Date.now();
for (let i = 0; i < HARD_ITERATION_CAP; i++) {
  if (!process.env.RECORD_LIVE_IGNORE_WINDOW && !inRecordingWindow()) { console.log('window over'); break; }
  if (leg === '1' && Date.now() - start > SAFE_MS) {
    console.log('safety cutoff reached, dispatching leg 2');
    await dispatchLeg2();
    break;
  }

  const tickStart = Date.now();
  try {
    const appended = await recordOnce();
    // Every ~10th tick, also try resolving highlight links for games that
    // have finished (cheap no-op when nothing new; keeps YouTube usage low).
    let resolved = false;
    if (i % 10 === 0) {
      try {
        execSync(`node scripts/resolve-highlights.js ${join(dataDir, 'data')}`, { stdio: 'inherit' });
        resolved = true;
      } catch (err) { console.warn('highlight resolve failed, continuing:', err.message); }
    }
    // Push on a resolve too, not just an append: once every game is final the
    // scores stop changing, so `appended` goes false for the rest of the window
    // — which is exactly when the highlight uploads land. Gating the push on
    // `appended` alone left them sitting in the runner's working tree until the
    // job ended. commitAndPush is a no-op when nothing actually changed.
    if (appended || resolved) commitAndPush(`snapshot ${new Date().toISOString()}`);
  } catch (err) {
    console.warn('tick failed, continuing:', err.message);
  }
  const elapsed = Date.now() - tickStart;
  if (elapsed < TICK_MS) await new Promise((r) => setTimeout(r, TICK_MS - elapsed));
}
console.log(`leg ${leg} done`);
