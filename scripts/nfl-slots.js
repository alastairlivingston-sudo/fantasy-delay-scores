// Fetch 2025 NFL kickoff slots -> public/data/nfl-slots.json.  Run: node scripts/nfl-slots.js
const fs = require("fs");
const path = require("path");
const OUT = path.join(__dirname, "..", "public", "data", "nfl-slots.json");
const YEAR = 2025;

(async () => {
  const out = {};
  for (let w = 1; w <= 18; w++) {
    const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&dates=${YEAR}&week=${w}`;
    try {
      const data = await (await fetch(url)).json();
      const wk = {};
      (data.events || []).forEach(ev => {
        (ev.competitions?.[0]?.competitors || []).forEach(c => {
          const ab = c.team?.abbreviation;
          if (ab) wk[ab.toUpperCase()] = ev.date;
        });
      });
      out[w] = wk;
      console.log(`week ${w}: ${Object.keys(wk).length} teams`);
    } catch (e) { console.warn(`week ${w} failed:`, e.message); }
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(out));
  console.log("wrote", OUT);
})();
