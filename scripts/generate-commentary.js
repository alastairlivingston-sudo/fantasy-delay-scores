// Player-aware banter -> public/data/commentary.json
// Run: ANTHROPIC_API_KEY=sk-... node scripts/generate-commentary.js
const fs = require("fs"); const path = require("path"); const Papa = require("papaparse");
const DATA = path.join(__dirname, "..", "public", "data");
const BENCH = new Set(["bn","be","bench","ir","taxi","res","reserve","na",""]);
const MY = "alastairl"; const lc = s => String(s ?? "").trim().toLowerCase();

const seed = JSON.parse(fs.readFileSync(path.join(DATA, "season.seed.json"), "utf8"));
const rows = Papa.parse(fs.readFileSync(path.join(DATA, "all-weeks.csv"), "utf8"),
  { header: true, dynamicTyping: true, skipEmptyLines: true }).data
  .filter(r => r && r.Owner != null && r.Week != null)
  .map(r => ({ owner: lc(r.Owner), week: +r.Week, player: r.Player, pos: r.Position, slot: lc(r.Fantasy), pts: +r.Points || 0 }));

const top = (o, wk) => rows.filter(r => r.owner === o && r.week === wk && !BENCH.has(r.slot))
  .sort((a, b) => b.pts - a.pts).slice(0, 3).map(r => `${r.player} (${r.pos}) ${r.pts.toFixed(1)}`);
const benchHero = (o, wk) => rows.filter(r => r.owner === o && r.week === wk && BENCH.has(r.slot)).sort((a, b) => b.pts - a.pts)[0];

const BRIEF = `You are the official commentator of the Borehamwood Plancy League fantasy NFL league.
Voice: bone-dry British banter that takes a low-stakes hobby with the utmost mock-gravity. Roast the loser
(including us), celebrate the winner, never cruel, always funny. Reference the actual players and numbers.
2-3 sentences. No emoji. Champion is "Fourth and Golda Meir".`;

(async () => {
  const out = {};
  for (const m of seed.matches) {
    const oh = m.handle.toLowerCase(); const bh = benchHero(MY, m.week);
    const ctx = `Week ${m.week}${m.playoff ? " (PLAYOFF)" : ""}: Fourth and Golda Meir ${m.mine} vs ${m.opp} ${m.them} — ${m.mine > m.them ? "WIN" : "LOSS"}.
Our top scorers: ${top(MY, m.week).join(", ") || "n/a"}.
Their top scorers: ${top(oh, m.week).join(", ") || "n/a"}.
${bh ? `Our highest-scoring benched player: ${bh.player} ${bh.pts.toFixed(1)}.` : ""}`;
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 300, system: BRIEF, messages: [{ role: "user", content: ctx }] })
    });
    const data = await res.json();
    out[m.week] = (data.content || []).map(c => c.text || "").join("").trim();
    console.log(`week ${m.week} ok`);
  }
  fs.writeFileSync(path.join(DATA, "commentary.json"), JSON.stringify(out, null, 2));
  console.log("wrote commentary.json");
})();
