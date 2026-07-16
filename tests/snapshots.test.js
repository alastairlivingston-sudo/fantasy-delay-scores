import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeSnapshots, shouldAppend, isRollover } from '../js/snapshots.js';

test('mergeSnapshots dedupes by timestamp and sorts', () => {
  const local = [{ t: 300, players_points: { a: 3 } }, { t: 100, players_points: { a: 1 } }];
  const remote = [{ t: 200, players_points: { a: 2 } }, { t: 300, players_points: { a: 99 } }];
  const merged = mergeSnapshots(remote, local); // later list (local) wins ties
  assert.deepEqual(merged.map((s) => s.t), [100, 200, 300]);
  assert.equal(merged[2].players_points.a, 3);
});

test('mergeSnapshots tolerates null/empty lists and junk entries', () => {
  assert.deepEqual(mergeSnapshots(null, [], [{ noT: true }, { t: 5 }]), [{ t: 5 }]);
});

test('shouldAppend: always when live or no baseline', () => {
  const live = { players_points: { a: 1 }, gameStates: { g: { state: 'in' } } };
  assert.equal(shouldAppend(undefined, live), true);
  assert.equal(shouldAppend(live, live), true); // still live → keep recording
});

test('shouldAppend: skips identical idle polls, catches changes', () => {
  const idle = { players_points: { a: 1 }, gameStates: { g: { state: 'post', progress: 1 } } };
  assert.equal(shouldAppend(idle, { ...idle }), false);
  assert.equal(shouldAppend(idle,
    { ...idle, players_points: { a: 1.5 } }), true); // stat correction after final
});

test('isRollover triggers on week or season change', () => {
  const stored = { season: 2025, week: 3 };
  assert.equal(isRollover(stored, 2025, 3), false);
  assert.equal(isRollover(stored, 2025, 4), true);
  assert.equal(isRollover(stored, 2026, 3), true);
  assert.equal(isRollover(null, 2025, 3), true);
});
