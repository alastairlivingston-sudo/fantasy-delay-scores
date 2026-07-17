// Pure week-selection helpers for the standalone highlights view (no league,
// no matchup). Environment-free (no window/document/fetch) so `node --test`
// covers them, per the project's hard rules.

// Season + newest browsable week from Sleeper's nfl_state, with no league to
// anchor to. In-season: the live season and its current week. Off/pre-season:
// browse the previous season's final regular-season week, so highlights stay
// testable year-round (owner context: off-season default is last season).
export function browseSeasonWeek(nfl) {
  const inSeason = nfl.season_type === 'regular' || nfl.season_type === 'post';
  if (inSeason) {
    return { season: Number(nfl.season), week: clampWeek(nfl.week) };
  }
  return { season: Number(nfl.previous_season), week: 18 };
}

// Default week to show: the current week if any of its games have finished,
// otherwise the previous week. Mid-week (before Thursday kickoff) the current
// week has no finished games yet, so falling back keeps the view from opening
// empty on the "latest game week".
export function chooseDefaultWeek(week, games) {
  const w = clampWeek(week);
  const anyFinished = (games || []).some((g) => g.state === 'post');
  return anyFinished || w <= 1 ? w : w - 1;
}

// Weeks offered in the navigation dropdown: 1..currentWeek (you can browse any
// week up to and including the latest one, since highlight files are never
// cleared on rollover).
export function weekOptions(currentWeek) {
  const n = clampWeek(currentWeek);
  return Array.from({ length: n }, (_, i) => i + 1);
}

function clampWeek(week) {
  return Math.min(Math.max(Number(week) || 1, 1), 18);
}
