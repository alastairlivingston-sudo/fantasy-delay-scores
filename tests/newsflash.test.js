import test from 'node:test';
import assert from 'node:assert/strict';
import { buildFeed, describeStatDelta, pickStats, STAT_KEYS } from '../js/newsflash.js';

const meta = {
  QB1: { name: 'Josh Allen' },
  RB1: { name: 'James Cook' },
  RB2: { name: 'Opp Back' },
};

test('describeStatDelta names the plays behind a scoring change', () => {
  const desc = describeStatDelta(
    { rush_yd: 20, rush_td: 0 },
    { rush_yd: 60, rush_td: 1 });
  assert.equal(desc, '1 rush TD, 40 rush yds');
});

test('describeStatDelta returns empty when nothing known changed', () => {
  assert.equal(describeStatDelta({ rush_yd: 10 }, { rush_yd: 10 }), '');
  assert.equal(describeStatDelta(undefined, undefined), '');
});

test('pickStats keeps only known, non-zero fields', () => {
  const picked = pickStats({ rush_yd: 40, rush_td: 0, made_up: 9, pass_yd: 0 });
  assert.deepEqual(picked, { rush_yd: 40 });
  assert.ok(STAT_KEYS.includes('rec_td'));
});

test('buildFeed emits newest-first events with points + play detail', () => {
  const snaps = [
    { t: 1000, players_points: { QB1: 0 }, player_stats: { QB1: {} } },
    { t: 2000, players_points: { QB1: 6.4 }, player_stats: { QB1: { pass_td: 1, pass_yd: 38 } } },
    { t: 3000, players_points: { QB1: 6.4, RB1: 6 }, player_stats: { QB1: { pass_td: 1, pass_yd: 38 }, RB1: { rush_td: 1 } } },
  ];
  const feed = buildFeed(snaps, meta, ['QB1', 'RB1']);
  assert.equal(feed.length, 2);
  assert.equal(feed[0].t, 3000);           // newest first
  assert.equal(feed[0].name, 'James Cook');
  assert.equal(feed[0].pointsDelta, 6);
  assert.equal(feed[0].description, '1 rush TD');
  assert.equal(feed[1].name, 'Josh Allen');
  assert.equal(feed[1].description, '1 pass TD, 38 pass yds');
});

test('buildFeed falls back to points-only when stats are absent', () => {
  const snaps = [
    { t: 1000, players_points: { RB1: 0 } },
    { t: 2000, players_points: { RB1: 4.2 } },
  ];
  const feed = buildFeed(snaps, meta, ['RB1']);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].pointsDelta, 4.2);
  assert.equal(feed[0].description, '');
});

test('buildFeed restricts to the given player ids', () => {
  const snaps = [
    { t: 1000, players_points: { QB1: 0, RB2: 0 } },
    { t: 2000, players_points: { QB1: 6, RB2: 12 } },
  ];
  const feed = buildFeed(snaps, meta, ['QB1']);
  assert.equal(feed.length, 1);
  assert.equal(feed[0].pid, 'QB1');
});

test('buildFeed needs at least two snapshots', () => {
  assert.deepEqual(buildFeed([], meta, null), []);
  assert.deepEqual(buildFeed([{ t: 1, players_points: { QB1: 5 } }], meta, null), []);
});
