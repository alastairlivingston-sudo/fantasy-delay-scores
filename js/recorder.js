// Snapshot recorder for delay mode. While the app is open it polls Sleeper +
// ESPN every 60s and appends {t, players_points, gameStates, player_stats} to
// localStorage. player_stats (starters only) powers the delay news-flash.
// Browsers throttle background-tab timers to ~1/min, which matches our
// cadence; on iOS keep the tab foregrounded (see BUILD_PLAN Phase 2).

import { getMatchups, getScoreboard, getStats } from './api.js';
import { appendSnapshot } from './state.js';
import { pickStats } from './newsflash.js';

const INTERVAL_MS = 60_000;

export function startRecorder({ leagueId, season, week, onSnapshot }) {
  let timer = null;
  let stopped = false;

  async function tick() {
    try {
      const [matchups, games, stats] = await Promise.all([
        getMatchups(leagueId, week),
        getScoreboard(season, week),
        getStats(season, week).catch(() => ({})), // feed is optional; don't fail the tick
      ]);
      const players_points = {};
      const player_stats = {};
      for (const m of matchups) {
        Object.assign(players_points, m.players_points || {});
        for (const pid of m.starters || []) {
          const picked = pickStats(stats[pid]);
          if (Object.keys(picked).length) player_stats[pid] = picked;
        }
      }
      const gameStates = {};
      for (const g of games) gameStates[g.gameKey] = { state: g.state, progress: g.progress };
      const snap = { t: Date.now(), players_points, gameStates, player_stats };
      appendSnapshot(leagueId, week, snap);
      onSnapshot?.(snap);
    } catch (err) {
      console.warn('recorder tick failed', err); // transient; next tick retries
    }
    if (!stopped) timer = setTimeout(tick, INTERVAL_MS);
  }

  tick();
  return () => { stopped = true; clearTimeout(timer); };
}
