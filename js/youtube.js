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

/* ---------------- right game, right year ---------------- */
// "Full-length official highlights" is not the same as "THIS game's". The
// search is a text query against a channel with a decade of near-identical
// titles, so the top hit for "Panthers vs Falcons Week 2 2026" is quite happily
// last September's meeting. Observed in the 2026 week-2 file: CAR@ATL resolved
// to a video published 2025-09-21, JAX@DEN to one from 2025-12-22, and CLE@TB
// to the exact video already stored for CIN@HOU.
//
// Two independent guards, because either alone has a hole: the upload's own
// publish date must sit in the hours after THIS kickoff (catches the wrong
// year, and a rematch weeks later), and the title must name both teams and
// agree about week and season (catches the wrong game on the right day, which
// no date check can see).

/** No upload exists before the game is played; nothing plausible lands later. */
const PUBLISH_MIN_HOURS = 2;
const PUBLISH_MAX_DAYS = 4;

/**
 * The window in which a genuine highlight for a kickoff can have been
 * published, as {from, to} epoch ms. Null when the kickoff is unusable.
 */
export function publishWindow(kickoff) {
  const t = new Date(kickoff ?? NaN).getTime();
  if (!Number.isFinite(t)) return null;
  return { from: t + PUBLISH_MIN_HOURS * 3_600_000, to: t + PUBLISH_MAX_DAYS * 86_400_000 };
}

const WEEK_IN_TITLE = /\bweek\s*(\d{1,2})\b/i;
const YEAR_IN_TITLE = /\b20\d{2}\b/g;

/**
 * Why `video` is NOT the highlight for `game`, or null if it checks out.
 * The string is a reason code for logging — callers should test against null.
 *
 * video: {publishedAt, title?}  (title is optional: entries stored before this
 *        check existed have only an id and a publish date)
 * game:  {away, home, date (kickoff ISO), week, season}
 */
export function highlightMismatch(video, game) {
  const { publishedAt, title } = video || {};
  const { away, home, week, season, date } = game || {};

  if (title != null) {
    const lower = String(title).toLowerCase();
    for (const code of [away, home]) {
      const name = teamName(code);
      if (name && !lower.includes(String(name).toLowerCase())) return `title-missing-${code}`;
    }
    const inTitle = WEEK_IN_TITLE.exec(title);
    if (inTitle && week && Number(inTitle[1]) !== Number(week)) return `title-week-${inTitle[1]}`;
    // A title year must be the season's own. Playoff uploads for a season can
    // carry the following calendar year, so that one is allowed too.
    const years = String(title).match(YEAR_IN_TITLE) || [];
    if (season && years.length
      && !years.some((y) => Number(y) === Number(season) || Number(y) === Number(season) + 1)) {
      return `title-season-${years.join('/')}`;
    }
  }

  const range = publishWindow(date);
  const at = new Date(publishedAt ?? NaN).getTime();
  // Unverifiable beats "probably fine": a link we can't date is exactly the
  // shape of the bug, and dropping it only costs one re-search.
  if (!range || !Number.isFinite(at)) return 'undateable';
  if (at < range.from) return 'published-before-this-game';
  if (at > range.to) return 'published-too-long-after';
  return null;
}

/** True if `video` is a plausible highlight for `game`. */
export function isHighlightForGame(video, game) {
  return Boolean(video) && highlightMismatch(video, game) === null;
}

/**
 * Filter a week's stored {gameKey: video} map down to the entries that still
 * check out against the week's games, and say what was dropped.
 *
 * Entries whose gameKey isn't in `games` are kept untouched — they can't be
 * checked and they can't be rendered either. One video id claimed by two games
 * means at least one is wrong, and nothing in the stored data says which, so
 * both go: a re-search is cheap next to a link to someone else's game.
 *
 * Returns {videos, dropped: [{gameKey, id, reason}]}.
 */
export function pruneHighlights(videos, games, { season, week } = {}) {
  const byKey = new Map((games || []).map((g) => [g.gameKey, g]));
  const kept = {};
  const dropped = [];

  for (const [gameKey, video] of Object.entries(videos || {})) {
    const game = byKey.get(gameKey);
    if (!game) { kept[gameKey] = video; continue; }
    const reason = highlightMismatch(video, { ...game, season, week });
    if (reason) dropped.push({ gameKey, id: video?.id, reason });
    else kept[gameKey] = video;
  }

  const claims = new Map();
  for (const [gameKey, video] of Object.entries(kept)) {
    if (!byKey.has(gameKey)) continue; // unverifiable entries don't vote
    const id = video?.id;
    if (!id) continue;
    claims.set(id, [...(claims.get(id) || []), gameKey]);
  }
  for (const [id, keys] of claims) {
    if (keys.length < 2) continue;
    for (const gameKey of keys) {
      delete kept[gameKey];
      dropped.push({ gameKey, id, reason: `also-claimed-by-${keys.filter((k) => k !== gameKey).join('/')}` });
    }
  }

  return { videos: kept, dropped };
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
