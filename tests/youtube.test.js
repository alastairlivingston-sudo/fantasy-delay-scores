import test from 'node:test';
import assert from 'node:assert/strict';
import {
  highlightQuery, highlightSearchUrl, isoDurationMinutes, isFullHighlightVideo,
  shouldSearchAgain, MAX_HIGHLIGHT_ATTEMPTS,
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
