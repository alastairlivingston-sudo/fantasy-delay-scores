// Prints the total number of resolved highlights across weeks 1-18 for a season,
// summed from <dataDir>/highlights-<season>-<week>.json. Used by
// backfill-highlights.yml to detect when a backfill run has stopped making
// progress (so the daily schedule can turn itself off).
//
// Usage: node scripts/count-highlights.js <dataDir> <season>

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const [dataDir, season] = process.argv.slice(2);
if (!dataDir || !season) {
  console.error('usage: node scripts/count-highlights.js <dataDir> <season>');
  process.exit(1);
}

let total = 0;
for (let week = 1; week <= 18; week++) {
  try {
    const body = JSON.parse(readFileSync(join(dataDir, `highlights-${season}-${week}.json`), 'utf8'));
    total += Object.keys(body.videos || {}).length;
  } catch { /* week not resolved yet */ }
}
process.stdout.write(String(total));
