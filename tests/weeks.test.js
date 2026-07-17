import test from 'node:test';
import assert from 'node:assert/strict';
import { browseSeasonWeek, chooseDefaultWeek, weekOptions } from '../js/weeks.js';

test('browseSeasonWeek uses the live season + week when in season', () => {
  assert.deepEqual(
    browseSeasonWeek({ season: '2025', week: 7, season_type: 'regular', previous_season: '2024' }),
    { season: 2025, week: 7 });
  assert.deepEqual(
    browseSeasonWeek({ season: '2025', week: 19, season_type: 'post', previous_season: '2024' }),
    { season: 2025, week: 18 }, 'clamps to the last regular-season week');
});

test('browseSeasonWeek browses the previous season off-season', () => {
  assert.deepEqual(
    browseSeasonWeek({ season: '2026', week: 1, season_type: 'off', previous_season: '2025' }),
    { season: 2025, week: 18 });
  assert.deepEqual(
    browseSeasonWeek({ season: '2026', week: 1, season_type: 'pre', previous_season: '2025' }),
    { season: 2025, week: 18 });
});

test('chooseDefaultWeek keeps the current week once a game has finished', () => {
  assert.equal(chooseDefaultWeek(7, [{ state: 'pre' }, { state: 'post' }]), 7);
  assert.equal(chooseDefaultWeek(7, [{ state: 'in' }, { state: 'post' }]), 7);
});

test('chooseDefaultWeek falls back a week when nothing has finished yet', () => {
  assert.equal(chooseDefaultWeek(7, [{ state: 'pre' }, { state: 'pre' }]), 6);
  assert.equal(chooseDefaultWeek(7, []), 6);
});

test('chooseDefaultWeek never falls below week 1', () => {
  assert.equal(chooseDefaultWeek(1, [{ state: 'pre' }]), 1);
});

test('weekOptions lists 1..currentWeek, clamped to the season', () => {
  assert.deepEqual(weekOptions(3), [1, 2, 3]);
  assert.deepEqual(weekOptions(1), [1]);
  assert.deepEqual(weekOptions(25), Array.from({ length: 18 }, (_, i) => i + 1));
  assert.deepEqual(weekOptions(0), [1]);
});
