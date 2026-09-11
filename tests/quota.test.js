import test from 'node:test';
import assert from 'node:assert/strict';
import { weekKey, quotaState, spendRefresh, resetsAt, WEEKLY_REFRESH_LIMIT } from '../js/quota.js';

// Local-time dates on purpose: the allowance is a user-facing week, not UTC.
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

test('weekKey groups a Mon-Sun week under one key', () => {
  const monday = weekKey(at(2026, 9, 7));
  assert.equal(weekKey(at(2026, 9, 8)), monday);
  assert.equal(weekKey(at(2026, 9, 13, 23)), monday, 'Sunday is the same week');
  assert.notEqual(weekKey(at(2026, 9, 14)), monday, 'next Monday starts a new week');
});

test('weekKey uses the ISO year, so new year does not split a week', () => {
  // Thu 2026-12-31 and Fri 2027-01-01 are the same ISO week.
  assert.equal(weekKey(at(2026, 12, 31)), weekKey(at(2027, 1, 1)));
});

test('a fresh browser has the full allowance', () => {
  const s = quotaState(undefined, WEEKLY_REFRESH_LIMIT, at(2026, 9, 10));
  assert.equal(s.used, 0);
  assert.equal(s.remaining, 500);
  assert.equal(s.exhausted, false);
});

test('last week’s counter does not carry over', () => {
  const lastWeek = { week: weekKey(at(2026, 9, 3)), used: 500 };
  const s = quotaState(lastWeek, WEEKLY_REFRESH_LIMIT, at(2026, 9, 10));
  assert.equal(s.used, 0, 'the reset needs no scheduled cleanup');
  assert.equal(s.exhausted, false);
});

test('spending counts down and eventually refuses', () => {
  const now = at(2026, 9, 10);
  const first = spendRefresh(undefined, 3, now);
  assert.equal(first.ok, true);
  assert.equal(first.state.remaining, 2);

  const second = spendRefresh(first.stored, 3, now);
  const third = spendRefresh(second.stored, 3, now);
  assert.equal(third.state.remaining, 0);
  assert.equal(third.state.exhausted, true);

  const fourth = spendRefresh(third.stored, 3, now);
  assert.equal(fourth.ok, false, 'over the limit');
  assert.equal(fourth.state.used, 3, 'a refused spend does not increment');
});

test('a corrupt or hand-edited counter cannot mint extra checks', () => {
  const now = at(2026, 9, 10);
  assert.equal(quotaState({ week: weekKey(now), used: -5 }, 3, now).remaining, 3);
  assert.equal(quotaState({ week: weekKey(now), used: 'lots' }, 3, now).used, 0);
});

test('the allowance resets at the next Monday midnight', () => {
  const r = resetsAt(at(2026, 9, 10)); // a Thursday
  assert.equal(r.getDay(), 1, 'Monday');
  assert.equal(r.getDate(), 14);
  assert.equal(r.getHours(), 0);
  // On a Monday it points at the NEXT Monday, never today.
  assert.equal(resetsAt(at(2026, 9, 14)).getDate(), 21);
});
