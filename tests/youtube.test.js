import test from 'node:test';
import assert from 'node:assert/strict';
import { highlightQuery, highlightSearchUrl } from '../js/youtube.js';
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
