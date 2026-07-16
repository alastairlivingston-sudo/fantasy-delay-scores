// Server-side snapshot recorder, run by .github/workflows/record.yml every
// ~5 minutes during NFL game windows. Appends one snapshot per league to
// <dataDir>/<leagueId>.json; files reset automatically when the week rolls
// over. Reuses the browser's api.js (fetch-only, environment-free).
//
// Usage: node scripts/record.js <dataDir>
// Env:   SLEEPER_USERNAME (default AlastairL)
//        FORCE_SEASON / FORCE_WEEK — record a past week (testing, off-season)

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getNflState, getUser, getLeagues, getMatchups, getScoreboard } from '../js/api.js';
import { shouldAppend, isRollover } from '../js/snapshots.js';

const dataDir = process.argv[2];
if (!dataDir) { console.error('usage: node scripts/record.js <dataDir>'); process.exit(1); }
const username = process.env.SLEEPER_USERNAME || 'AlastairL';

const state = await getNflState();
let season = Number(state.season);
let week = state.week;
if (process.env.FORCE_SEASON) season = Number(process.env.FORCE_SEASON);
if (process.env.FORCE_WEEK) week = Number(process.env.FORCE_WEEK);
else if (state.season_type !== 'regular' && state.season_type !== 'post') {
  console.log(`off-season (${state.season_type}); nothing to record`);
  process.exit(0);
}
week = Math.min(Math.max(week || 1, 1), 18);

const user = await getUser(username);
const [leagues, games] = await Promise.all([
  getLeagues(user.user_id, season),
  getScoreboard(season, week),
]);
const gameStates = {};
for (const g of games) gameStates[g.gameKey] = { state: g.state, progress: g.progress };

await mkdir(dataDir, { recursive: true });
let appended = 0;

for (const league of leagues) {
  const matchups = await getMatchups(league.league_id, week);
  const players_points = {};
  for (const m of matchups) Object.assign(players_points, m.players_points || {});
  const snap = { t: Date.now(), players_points, gameStates };

  const file = join(dataDir, `${league.league_id}.json`);
  let stored = null;
  try { stored = JSON.parse(await readFile(file, 'utf8')); } catch { /* new file */ }
  if (isRollover(stored, season, week)) {
    stored = { season, week, leagueId: league.league_id, snapshots: [] };
  }
  const last = stored.snapshots[stored.snapshots.length - 1];
  if (shouldAppend(last, snap)) {
    stored.snapshots.push(snap);
    await writeFile(file, JSON.stringify(stored));
    appended++;
  }
  console.log(`${league.name}: ${stored.snapshots.length} snapshots (week ${week})`);
}

await writeFile(join(dataDir, 'index.json'), JSON.stringify({
  season, week, updated: Date.now(), leagues: leagues.map((l) => l.league_id),
}));
console.log(`done: appended to ${appended}/${leagues.length} leagues`);
