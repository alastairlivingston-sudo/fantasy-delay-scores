// Fetch league trades -> public/data/trades.json.  Run: node scripts/fetch-trades.js
const fs = require("fs"); const path = require("path");
const USERNAME = "AlastairL", SEASON = "2025";
const OUT = path.join(__dirname, "..", "public", "data", "trades.json");
const get = async u => (await fetch(u)).json();

(async () => {
  const user = await get(`https://api.sleeper.app/v1/user/${USERNAME}`);
  const leagues = await get(`https://api.sleeper.app/v1/user/${user.user_id}/leagues/nfl/${SEASON}`);
  const lg = leagues.find(l => /borehamwood|plancy/i.test(l.name)) || leagues[0];
  const [rosters, users] = await Promise.all([
    get(`https://api.sleeper.app/v1/league/${lg.league_id}/rosters`),
    get(`https://api.sleeper.app/v1/league/${lg.league_id}/users`)
  ]);
  const teamByRoster = {};
  rosters.forEach(r => {
    const u = users.find(x => x.user_id === r.owner_id);
    teamByRoster[r.roster_id] = u?.metadata?.team_name || u?.display_name || `Team ${r.roster_id}`;
  });
  const trades = [];
  for (let w = 1; w <= 17; w++) {
    const txns = await get(`https://api.sleeper.app/v1/league/${lg.league_id}/transactions/${w}`);
    (txns || []).filter(t => t.type === "trade" && t.status === "complete").forEach(t => {
      const parties = (t.roster_ids || []).map(id => teamByRoster[id]);
      trades.push({ week: w, parties, summary: `${parties.join(" <-> ")} — ${Object.keys(t.adds || {}).length} players moved` });
    });
  }
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, JSON.stringify(trades, null, 2));
  console.log(`wrote ${trades.length} trades`);
})();
