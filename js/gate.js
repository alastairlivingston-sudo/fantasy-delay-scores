// Spoiler gating — the only module allowed to touch raw live points when the
// viewer is in a spoiler-safe mode. Everything the UI renders comes from here.
// Pure: no window/document/fetch.

export const MODES = ['live', 'watched', 'delay'];

/**
 * Pick the newest snapshot that is old enough for the delay, or null.
 * Never returns a snapshot newer than (now - delayMs): showing "the oldest we
 * have" when recording started too recently would leak the present.
 */
export function pickSnapshot(snapshots, now, delayMs) {
  const cutoff = now - delayMs;
  let best = null;
  for (const s of snapshots || []) {
    if (s.t <= cutoff && (!best || s.t > best.t)) best = s;
  }
  return best;
}

/**
 * Gate one roster side.
 *
 * side: { starters: [pid], players_points: {pid: pts} }
 * ctx: {
 *   mode: 'live' | 'watched' | 'delay',
 *   playerGames: {pid: gameKey},          // which NFL game each player is in
 *   watched: {gameKey: true},             // games the viewer has seen
 *   gameStates: {gameKey: {state: 'pre'|'in'|'post', progress: 0..1}},
 *   snapshots: [{t, players_points, gameStates}],   // delay mode
 *   now: ms epoch, delayMs: number,
 * }
 *
 * Returns { players: [{pid, points, visible, progress}], total, notice }
 * - points/progress are what the viewer is allowed to see (0 when hidden).
 * - visible=false means "hidden by your spoiler settings", not "zero".
 */
export function gateSide(side, ctx) {
  const { mode } = ctx;
  let notice = null;

  let pointsSource = side.players_points || {};
  let gameStates = ctx.gameStates || {};

  if (mode === 'delay') {
    const snap = pickSnapshot(ctx.snapshots, ctx.now, ctx.delayMs);
    if (snap) {
      pointsSource = snap.players_points || {};
      gameStates = snap.gameStates || {};
    } else {
      pointsSource = {};
      gameStates = {}; // unknown ⇒ treated as pre-game
      const oldest = (ctx.snapshots || []).reduce(
        (m, s) => (m === null || s.t < m ? s.t : m), null);
      notice = {
        code: 'recording-too-new',
        availableAt: oldest === null ? null : oldest + ctx.delayMs,
      };
    }
  }

  const players = (side.starters || []).map((pid) => {
    const gameKey = ctx.playerGames?.[pid];
    const gs = gameKey ? gameStates[gameKey] : undefined;
    const state = gs?.state || 'pre';
    const progress = state === 'post' ? 1 : (gs?.progress ?? 0);

    let visible = true;
    if (mode === 'watched') {
      // A game the viewer ticked is safe; so is a genuinely pre-game player
      // (zero points, nothing to spoil). Anything else — including a player
      // whose game we failed to map but who has points — stays hidden.
      const pts = pointsSource[pid] ?? 0;
      visible = Boolean(gameKey && ctx.watched?.[gameKey]) || (state === 'pre' && pts === 0);
    }

    return {
      pid,
      gameKey: gameKey || null,
      visible,
      points: visible ? (pointsSource[pid] ?? 0) : 0,
      progress: visible ? progress : 0,
      state: visible ? state : 'hidden',
    };
  });

  const total = players.reduce((sum, p) => sum + p.points, 0);
  return { players, total: Math.round(total * 100) / 100, notice };
}

export function gateMatchup(mySide, oppSide, ctx) {
  return { me: gateSide(mySide, ctx), opp: gateSide(oppSide, ctx) };
}

/**
 * The snapshots a delay-mode viewer is allowed to see: only those old enough
 * for the delay (t <= now - delayMs), oldest first. This is the single gating
 * decision behind the news feed — the feed formatter never sees newer data.
 * Returns [] outside delay mode.
 */
export function visibleSnapshots(ctx) {
  if (ctx.mode !== 'delay') return [];
  const cutoff = ctx.now - ctx.delayMs;
  return (ctx.snapshots || [])
    .filter((s) => s && typeof s.t === 'number' && s.t <= cutoff)
    .sort((a, b) => a.t - b.t);
}
