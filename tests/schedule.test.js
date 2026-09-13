import test from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldRecord, nextWindowStart, recordingEndsAt,
  PRE_KICKOFF_MS, GAME_LENGTH_MS, POST_GAME_MS,
} from '../js/schedule.js';

const at = (iso) => new Date(iso).getTime();
const game = (date, state = 'pre') => ({ gameKey: 'AA@BB', date, state });

// A real Sunday slate: 1pm ET (17:00Z) and 4:25pm ET (20:25Z) waves, then SNF.
const SLATE = [game('2026-09-13T17:00Z'), game('2026-09-13T20:25Z'), game('2026-09-14T00:20Z')];

test('the window opens shortly before the first kickoff, not on a wall clock', () => {
  assert.equal(shouldRecord(SLATE, at('2026-09-13T15:00Z')), false, 'two hours out');
  assert.equal(shouldRecord(SLATE, at('2026-09-13T16:29Z')), false, '31 min out');
  assert.equal(shouldRecord(SLATE, at('2026-09-13T16:31Z')), true, 'inside the warm-up');
  assert.equal(shouldRecord(SLATE, at('2026-09-13T18:00Z')), true, 'mid-game');
});

// The bug this replaces: the old gate demanded the local hour be exactly 17,
// so a cron delivered late no-opped and the slate went unrecorded.
test('a cron delivered hours late still finds the window open', () => {
  for (const late of ['2026-09-13T18:34Z', '2026-09-13T19:16Z', '2026-09-13T21:08Z']) {
    assert.equal(shouldRecord(SLATE, at(late)), true, `late delivery at ${late}`);
  }
});

test('a game in progress keeps recording however long it overruns', () => {
  const overtime = [game('2026-09-13T17:00Z', 'in')];
  const wayPast = at('2026-09-13T17:00Z') + GAME_LENGTH_MS + POST_GAME_MS + 3600e3;
  assert.equal(shouldRecord(overtime, wayPast), true, 'state "in" beats the clock');
  assert.equal(shouldRecord([game('2026-09-13T17:00Z', 'post')], wayPast), false);
});

test('recording continues for the post-game tail, then stops', () => {
  const lastKick = at('2026-09-14T00:20Z');
  assert.equal(shouldRecord(SLATE, lastKick + GAME_LENGTH_MS + POST_GAME_MS - 60e3), true);
  assert.equal(shouldRecord(SLATE, lastKick + GAME_LENGTH_MS + POST_GAME_MS + 60e3), false);
});

test('an empty or malformed schedule never starts the recorder', () => {
  assert.equal(shouldRecord([], Date.now()), false);
  assert.equal(shouldRecord(undefined, Date.now()), false);
  assert.equal(shouldRecord([{ date: 'not-a-date', state: 'pre' }], Date.now()), false);
  assert.equal(nextWindowStart([{ date: 'not-a-date' }], Date.now()), null);
});

test('nextWindowStart lets an early run wait instead of exiting', () => {
  // Delivered at noon, four and a half hours before the window opens.
  const noon = at('2026-09-13T12:00Z');
  assert.equal(nextWindowStart(SLATE, noon), at('2026-09-13T17:00Z') - PRE_KICKOFF_MS);
  // Once inside the window there is nothing ahead but the later waves.
  assert.equal(nextWindowStart(SLATE, at('2026-09-13T18:00Z')), at('2026-09-13T20:25Z') - PRE_KICKOFF_MS);
  // Nothing left after the last tail.
  assert.equal(nextWindowStart(SLATE, at('2026-09-15T00:00Z')), null);
});

test('recordingEndsAt follows the overlaps to the end of the whole slate', () => {
  // Mid-afternoon the 1pm wave is open; its tail reaches past the 4:25pm
  // kickoff, whose tail reaches past SNF — one continuous stretch, so the
  // answer is SNF's tail, not this game's.
  assert.equal(recordingEndsAt(SLATE, at('2026-09-13T18:00Z')),
    at('2026-09-14T00:20Z') + GAME_LENGTH_MS + POST_GAME_MS);
  assert.equal(recordingEndsAt(SLATE, at('2026-09-13T12:00Z')), null, 'nothing open yet');
  // A lone game with a real gap after it ends at its own tail.
  const lone = [game('2026-09-17T00:15Z')];
  assert.equal(recordingEndsAt(lone, at('2026-09-17T01:00Z')),
    at('2026-09-17T00:15Z') + GAME_LENGTH_MS + POST_GAME_MS);
});

test('windows are tunable so a caller can widen the tail', () => {
  const kick = at('2026-09-13T17:00Z');
  const justAfter = kick + GAME_LENGTH_MS + POST_GAME_MS + 60e3;
  assert.equal(shouldRecord([game('2026-09-13T17:00Z', 'post')], justAfter), false);
  assert.equal(shouldRecord([game('2026-09-13T17:00Z', 'post')], justAfter, { postMs: POST_GAME_MS + 3600e3 }), true);
});
