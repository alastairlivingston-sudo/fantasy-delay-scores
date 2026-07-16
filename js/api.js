// All network access. Sleeper + ESPN public APIs (both CORS-enabled, keyless).
import { normalizeCode } from './teams.js';

const SLEEPER = 'https://api.sleeper.app/v1';
const SLEEPER_DATA = 'https://api.sleeper.com';
const ESPN = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';

async function getJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res.json();
}

export const getNflState = () => getJson(`${SLEEPER}/state/nfl`);
export const getUser = (username) => getJson(`${SLEEPER}/user/${encodeURIComponent(username)}`);
export const getLeagues = (userId, season) => getJson(`${SLEEPER}/user/${userId}/leagues/nfl/${season}`);
export const getLeague = (leagueId) => getJson(`${SLEEPER}/league/${leagueId}`);
export const getRosters = (leagueId) => getJson(`${SLEEPER}/league/${leagueId}/rosters`);
export const getLeagueUsers = (leagueId) => getJson(`${SLEEPER}/league/${leagueId}/users`);
export const getMatchups = (leagueId, week) => getJson(`${SLEEPER}/league/${leagueId}/matchups/${week}`);

/**
 * Per-stat projections for every fantasy-relevant player in the week.
 * Returns {pid: {team, opponent, name, position, stats}}.
 * Also the player→NFL-team source, so no 5MB players blob is needed.
 */
export async function getProjections(season, week) {
  const positions = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'].map((p) => `position[]=${p}`).join('&');
  const rows = await getJson(
    `${SLEEPER_DATA}/projections/nfl/${season}/${week}?season_type=regular&${positions}&order_by=pts_ppr`);
  const byId = {};
  for (const r of rows) {
    byId[r.player_id] = {
      team: normalizeCode(r.player?.team || r.team),
      opponent: normalizeCode(r.opponent),
      name: r.player ? `${r.player.first_name} ${r.player.last_name}`.trim() : r.player_id,
      position: r.player?.position || '',
      stats: r.stats || {},
    };
  }
  return byId;
}

/**
 * The week's NFL games from ESPN, normalised to Sleeper team codes.
 * Returns [{gameKey, away, home, date, state: 'pre'|'in'|'post', progress,
 *           detail}] — deliberately NO scores: spoiler rule 2 says the UI
 * never shows an opposing-source score, so we don't even fetch-and-hold them.
 */
export async function getScoreboard(season, week) {
  const data = await getJson(`${ESPN}/scoreboard?seasontype=2&week=${week}&dates=${season}`);
  return (data.events || []).map((e) => {
    const comp = e.competitions[0];
    const away = normalizeCode(comp.competitors.find((c) => c.homeAway === 'away')?.team.abbreviation);
    const home = normalizeCode(comp.competitors.find((c) => c.homeAway === 'home')?.team.abbreviation);
    const st = comp.status;
    const state = st.type.state; // 'pre' | 'in' | 'post'
    let progress = 0;
    if (state === 'post') progress = 1;
    else if (state === 'in') {
      const period = st.period || 1;
      const [m, s] = String(st.displayClock || '15:00').split(':').map(Number);
      const remainingInPeriod = (isNaN(m) ? 15 : m) + (isNaN(s) ? 0 : s) / 60;
      const elapsed = (Math.min(period, 4) - 1) * 15 + (15 - Math.min(remainingInPeriod, 15));
      progress = Math.min(period > 4 ? 0.99 : elapsed / 60, 0.99);
    }
    return {
      gameKey: `${away}@${home}`,
      away, home,
      date: e.date,
      state, progress,
      detail: st.type.shortDetail || st.type.detail || '',
    };
  });
}

/** {pid: gameKey} for a set of players, joining their team to the week's games. */
export function mapPlayersToGames(playerIds, playerMeta, games) {
  const teamGame = {};
  for (const g of games) { teamGame[g.away] = g.gameKey; teamGame[g.home] = g.gameKey; }
  const out = {};
  for (const pid of playerIds) {
    // Team DEF player_ids are the team code itself.
    const team = playerMeta[pid]?.team || normalizeCode(pid.match(/^[A-Z]{2,3}$/) ? pid : null);
    if (team && teamGame[team]) out[pid] = teamGame[team];
  }
  return out;
}
