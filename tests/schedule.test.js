import test from 'node:test';
import assert from 'node:assert/strict';
import { londonParts, isWindowStartHour, inRecordingWindow } from '../js/schedule.js';

// 2025: BST runs to Sun 26 Oct, GMT from then on — both instants below are
// safely clear of the transition so the BST/GMT split is unambiguous.
const BST_1700 = new Date('2025-09-21T16:00:00Z'); // 17:00 BST
const BST_1800 = new Date('2025-09-21T17:00:00Z'); // 18:00 BST
const BST_0300 = new Date('2025-09-22T02:00:00Z'); // 03:00 BST (still window)
const BST_0500 = new Date('2025-09-22T04:00:00Z'); // 05:00 BST (window over)
const GMT_1700 = new Date('2025-11-23T17:00:00Z'); // 17:00 GMT
const GMT_1600 = new Date('2025-11-23T16:00:00Z'); // 16:00 GMT (too early)

test('londonParts reads the correct local hour across BST and GMT', () => {
  assert.equal(londonParts(BST_1700).hour, 17);
  assert.equal(londonParts(GMT_1700).hour, 17);
  assert.equal(londonParts(GMT_1600).hour, 16);
});

test('isWindowStartHour only fires at the real local 17:00, in either DST state', () => {
  assert.equal(isWindowStartHour(BST_1700), true);
  assert.equal(isWindowStartHour(GMT_1700), true);
  assert.equal(isWindowStartHour(BST_1800), false);
  assert.equal(isWindowStartHour(GMT_1600), false);
});

test('inRecordingWindow spans 17:00 today through 03:59 tomorrow, wall-clock', () => {
  assert.equal(inRecordingWindow(BST_1700), true);
  assert.equal(inRecordingWindow(BST_1800), true);
  assert.equal(inRecordingWindow(BST_0300), true);
  assert.equal(inRecordingWindow(BST_0500), false);
  assert.equal(inRecordingWindow(GMT_1600), false);
  assert.equal(inRecordingWindow(GMT_1700), true);
});
