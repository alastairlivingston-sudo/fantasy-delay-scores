// Marathon recorder: 60-second Sleeper snapshots (for delay mode) plus regular
// highlight resolution, for as long as there is live NFL activity. This is the
// only mechanism that gives a real per-minute cadence, because GitHub's cron
// delivery cannot: it drops most scheduled runs and delivers the rest hours
// late, so nothing that depends on a run firing *at* a particular time works.
//
// Design: one job loops internally on its own 60s timer — immune to cron
// jitter once running — for up to ~5h20m, then dispatches the next leg of
// itself via the Actions API and exits, so a window longer than a job's
// 6-hour cap is covered by a chain of legs.
//
// Two things make a badly-timed cron delivery harmless, which is the whole
// point (see js/schedule.js for the failure this replaces):
//   - the window comes from the WEEK'S GAMES, not the wall clock, so a run
//     delivered late still finds it open and starts recording;
//   - a run delivered EARLY sleeps until the window opens rather than
//     exiting, turning a useless delivery into a perfectly-timed start.
//
// Usage: node scripts/record-live.js <dataDir> [leg]   (leg: 1, 2, 3, …)
// Env: SLEEPER_USERNAME, GITHUB_TOKEN, GITHUB_REPOSITORY (all set by the workflow)

import { execSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { getNflState, getUser, getLeagues, getMatchups, getScoreboard, getStats } from '../js/api.js';
import { shouldAppend, isRollover } from '../js/snapshots.js';
import { pickStats } from '../js/newsflash.js';
import { shouldRecord, nextWindowStart, recordingEndsAt } from '../js/schedule.js';

const dataDir = process.argv[2];
const leg = process.argv[3] || '1';
if (!dataDir) { console.error('usage: node scripts/record-live.js <dataDir> [leg]'); process.exit(1); }

// Test-only overrides so a dry run can complete in seconds instead of hours
// (see BUILD_PLAN.md for the `node scripts/record-live.js` smoke-test recipe).
const SAFE_MS = Number(process.env.RECORD_LIVE_SAFE_MS) || 5 * 60 * 60_000 + 20 * 60_000;
const TICK_MS = Number(process.env.RECORD_LIVE_TICK_MS) || 60_000;
const HARD_ITERATION_CAP = Number(process.env.RECORD_LIVE_MAX_ITERATIONS) || 700; // ~11.6h backstop
// Resolve highlights every Nth tick. Cheap by construction: the resolver's
// per-game backoff means most passes search nothing at all, so this buys
// latency (a highlight shows up within ~2 min of appearing) not quota.
const HIGHLIGHT_EVERY = Number(process.env.RECORD_LIVE_HIGHLIGHT_EVERY) || 2;
// How long a too-early run will wait for the window rather than giving up.
// Bounded so the job still fits inside its 6-hour cap with time left to record.
const MAX_WAIT_MS = Number(process.env.RECORD_LIVE_MAX_WAIT_MS) || 4 * 60 * 60_000;
// Stop the chain running away if a schedule ever looks permanently open.
const MAX_LEG = Number(process.env.RECORD_LIVE_MAX_LEG) || 8;

const username = process.env.SLEEPER_USERNAME || 'AlastairL';
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GITHUB_TOKEN;
// Overridable so a dry run can point at a local bare repo instead of the real
// remote — this script has ambient push access in some environments, so
// testing against the real URL is not a safe default.
const remoteUrl = process.env.RECORD_LIVE_REMOTE || `https://github.com/${repo}.git`;
// Chain onto the ref this leg is running from, not a hardcoded 'main': a run
// dispatched from a branch must continue on that branch, or leg 2 silently
// runs different code from leg 1.
const ref = process.env.RECORD_LIVE_REF || process.env.GITHUB_REF_NAME || 'main';

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

  let appended = false;
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
      appended = true;
    }
  }
  return { appended, games };
}

function dispatchNextLeg(next) {
  return fetch(`https://api.github.com/repos/${repo}/actions/workflows/record-live.yml/dispatches`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      accept: 'application/vnd.github+json',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ ref, inputs: { leg: String(next) } }),
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const clock = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 16) + 'Z';

await mkdir(join(dataDir, 'data'), { recursive: true });
ensureRepo();
try {
  execSync(`git fetch -q ${remoteUrl} snapshots`, { cwd: dataDir, stdio: 'pipe' });
  execSync(`git checkout -q FETCH_HEAD -- data`, { cwd: dataDir, stdio: 'pipe' });
} catch { /* no snapshots branch yet, or no prior data for this week */ }

console.log(`leg ${leg} starting`);
const start = Date.now();

// The window comes from the week's actual games. A run delivered before it
// opens waits rather than exiting: cron delivery is too unreliable to bet on
// another run landing at the right moment (see js/schedule.js).
{
  const state = await getNflState();
  const season = Number(state.season);
  const week = Math.min(Math.max(state.week || 1, 1), 18);
  const games = await getScoreboard(season, week).catch(() => []);

  if (!process.env.RECORD_LIVE_IGNORE_WINDOW && !shouldRecord(games)) {
    const opensAt = nextWindowStart(games);
    const waitMs = opensAt === null ? null : opensAt - Date.now();
    if (waitMs === null || waitMs > MAX_WAIT_MS) {
      console.log(opensAt === null
        ? 'no game window open or ahead — no-op'
        : `next window opens ${clock(opensAt)}, too far off to wait — no-op`);
      process.exit(0);
    }
    console.log(`window opens ${clock(opensAt)}; waiting ${Math.round(waitMs / 60_000)} min`);
    await sleep(waitMs);
  }
  const endsAt = recordingEndsAt(games);
  console.log(`recording${endsAt ? ` until about ${clock(endsAt)}` : ''}`);
}

let ticks = 0;
for (let i = 0; i < HARD_ITERATION_CAP; i++) {
  // Chain before the 6-hour job cap, whatever leg we are on: a full Sunday
  // (first warm-up to the last post-game tail) is far longer than one job.
  if (Date.now() - start > SAFE_MS) {
    const next = Number(leg) + 1;
    if (next > MAX_LEG) { console.log(`leg cap ${MAX_LEG} reached — stopping`); break; }
    console.log(`safety cutoff reached, dispatching leg ${next}`);
    await dispatchNextLeg(next);
    break;
  }

  const tickStart = Date.now();
  try {
    const { appended, games } = await recordOnce();
    // Highlights on the same loop, so a link appears within a couple of
    // minutes of the upload rather than whenever a cron happens to land.
    let resolved = false;
    if (ticks % HIGHLIGHT_EVERY === 0) {
      try {
        execSync(`node scripts/resolve-highlights.js ${join(dataDir, 'data')}`, { stdio: 'inherit' });
        resolved = true;
      } catch (err) { console.warn('highlight resolve failed, continuing:', err.message); }
    }
    // Push on a resolve too, not just an append: once every game is final the
    // scores stop changing, so `appended` goes false for the rest of the
    // window — which is exactly when the highlight uploads land.
    if (appended || resolved) commitAndPush(`snapshot ${new Date().toISOString()}`);
    ticks++;

    // Re-evaluate from this tick's own scoreboard — no extra ESPN call.
    if (!process.env.RECORD_LIVE_IGNORE_WINDOW && !shouldRecord(games)) {
      console.log('window closed');
      break;
    }
  } catch (err) {
    console.warn('tick failed, continuing:', err.message);
  }
  const elapsed = Date.now() - tickStart;
  if (elapsed < TICK_MS) await sleep(TICK_MS - elapsed);
}
console.log(`leg ${leg} done after ${ticks} ticks`);
