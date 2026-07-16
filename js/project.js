// Winner projection from *gated* (viewer-visible) data only, so the win
// probability can never leak the live state. Pure: no window/document/fetch.

// Game-level fantasy outcomes are noisy; sd of a player's score is on the
// order of 80% of their projection.
const SIGMA_FRAC = 0.8;

/**
 * League-accurate projected points: dot-product of Sleeper's per-stat
 * projection with the league's scoring_settings.
 */
export function scoreProjection(projStats, scoringSettings) {
  if (!projStats || !scoringSettings) return 0;
  let pts = 0;
  for (const [stat, weight] of Object.entries(scoringSettings)) {
    const v = projStats[stat];
    if (v && weight) pts += v * weight;
  }
  return Math.round(pts * 100) / 100;
}

/**
 * Expected final score for one gated side.
 * players: gate.js output ({points, visible, progress, pid}).
 * projections: {pid: projectedPoints}.
 *
 * A hidden player contributes their full projection (the viewer has seen
 * nothing of that game), a finished visible player contributes their actual,
 * an in-progress visible player blends actual + remaining projection.
 */
export function expectedSide(players, projections) {
  let expected = 0;
  let variance = 0;
  for (const p of players) {
    const proj = projections?.[p.pid] ?? 0;
    const progress = p.visible ? p.progress : 0;
    const remaining = Math.max(0, 1 - progress) * proj;
    expected += (p.visible ? p.points : 0) + remaining;
    variance += (SIGMA_FRAC * remaining) ** 2;
  }
  return { expected: Math.round(expected * 100) / 100, variance };
}

// Standard normal CDF (Abramowitz–Stegun erf approximation).
export function normCdf(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const d = 0.3989423 * Math.exp((-z * z) / 2);
  let p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  if (z > 0) p = 1 - p;
  return p;
}

/**
 * P(my side wins) given both gated sides + projections.
 * Returns {winProb, myExpected, oppExpected}.
 */
export function winProbability(myPlayers, oppPlayers, projections) {
  const me = expectedSide(myPlayers, projections);
  const opp = expectedSide(oppPlayers, projections);
  const sd = Math.sqrt(me.variance + opp.variance);
  const diff = me.expected - opp.expected;
  const winProb = sd < 1e-9 ? (diff > 0 ? 1 : diff < 0 ? 0 : 0.5) : normCdf(diff / sd);
  return {
    winProb: Math.round(winProb * 1000) / 1000,
    myExpected: me.expected,
    oppExpected: opp.expected,
  };
}
