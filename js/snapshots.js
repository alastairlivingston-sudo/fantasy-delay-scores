// Snapshot bookkeeping shared by the browser (merging local + remote) and the
// GitHub Actions recorder (append/rollover decisions). Pure: no I/O.

/** Merge snapshot lists, dedupe by timestamp (later list wins), sort by t. */
export function mergeSnapshots(...lists) {
  const byT = new Map();
  for (const list of lists) {
    for (const s of list || []) {
      if (s && typeof s.t === 'number') byT.set(s.t, s);
    }
  }
  return [...byT.values()].sort((a, b) => a.t - b.t);
}

/**
 * Should the recorder append this snapshot? Yes when anything is live, when
 * there's no baseline yet, or when points/game-states changed since the last
 * one (catches final corrections). Skips idle pre-game/overnight polls.
 */
export function shouldAppend(last, next) {
  if (!last) return true;
  if (Object.values(next.gameStates || {}).some((g) => g.state === 'in')) return true;
  return JSON.stringify(last.players_points) !== JSON.stringify(next.players_points)
    || JSON.stringify(last.gameStates) !== JSON.stringify(next.gameStates);
}

/** A stored file is stale when the league week has moved on — start fresh. */
export function isRollover(stored, season, week) {
  return !stored || stored.season !== season || stored.week !== week;
}
