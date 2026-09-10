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
// The official upload usually appears within a few hours of the final whistle,
// so the resolver has to keep checking after a game ends — but a YouTube search
// costs 100 of the free tier's 10k daily units, and the resolver now runs
// hourly all season. Retries therefore back off and eventually give up, which
// bounds a whole week's worst case (every game unresolved) to well under quota.
//
// Index = attempts already made; value = minutes to wait since the last try.
const RETRY_WAIT_MINUTES = [0, 30, 60, 120, 240, 480, 720, 1440];

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
