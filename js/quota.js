// Weekly allowance for manually-triggered highlight checks. Pure: no
// window/document/fetch, so `node --test` covers it (project hard rule 4).
//
// The app has no accounts, so "a user" here is a browser profile and the
// counter lives in that browser's localStorage — it is an allowance, not a
// security control. The real ceiling is the global weekly cap enforced in
// api/refresh.js, which counts GitHub's own dispatch history.

export const WEEKLY_REFRESH_LIMIT = 500;

/**
 * ISO-8601 week key for a date in LOCAL time, e.g. "2026-W37". Weeks start
 * Monday, and the week's ISO year is whichever year owns its Thursday — so
 * the turn of the year can't hand out a second allowance mid-week.
 */
export function weekKey(date = new Date()) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const mondayIndex = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - mondayIndex + 3); // the Thursday of this week
  const isoYear = d.getFullYear();
  const jan4 = new Date(isoYear, 0, 4); // always in ISO week 1
  const week1Thursday = new Date(isoYear, 0, 4 - ((jan4.getDay() + 6) % 7) + 3);
  const week = 1 + Math.round((d - week1Thursday) / (7 * 86_400_000));
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * Read the allowance for the current week. A stored counter from any earlier
 * week is simply ignored, which is what makes the reset free — nothing has to
 * run at midnight on Monday to clear it.
 */
export function quotaState(stored, limit = WEEKLY_REFRESH_LIMIT, now = new Date()) {
  const week = weekKey(now);
  const used = stored && stored.week === week && Number.isFinite(stored.used)
    ? Math.max(0, stored.used) : 0;
  return { week, used, limit, remaining: Math.max(0, limit - used), exhausted: used >= limit };
}

/**
 * Spend one check. Returns {ok, state, stored} — `stored` is what to persist,
 * and is only present when ok. Callers should persist it only once the check
 * has actually been accepted, so a failed request costs nothing.
 */
export function spendRefresh(stored, limit = WEEKLY_REFRESH_LIMIT, now = new Date()) {
  const state = quotaState(stored, limit, now);
  if (state.exhausted) return { ok: false, state };
  const next = { week: state.week, used: state.used + 1 };
  return { ok: true, state: quotaState(next, limit, now), stored: next };
}

/** Local Date when the current week's allowance resets (next Monday, 00:00). */
export function resetsAt(now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + (7 - ((d.getDay() + 6) % 7)));
  return d;
}
