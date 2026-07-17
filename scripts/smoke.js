// Live-API contract check: verifies the response shapes the app depends on.
// Run with `npm run smoke`. Uses real (completed-season) data.

const SEASON = 2025;
const WEEK = 3;
const LEAGUE = '1181898177582030848'; // Borehamwood

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

function check(name, cond) {
  if (!cond) throw new Error(`FAIL: ${name}`);
  console.log(`ok  ${name}`);
}

const state = await getJson('https://api.sleeper.app/v1/state/nfl');
check('state/nfl has season + season_type', state.season && state.season_type);

const user = await getJson('https://api.sleeper.app/v1/user/AlastairL');
check('user lookup returns user_id', typeof user.user_id === 'string');

const matchups = await getJson(`https://api.sleeper.app/v1/league/${LEAGUE}/matchups/${WEEK}`);
check('matchups include players_points + starters', matchups.length > 0
  && matchups[0].players_points && Array.isArray(matchups[0].starters));

const league = await getJson(`https://api.sleeper.app/v1/league/${LEAGUE}`);
check('league has scoring_settings + roster_positions',
  league.scoring_settings && Array.isArray(league.roster_positions));

const proj = await getJson(
  `https://api.sleeper.com/projections/nfl/${SEASON}/${WEEK}?season_type=regular&position[]=QB&position[]=DEF&order_by=pts_ppr`);
check('projections include player team + stats', proj.length > 100
  && proj[0].player_id && proj[0].stats && (proj[0].player?.team || proj[0].team));
check('projections include DEF rows', proj.some((r) => r.player?.position === 'DEF'));

const stats = await getJson(
  `https://api.sleeper.com/stats/nfl/${SEASON}/${WEEK}?season_type=regular&position[]=RB&order_by=pts_ppr`);
check('stats include per-player actuals (rush_yd/rush_td)', stats.length > 50
  && stats[0].player_id && stats[0].stats
  && stats.some((r) => r.stats && (r.stats.rush_yd || r.stats.rush_td)));

const sb = await getJson(
  `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard?seasontype=2&week=${WEEK}&dates=${SEASON}`);
check('scoreboard has events with status + competitors', sb.events?.length > 10
  && sb.events[0].competitions[0].status.type.state
  && sb.events[0].competitions[0].competitors.length === 2);

console.log('\nAll live-API contracts hold.');
