import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMatchups, leagueStarters } from '../js/matchups.js';

const side = (roster_id, matchup_id, starters = []) => ({ roster_id, matchup_id, starters });
const name = (s) => (s ? `Team ${s.roster_id}` : undefined);

test('rosters are paired by matchup_id', () => {
  const rows = [side(1, 1), side(2, 1), side(3, 2), side(4, 2)];
  const pairs = buildMatchups(rows, rows[0], name);
  assert.equal(pairs.length, 2);
  assert.deepEqual(pairs.map((m) => [m.aName, m.bName]),
    [['Team 1', 'Team 2'], ['Team 3', 'Team 4']]);
});

test('your matchup comes first, whatever its matchup_id', () => {
  const rows = [side(1, 1), side(2, 1), side(9, 5), side(8, 5)];
  const pairs = buildMatchups(rows, rows[2], name); // roster 9, in the LAST matchup
  assert.equal(pairs[0].mine, true);
  assert.equal(pairs[0].aName, 'Team 9');
  assert.equal(pairs.filter((m) => m.mine).length, 1);
});

test('the others keep matchup_id order behind yours', () => {
  const rows = [side(5, 3), side(6, 3), side(1, 1), side(2, 1), side(3, 2), side(4, 2)];
  const pairs = buildMatchups(rows, rows[4], name); // roster 3, matchup 2
  assert.deepEqual(pairs.map((m) => m.id), [2, 1, 3]);
});

test('you always read on the left', () => {
  const rows = [side(7, 4), side(2, 4)];
  const pairs = buildMatchups(rows, rows[1], name); // Sleeper listed you second
  assert.equal(pairs[0].aName, 'Team 2');
  assert.equal(pairs[0].bName, 'Team 7');
});

test('a bye keeps its entry with one side', () => {
  const rows = [side(1, 1), side(2, 1), side(3, 2)];
  const pairs = buildMatchups(rows, rows[0], name);
  const bye = pairs.find((m) => m.id === 2);
  assert.equal(bye.aName, 'Team 3');
  assert.equal(bye.b, undefined);
  assert.equal(bye.bName, undefined);
});

test('rows with no matchup_id (pre-season) each stand alone, after the paired ones', () => {
  const rows = [side(1, null), side(2, null), side(3, 1), side(4, 1)];
  const pairs = buildMatchups(rows, rows[0], name);
  assert.equal(pairs[0].mine, true, 'yours still leads');
  assert.equal(pairs[0].b, undefined);
  assert.equal(pairs.length, 3);
  assert.deepEqual(pairs.slice(1).map((m) => m.id), [1, null]);
});

test('no roster of your own still lists the league', () => {
  const rows = [side(1, 1), side(2, 1)];
  const pairs = buildMatchups(rows, undefined, name);
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].mine, false);
});

test('empty input is an empty list, not a throw', () => {
  assert.deepEqual(buildMatchups([], undefined), []);
  assert.deepEqual(buildMatchups(undefined, undefined), []);
});

test('leagueStarters collects every roster, de-duplicated', () => {
  const rows = [side(1, 1, ['a', 'b']), side(2, 1, ['c']), side(3, 2, ['d', 'a'])];
  const pairs = buildMatchups(rows, rows[0], name);
  assert.deepEqual(leagueStarters(pairs).sort(), ['a', 'b', 'c', 'd']);
});

test('leagueStarters tolerates a missing side and no input', () => {
  assert.deepEqual(leagueStarters([{ a: { starters: ['x'] }, b: undefined }]), ['x']);
  assert.deepEqual(leagueStarters(undefined), []);
});
