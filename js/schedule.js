// When the live recorder should be running. Pure logic (no fetch/DOM) so
// `node --test` covers it; used server-side by scripts/record-live.js.
//
// This used to be a UK wall-clock window (17:00->04:00 Sunday), gated on the
// cron firing during the exact local hour 17. That failed completely once
// GitHub started delivering scheduled runs hours late: the two candidate
// triggers arrived at 19:34 and 20:16 UK on 2026-09-13, the "is it 17:00?"
// gate rejected both, and the whole Sunday slate went unrecorded.
//
// So the window is now derived from the WEEK'S ACTUAL GAMES. That fixes three
// things at once: a late-delivered cron still finds the window open and starts
// recording, DST needs no special handling (kickoff times come from the
// scoreboard as absolute instants), and it stops being Sunday-specific —
// Thursday, Saturday, Monday and holiday games get the same treatment.

export const PRE_KICKOFF_MS = 30 * 60_000;      // warm up just before kickoff
export const GAME_LENGTH_MS = 3.5 * 60 * 60_000; // generous: overtime, delays
export const POST_GAME_MS = 4 * 60 * 60_000;     // keep going while highlights land

function bounds(game, { preMs = PRE_KICKOFF_MS, gameMs = GAME_LENGTH_MS, postMs = POST_GAME_MS } = {}) {
  const kickoff = new Date(game?.date).getTime();
  if (!Number.isFinite(kickoff)) return null;
  return { from: kickoff - preMs, to: kickoff + gameMs + postMs };
}

/**
 * Should the recorder be polling right now? True while any game is actually
 * in progress (whatever the clock says — overtime, weather delays), and while
 * `now` sits inside any game's kickoff window plus its post-game tail.
 */
export function shouldRecord(games, now = Date.now(), opts = {}) {
  const list = games || [];
  if (list.some((g) => g?.state === 'in')) return true;
  return list.some((g) => {
    const b = bounds(g, opts);
    return b && now >= b.from && now < b.to;
  });
}

/**
 * When the next window opens, or null if none is still ahead. A run delivered
 * hours before kickoff uses this to wait for the window rather than exiting
 * and hoping another cron lands on time — which is the failure this whole
 * module exists to avoid.
 */
export function nextWindowStart(games, now = Date.now(), opts = {}) {
  let soonest = null;
  for (const g of games || []) {
    const b = bounds(g, opts);
    if (!b || b.from <= now) continue;
    if (soonest === null || b.from < soonest) soonest = b.from;
  }
  return soonest;
}

/**
 * When the current recording stretch ends, or null if nothing is open. A
 * slate's per-game windows overlap into one continuous stretch — the 1pm
 * wave's tail runs past the 4pm kickoff, and so on — so this walks the
 * overlaps rather than returning one game's tail, which would under-report
 * the end by hours. Logging only: the loop re-checks shouldRecord every tick
 * rather than trusting a precomputed end.
 */
export function recordingEndsAt(games, now = Date.now(), opts = {}) {
  const spans = (games || [])
    .map((g) => bounds(g, opts))
    .filter(Boolean)
    .sort((a, b) => a.from - b.from);
  let end = null;
  for (const s of spans) {
    if (end === null) {
      if (now >= s.from && now < s.to) end = s.to;
    } else if (s.from <= end) {
      end = Math.max(end, s.to);
    }
  }
  return end;
}
