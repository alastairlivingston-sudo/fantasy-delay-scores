// UK-wall-clock scheduling helpers for the live-window recorder. Pure logic
// (Date/Intl only, no fetch/DOM) so it's node-testable; used server-side by
// scripts/record-live.js, not shipped to the browser bundle.
//
// The live recording window is 17:00 -> 04:00 UK wall-clock, which straddles
// the BST/GMT boundary (last Sunday of March / October). Rather than hardcode
// that transition date, every check asks the IANA tz database (via Intl)
// what the actual local hour is right now — correct automatically forever.

export function londonParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date);
  const get = (type) => Number(parts.find((p) => p.type === type).value);
  return { hour: get('hour') % 24, minute: get('minute') };
}

// True only during the exact wall-clock hour recording should start — used to
// gate the two candidate cron triggers (one for BST weeks, one for GMT weeks)
// so only the correct one actually proceeds.
export function isWindowStartHour(date = new Date()) {
  return londonParts(date).hour === 17;
}

// True from 17:00 today through 03:59 the next day, UK wall-clock.
export function inRecordingWindow(date = new Date()) {
  const { hour } = londonParts(date);
  return hour >= 17 || hour < 4;
}
