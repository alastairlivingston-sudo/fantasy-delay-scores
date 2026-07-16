import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreProjection, expectedSide, winProbability, normCdf } from '../js/project.js';

test('scoreProjection dot-products stats with league scoring', () => {
  const pts = scoreProjection(
    { pass_yd: 250, pass_td: 2, pass_int: 1, irrelevant: 99 },
    { pass_yd: 0.04, pass_td: 4, pass_int: -2 },
  );
  assert.equal(pts, 250 * 0.04 + 2 * 4 - 2); // 16
});

test('expectedSide blends actual + remaining projection', () => {
  const players = [
    { pid: 'a', visible: true, points: 10, progress: 0.5 },
    { pid: 'b', visible: true, points: 20, progress: 1 },   // finished: actual only
    { pid: 'c', visible: false, points: 0, progress: 0 },   // hidden: full projection
  ];
  const { expected } = expectedSide(players, { a: 12, b: 15, c: 8 });
  assert.equal(expected, 10 + 6 + 20 + 8);
});

test('finished games contribute zero variance', () => {
  const done = [{ pid: 'a', visible: true, points: 20, progress: 1 }];
  assert.equal(expectedSide(done, { a: 15 }).variance, 0);
});

test('normCdf is sane', () => {
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-3);
  assert.ok(normCdf(2) > 0.97);
  assert.ok(normCdf(-2) < 0.03);
});

test('winProbability: certain when all games final', () => {
  const me = [{ pid: 'a', visible: true, points: 100, progress: 1 }];
  const opp = [{ pid: 'b', visible: true, points: 90, progress: 1 }];
  const { winProb } = winProbability(me, opp, { a: 0, b: 0 });
  assert.equal(winProb, 1);
});

test('winProbability: leader is favoured, more so as games finish', () => {
  const projections = { a: 20, b: 20 };
  const early = winProbability(
    [{ pid: 'a', visible: true, points: 10, progress: 0.25 }],
    [{ pid: 'b', visible: true, points: 5, progress: 0.25 }],
    projections).winProb;
  const late = winProbability(
    [{ pid: 'a', visible: true, points: 10, progress: 0.9 }],
    [{ pid: 'b', visible: true, points: 5, progress: 0.9 }],
    projections).winProb;
  assert.ok(early > 0.5 && late > early, `${early} ${late}`);
});
