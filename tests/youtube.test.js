import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightQuery, highlightSearchUrl, isoDurationMinutes, isFullHighlightVideo,
  shouldSearchAgain, MAX_HIGHLIGHT_ATTEMPTS,
  highlightMismatch, isHighlightForGame, publishWindow, pruneHighlights,
} from '../js/youtube.js';
import { normalizeCode, teamName } from '../js/teams.js';

test('query uses team names, week, season — and never a score', () => {
  const q = highlightQuery({ away: 'MIA', home: 'BUF', week: 3, season: 2025 });
  assert.equal(q, 'Dolphins vs Bills Week 3 2025 NFL game highlights');
});

test('url is an encoded YouTube search', () => {
  const url = highlightSearchUrl({ away: 'KC', home: 'LAC', week: 1, season: 2025 });
  assert.ok(url.startsWith('https://www.youtube.com/results?search_query='));
  assert.ok(url.includes('Chiefs%20vs%20Chargers'));
});

test('ESPN team codes normalise to Sleeper codes', () => {
  assert.equal(normalizeCode('WSH'), 'WAS');
  assert.equal(normalizeCode('LA'), 'LAR');
  assert.equal(normalizeCode('KC'), 'KC');
  assert.equal(teamName('WSH'), 'Commanders');
});

test('isoDurationMinutes parses ISO-8601 durations', () => {
  assert.equal(isoDurationMinutes('PT9M'), 9);
  assert.equal(isoDurationMinutes('PT1H2M'), 62);
  assert.equal(isoDurationMinutes('PT1H2M30S'), 62.5);
  assert.equal(isoDurationMinutes('PT45S'), 0.75);
});

test('isoDurationMinutes returns 0 for unparseable input', () => {
  assert.equal(isoDurationMinutes(''), 0);
  assert.equal(isoDurationMinutes(undefined), 0);
  assert.equal(isoDurationMinutes('not-a-duration'), 0);
});

test('isFullHighlightVideo requires length, "highlights" title, and no score', () => {
  assert.equal(isFullHighlightVideo({
    title: 'Dolphins vs. Bills Game Highlights | NFL 2025 Week 3', durationIso: 'PT9M12S',
  }), true);
  assert.equal(isFullHighlightVideo({
    title: 'Dolphins vs. Bills Highlights', durationIso: 'PT2M',
  }), false, 'too short to be the full recap');
  assert.equal(isFullHighlightVideo({
    title: 'Dolphins @ Bills Postgame Interview', durationIso: 'PT9M12S',
  }), false, 'not titled as highlights');
  assert.equal(isFullHighlightVideo({
    title: 'Dolphins vs. Bills Highlights (Final 24-17)', durationIso: 'PT9M12S',
  }), false, 'title leaks a score');
});

/* ---------------- right game, right year ---------------- */
// Every case below is taken from the 2026 week-2 highlights file, which had
// three wrong links in it: two from the previous season, and one video stored
// for two different games.

const ATL = {
  gameKey: 'CAR@ATL', away: 'CAR', home: 'ATL',
  date: '2026-09-20T17:00:00Z', season: 2026, week: 2,
};

test('a highlight published the season before is rejected', () => {
  // The real bug: CAR@ATL week 2 2026 resolved to a video from 2025-09-21.
  assert.equal(
    highlightMismatch({ publishedAt: '2025-09-21T20:23:11Z' }, ATL),
    'published-before-this-game');
  assert.equal(
    highlightMismatch({ publishedAt: '2025-12-22T00:48:58Z' },
      { ...ATL, gameKey: 'JAX@DEN', away: 'JAX', home: 'DEN' }),
    'published-before-this-game');
});

test('the genuine same-evening upload passes', () => {
  assert.equal(highlightMismatch({ publishedAt: '2026-09-20T20:23:11Z' }, ATL), null);
  assert.equal(isHighlightForGame({ publishedAt: '2026-09-21T02:10:00Z' }, ATL), true);
});

test('an upload from long after the game is rejected', () => {
  // A retrospective or a "best of" cut months later is not this game's recap.
  assert.equal(
    highlightMismatch({ publishedAt: '2026-11-02T20:00:00Z' }, ATL),
    'published-too-long-after');
});

test('a link we cannot date is not trusted', () => {
  assert.equal(highlightMismatch({ id: 'abc' }, ATL), 'undateable');
  assert.equal(highlightMismatch({ publishedAt: '2026-09-20T20:23:11Z' }, { ...ATL, date: undefined }),
    'undateable');
  assert.equal(isHighlightForGame(undefined, ATL), false);
  assert.equal(publishWindow('nonsense'), null);
});

test('the title must name both teams', () => {
  const at = '2026-09-20T20:32:58Z';
  assert.equal(highlightMismatch(
    { publishedAt: at, title: 'Panthers vs. Falcons Game Highlights | NFL 2026 Week 2' }, ATL), null);
  // The CLE@TB slot held the Bengals-Texans video: right day, wrong game.
  assert.equal(highlightMismatch(
    { publishedAt: at, title: 'Bengals vs. Texans Game Highlights | NFL 2026 Week 2' }, ATL),
    'title-missing-CAR');
});

test('the title must agree about week and season', () => {
  const at = '2026-09-20T20:32:58Z';
  assert.equal(highlightMismatch(
    { publishedAt: at, title: 'Panthers vs. Falcons Game Highlights | NFL 2026 Week 7' }, ATL),
    'title-week-7');
  assert.equal(highlightMismatch(
    { publishedAt: at, title: 'Panthers vs. Falcons Game Highlights | NFL 2025 Week 2' }, ATL),
    'title-season-2025');
  // A season's playoff uploads can carry the next calendar year.
  assert.equal(highlightMismatch(
    { publishedAt: at, title: 'Panthers vs. Falcons Highlights | 2027 NFC Wild Card' }, ATL), null);
});

test('prune drops bad stored links and keeps good ones', () => {
  const games = [
    { gameKey: 'CAR@ATL', away: 'CAR', home: 'ATL', date: '2026-09-20T17:00:00Z' },
    { gameKey: 'CIN@HOU', away: 'CIN', home: 'HOU', date: '2026-09-20T17:00:00Z' },
  ];
  const { videos, dropped } = pruneHighlights({
    'CAR@ATL': { id: 'h6bi8oqivbM', publishedAt: '2025-09-21T20:23:11Z' }, // last season
    'CIN@HOU': { id: 'Bi13ofXC0xY', publishedAt: '2026-09-20T20:32:58Z' },
  }, games, { season: 2026, week: 2 });

  assert.deepEqual(Object.keys(videos), ['CIN@HOU']);
  assert.deepEqual(dropped.map((d) => [d.gameKey, d.reason]),
    [['CAR@ATL', 'published-before-this-game']]);
});

test('one video claimed by two games is dropped from both', () => {
  // Neither entry says which game it really belongs to, and a link to someone
  // else's game is worse than a re-search.
  const games = [
    { gameKey: 'CIN@HOU', away: 'CIN', home: 'HOU', date: '2026-09-20T17:00:00Z' },
    { gameKey: 'CLE@TB', away: 'CLE', home: 'TB', date: '2026-09-20T17:00:00Z' },
  ];
  const dupe = { id: 'Bi13ofXC0xY', publishedAt: '2026-09-20T20:32:58Z' };
  const { videos, dropped } = pruneHighlights({ 'CIN@HOU': dupe, 'CLE@TB': { ...dupe } },
    games, { season: 2026, week: 2 });

  assert.deepEqual(videos, {});
  assert.equal(dropped.length, 2);
  assert.ok(dropped.every((d) => d.reason.startsWith('also-claimed-by')));
});

test('prune leaves entries it has no game for alone', () => {
  const stored = { 'SF@LAR': { id: 'x', publishedAt: '2026-09-11T03:55:31Z' } };
  const { videos, dropped } = pruneHighlights(stored, [], { season: 2026, week: 1 });
  assert.deepEqual(videos, stored);
  assert.deepEqual(dropped, []);
});

test('a game that just went final is searched immediately', () => {
  const now = Date.UTC(2025, 8, 21, 20, 0);
  assert.equal(shouldSearchAgain(undefined, now), true, 'no attempt state yet');
  assert.equal(shouldSearchAgain({ attempts: 0, lastTriedAt: 0 }, now), true);
});

// Properties, not magic numbers: the curve gets retuned as we learn when NFL
// uploads actually land, and these are the things that must stay true of any
// curve. Pinning the exact minutes just makes retuning noisy.
const min = (n) => n * 60_000;

/** Minutes after the final whistle at which each search would fire. */
function attemptSchedule(now) {
  const times = [];
  let t = 0;
  for (let a = 0; a < MAX_HIGHLIGHT_ATTEMPTS; a++) {
    // Smallest wait that lets attempt `a` through.
    let w = 0;
    while (!shouldSearchAgain({ attempts: a, lastTriedAt: now - min(w) }, now)) w++;
    t += w;
    times.push(t);
  }
  return times;
}

test('the wait after each miss never shrinks', () => {
  const now = Date.UTC(2025, 8, 21, 20, 0);
  const times = attemptSchedule(now);
  const waits = times.map((t, i) => t - (times[i - 1] ?? 0));
  for (let i = 2; i < waits.length; i++) {
    assert.ok(waits[i] >= waits[i - 1],
      `wait ${i} (${waits[i]}m) must not be shorter than the one before (${waits[i - 1]}m)`);
  }
});

test('searches concentrate in the window where uploads actually appear', () => {
  // Observed this season: 15 min (SF@LAR) to ~4 h (NE@SEA) after the whistle.
  const times = attemptSchedule(Date.UTC(2025, 8, 21, 20, 0));
  const inBand = times.filter((t) => t <= 240);
  assert.ok(inBand.length >= 6,
    `expected most attempts inside the first 4h, got ${inBand.length} of ${times.length}: ${times}`);
  const worst = Math.max(...times.filter((t) => t <= 240)
    .map((t, i, a) => t - (a[i - 1] ?? 0)));
  assert.ok(worst <= 90, `worst wait inside the 0-4h band should be <= 90 min, got ${worst}`);
  assert.ok(times[1] <= 20, `a highlight up within 20 min should be caught quickly, got ${times[1]}`);
});

test('the whole curve stays inside the free YouTube quota', () => {
  // 10k units/day, 100 per search => ~100 searches/day across a 13-game slate.
  const AFFORDABLE_PER_GAME = Math.floor(10_000 / 100 / 13);
  assert.ok(MAX_HIGHLIGHT_ATTEMPTS <= AFFORDABLE_PER_GAME + 1,
    `${MAX_HIGHLIGHT_ATTEMPTS} searches/game x 13 games would exceed the daily quota`);
});

test('a game with no official upload is eventually left alone', () => {
  const now = Date.UTC(2025, 8, 21, 20, 0);
  const ancient = now - 30 * 24 * 60 * 60_000;
  assert.equal(shouldSearchAgain({ attempts: MAX_HIGHLIGHT_ATTEMPTS - 1, lastTriedAt: ancient }, now), true);
  assert.equal(shouldSearchAgain({ attempts: MAX_HIGHLIGHT_ATTEMPTS, lastTriedAt: ancient }, now), false,
    'given up — no amount of waiting reopens it');
});
