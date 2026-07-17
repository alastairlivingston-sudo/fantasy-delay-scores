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
