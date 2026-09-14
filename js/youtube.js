// Spoiler-safe YouTube highlight links. Pure: no window/document/fetch.
//
// Official NFL highlight uploads are titled like
// "Dolphins vs. Bills Game Highlights | NFL 2025 Week 3" — no score in the
// title — so a precise search query lands on them without exposing scores.

import { teamName } from './teams.js';

export function highlightQuery({ away, home, week, season }) {
  return `${teamName(away)} vs ${teamName(home)} Week ${week} ${season} NFL game highlights`;
}

export function highlightSearchUrl(game) {
  return 'https://www.youtube.com/results?search_query=' +
    encodeURIComponent(highlightQuery(game));
}

const MIN_HIGHLIGHT_MINUTES = 6;
const SCORE_LIKE = /\b\d{1,2}\s*[-–]\s*\d{1,2}\b/;

/** ISO-8601 duration ("PT1H2M3S") → minutes. Returns 0 for unparseable input. */
export function isoDurationMinutes(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m) return 0;
  const [, h, min, s] = m;
  return (Number(h) || 0) * 60 + (Number(min) || 0) + (Number(s) || 0) / 60;
}

/** True if a YouTube search result looks like a real full-game highlights upload. */
export function isFullHighlightVideo({ title, durationIso }) {
  return isoDurationMinutes(durationIso) >= MIN_HIGHLIGHT_MINUTES
    && /highlights/i.test(title || '')
    && !SCORE_LIKE.test(title || '');
}

/* ---------------- retry policy ---------------- */
// The recorder loop CHECKS every couple of minutes, but a search is not free:
// 100 of the YouTube free tier's 10k daily units. Searching every unresolved
// game every check would spend the whole day's quota in about 15 minutes on a
// 13-game Sunday, so each game gets its own backoff and eventually gives up.
// The real ceiling is ~100 searches a day across all games — roughly 7 or 8
// per game on a full slate — and no scheduling choice can raise it. Only a
// bigger quota can.
//
// Given a fixed budget of 8 searches, what matters is WHERE they land.
// Observed upload delays after the final whistle: 15 min (SF@LAR), ~1 h
// (TB@CIN), ~4 h (NE@SEA). The first curve here put only 4 of its 8 attempts
// inside that 0-4h band and left a 4-hour hole in the middle of it, then spent
// the other 4 out at 15h, 27h and 51h where nothing was ever going to appear.
// This curve puts 6 of the 8 in the band and cuts the worst-case wait there
// from 240 to 90 minutes, for exactly the same quota.
//
// Index = attempts already made; value = minutes to wait since the last try.
// Cumulative: 0, 15m, 45m, 1h30, 2h30, 4h, 6h, 10h.
const RETRY_WAIT_MINUTES = [0, 15, 30, 45, 60, 90, 120, 240];

/** After this many fruitless searches a game is left alone (no official upload). */
export const MAX_HIGHLIGHT_ATTEMPTS = RETRY_WAIT_MINUTES.length;

/**
 * Should a finished game with no resolved highlight be searched for again?
 * `attempts` is how many searches it has already had, `lastTriedAt` when the
 * most recent one ran (both 0 for a game that just went final).
 */
export function shouldSearchAgain({ attempts = 0, lastTriedAt = 0 } = {}, now = Date.now()) {
  if (attempts >= MAX_HIGHLIGHT_ATTEMPTS) return false;
  return now - lastTriedAt >= RETRY_WAIT_MINUTES[attempts] * 60_000;
}
