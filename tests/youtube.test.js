import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightQuery, highlightSearchUrl, isoDurationMinutes, isFullHighlightVideo } from '../js/youtube.js';
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
