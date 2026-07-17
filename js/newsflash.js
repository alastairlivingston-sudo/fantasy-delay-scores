// Delay-mode "points news-flash". Turns a series of (already gated) snapshots
// into a newest-first feed of scoring events: who scored, how much, and — when
// per-player stats were recorded — what the play was. Pure: no window/document/
// fetch, so `node --test` covers it. Callers MUST pass only snapshots old enough
// for the viewer's delay (see js/gate.js visibleSnapshots) — this module never
// gates; it only formats.

// Stat keys we know how to describe, in the order we present them. Keyed by the
// Sleeper stat field; value builds the phrase from the positive delta.
const STAT_PHRASES = [
  ['pass_td', (n) => `${n} pass TD`],
  ['rush_td', (n) => `${n} rush TD`],
  ['rec_td', (n) => `${n} rec TD`],
  ['def_td', (n) => `${n} def TD`],
  ['pass_yd', (n) => `${n} pass yds`],
  ['rush_yd', (n) => `${n} rush yds`],
  ['rec_yd', (n) => `${n} rec yds`],
  ['rec', (n) => `${n} rec`],
  ['fgm', (n) => `${n} FG`],
  ['xpm', (n) => `${n} XP`],
  ['sack', (n) => `${n} sack`],
  ['int', (n) => `${n} INT`],
  ['pass_int', (n) => `${n} INT thrown`],
  ['fum_lost', (n) => `${n} fumble lost`],
];

// The stat fields worth recording in a snapshot (single source of truth for
// both recorders). Anything outside this set can't be described by the feed.
export const STAT_KEYS = STAT_PHRASES.map(([key]) => key);

/** Pick just the recordable, non-zero stat fields from a full stats object. */
export function pickStats(stats = {}) {
  const out = {};
  for (const key of STAT_KEYS) {
    const v = stats[key];
    if (v) out[key] = v;
  }
  return out;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** Human phrase from the stat delta between two snapshots, or '' if none known. */
export function describeStatDelta(prevStats = {}, curStats = {}) {
  const parts = [];
  for (const [key, phrase] of STAT_PHRASES) {
    const delta = round2((curStats[key] || 0) - (prevStats[key] || 0));
    if (delta > 0) parts.push(phrase(delta % 1 === 0 ? delta : round2(delta)));
  }
  return parts.join(', ');
}

/**
 * Build the news feed.
 * snapshots: [{t, players_points, player_stats?}] — pre-gated, any order.
 * playerMeta: {pid: {name, ...}}
 * playerIds:  which players to report (e.g. both sides' starters). Falsy ⇒ all.
 * Returns newest-first [{t, pid, name, pointsDelta, description}].
 */
export function buildFeed(snapshots, playerMeta = {}, playerIds = null) {
  const snaps = (snapshots || []).filter((s) => s && typeof s.t === 'number')
    .sort((a, b) => a.t - b.t);
  if (snaps.length < 2) return [];
  const ids = playerIds && playerIds.length ? new Set(playerIds) : null;

  const events = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1];
    const cur = snaps[i];
    const prevPts = prev.players_points || {};
    const curPts = cur.players_points || {};
    const pids = ids || new Set([...Object.keys(prevPts), ...Object.keys(curPts)]);
    for (const pid of pids) {
      const pointsDelta = round2((curPts[pid] || 0) - (prevPts[pid] || 0));
      if (Math.abs(pointsDelta) < 0.01) continue;
      const description = describeStatDelta(
        prev.player_stats?.[pid], cur.player_stats?.[pid]);
      events.push({
        t: cur.t,
        pid,
        name: playerMeta[pid]?.name || pid,
        pointsDelta,
        description,
      });
    }
  }
  // Newest first; within a snapshot, biggest scoring move first.
  events.sort((a, b) => b.t - a.t || Math.abs(b.pointsDelta) - Math.abs(a.pointsDelta));
  return events;
}
