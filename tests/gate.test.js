import test from 'node:test';
import assert from 'node:assert/strict';
import { gateSide, pickSnapshot } from '../js/gate.js';

const side = {
  starters: ['p1', 'p2', 'p3'],
  players_points: { p1: 10.5, p2: 7.2, p3: 3.0 },
};
const playerGames = { p1: 'MIA@BUF', p2: 'KC@LAC', p3: 'MIA@BUF' };
const gameStates = {
  'MIA@BUF': { state: 'post', progress: 1 },
  'KC@LAC': { state: 'in', progress: 0.5 },
};

test('live mode shows everything', () => {
  const g = gateSide(side, { mode: 'live', playerGames, gameStates });
  assert.equal(g.total, 20.7);
  assert.ok(g.players.every((p) => p.visible));
});

test('watched mode counts only ticked games', () => {
  const g = gateSide(side, {
    mode: 'watched', playerGames, gameStates, watched: { 'MIA@BUF': true },
  });
  assert.equal(g.total, 13.5); // p1 + p3 only
  const p2 = g.players.find((p) => p.pid === 'p2');
  assert.equal(p2.visible, false);
  assert.equal(p2.points, 0);
  assert.equal(p2.state, 'hidden');
});

test('watched mode shows pre-game players with zero points (nothing to spoil)', () => {
  const g = gateSide(
    { starters: ['p2'], players_points: { p2: 0 } },
    {
      mode: 'watched', playerGames,
      gameStates: { 'KC@LAC': { state: 'pre', progress: 0 } },
      watched: {},
    });
  assert.equal(g.players[0].visible, true);
});

test('watched mode hides unticked and unmapped players with points (fail safe)', () => {
  const g = gateSide(side, {
    mode: 'watched', playerGames: { p1: 'MIA@BUF' }, gameStates, watched: {},
  });
  // p1: game is post and unticked ⇒ hidden.
  // p2/p3: no game mapping but nonzero points ⇒ hidden.
  assert.ok(g.players.every((p) => !p.visible));
  assert.equal(g.total, 0);
});

test('delay picks newest snapshot older than the delay, never newer', () => {
  const snaps = [
    { t: 1000, players_points: { p1: 1 }, gameStates },
    { t: 2000, players_points: { p1: 2 }, gameStates },
    { t: 3000, players_points: { p1: 3 }, gameStates },
  ];
  assert.equal(pickSnapshot(snaps, 3500, 1000).t, 2000);
  assert.equal(pickSnapshot(snaps, 3500, 500).t, 3000);
  assert.equal(pickSnapshot(snaps, 3500, 2600), null); // oldest is still too new
});

test('delay mode replays snapshot points', () => {
  const snaps = [{ t: 1000, players_points: { p1: 4.4, p2: 1.1, p3: 0 }, gameStates }];
  const g = gateSide(side, {
    mode: 'delay', playerGames, snapshots: snaps, now: 61_000 + 1000, delayMs: 60_000,
  });
  assert.equal(g.total, 5.5);
  assert.equal(g.notice, null);
});

test('delay mode with recording too new shows zeros + notice, not oldest snapshot', () => {
  const snaps = [{ t: 100_000, players_points: { p1: 99 }, gameStates }];
  const g = gateSide(side, {
    mode: 'delay', playerGames, snapshots: snaps, now: 120_000, delayMs: 60_000,
  });
  assert.equal(g.total, 0);
  assert.equal(g.notice.code, 'recording-too-new');
  assert.equal(g.notice.availableAt, 160_000);
});
