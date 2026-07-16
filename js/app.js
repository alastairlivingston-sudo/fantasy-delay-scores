// UI controller. All rendered numbers come from gate.js output (never raw).

import * as api from './api.js';
import * as store from './state.js';
import { gateMatchup } from './gate.js';
import { mergeSnapshots } from './snapshots.js';
import { scoreProjection, winProbability } from './project.js';
import { highlightSearchUrl } from './youtube.js';
import { startRecorder } from './recorder.js';

const $ = (sel) => document.querySelector(sel);
const el = (tag, cls, text) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
};

const config = store.loadConfig();
let data = null; // {league, rosters, users, matchups, playerMeta, games, mySide, oppSide, projections, playerGames, slots, myName, oppName}
let stopRecorder = null;
let activeTab = 'matchup';

/* ---------------- setup flow ---------------- */

function showLoading(on) { $('#loading').hidden = !on; }
function fail(msg) { const e = $('#setup-error'); e.textContent = msg; e.hidden = false; }

async function connect() {
  const username = $('#username').value.trim();
  if (!username) return;
  showLoading(true);
  $('#setup-error').hidden = true;
  try {
    const [user, nfl] = await Promise.all([api.getUser(username), api.getNflState()]);
    if (!user?.user_id) throw new Error('User not found');
    config.username = username;
    config.userId = user.user_id;
    // Off-season/pre-season: fall back to the last completed season.
    config.season = nfl.season_type === 'regular' || nfl.season_type === 'post'
      ? Number(nfl.season) : Number(nfl.previous_season);
    config.week = nfl.season_type === 'regular' ? Math.max(1, nfl.week) : 17;
    store.saveConfig(config);
    const leagues = await api.getLeagues(user.user_id, config.season);
    if (!leagues.length) return fail(`No ${config.season} leagues found for ${username}.`);
    const list = $('#setup-leagues');
    list.replaceChildren();
    for (const lg of leagues) {
      const b = el('button');
      b.append(el('span', null, lg.name), el('span', 'meta', `${lg.total_rosters} teams · ${lg.season}`));
      b.onclick = () => { config.leagueId = lg.league_id; store.saveConfig(config); enterMain(); };
      list.append(b);
    }
  } catch (err) {
    fail(`Could not connect: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

function showSetup() {
  stopRecorder?.();
  $('#view-main').hidden = true;
  $('#view-setup').hidden = false;
  $('#username').value = config.username || '';
}

/* ---------------- data loading ---------------- */

async function loadWeek() {
  showLoading(true);
  try {
    const { leagueId, season, week } = config;
    const [league, rosters, users, matchups, playerMeta, games] = await Promise.all([
      api.getLeague(leagueId),
      api.getRosters(leagueId),
      api.getLeagueUsers(leagueId),
      api.getMatchups(leagueId, week),
      api.getProjections(season, week),
      api.getScoreboard(season, week),
    ]);

    // Server-recorded snapshots + resolved highlights (null when unavailable)
    const [remote, highlights] = await Promise.all([
      api.getRemoteSnapshots(leagueId, season, week),
      api.getRemoteHighlights(season, week),
    ]);

    const myRoster = rosters.find((r) => r.owner_id === config.userId) || rosters[0];
    const mySide = matchups.find((m) => m.roster_id === myRoster.roster_id);
    const oppSide = matchups.find(
      (m) => m.matchup_id === mySide?.matchup_id && m.roster_id !== mySide.roster_id);
    const nameOf = (side) => {
      const r = rosters.find((x) => x.roster_id === side?.roster_id);
      const u = users.find((x) => x.user_id === r?.owner_id);
      return u?.metadata?.team_name || u?.display_name || `Roster ${side?.roster_id}`;
    };

    const allStarters = [...(mySide?.starters || []), ...(oppSide?.starters || [])];
    const playerGames = api.mapPlayersToGames(allStarters, playerMeta, games);
    const projections = {};
    for (const pid of allStarters) {
      projections[pid] = scoreProjection(playerMeta[pid]?.stats, league.scoring_settings);
    }

    data = {
      league, games, mySide, oppSide, playerMeta, playerGames, projections,
      remoteSnapshots: remote?.snapshots || [],
      highlights: highlights?.videos || {},
      slots: (league.roster_positions || []).filter((p) => p !== 'BN'),
      myName: nameOf(mySide), oppName: nameOf(oppSide),
    };

    stopRecorder?.();
    let ticks = 0;
    stopRecorder = startRecorder({
      leagueId, season, week,
      onSnapshot: async () => {
        // refresh server-side snapshots every 5th local tick (~5 min)
        if (++ticks % 5 === 0) {
          const fresh = await api.getRemoteSnapshots(leagueId, season, week);
          if (fresh) data.remoteSnapshots = fresh.snapshots;
        }
        render();
      },
    });
    render();
  } catch (err) {
    alert(`Failed to load: ${err.message}`);
    showSetup();
  } finally {
    showLoading(false);
  }
}

/* ---------------- rendering ---------------- */

function gate() {
  return gateMatchup(data.mySide || {}, data.oppSide || {}, {
    mode: config.mode,
    playerGames: data.playerGames,
    watched: store.watchedFor(config, config.leagueId, config.week),
    gameStates: Object.fromEntries(
      data.games.map((g) => [g.gameKey, { state: g.state, progress: g.progress }])),
    snapshots: mergeSnapshots(
      data.remoteSnapshots,
      store.loadSnapshots(config.leagueId, config.week)),
    now: Date.now(),
    delayMs: config.delayMinutes * 60_000,
  });
}

function render() {
  if (!data) return;
  $('#view-setup').hidden = true;
  $('#view-main').hidden = false;
  $('#league-name').textContent = data.league.name;
  renderWeekSelect();
  renderModeSwitch();

  const gated = gate();
  renderNotice(gated.me.notice);
  renderScorecard(gated);
  renderStarters(gated);
  renderGames();
  $('#tab-matchup').hidden = activeTab !== 'matchup';
  $('#tab-games').hidden = activeTab !== 'games';
  document.querySelectorAll('.bottom-nav button').forEach((b) =>
    b.classList.toggle('active', b.dataset.tab === activeTab));
}

function renderWeekSelect() {
  const sel = $('#week-select');
  if (sel.options.length !== 18) {
    sel.replaceChildren();
    for (let w = 1; w <= 18; w++) sel.append(new Option(`Week ${w}`, w));
  }
  sel.value = String(config.week);
}

function renderModeSwitch() {
  document.querySelectorAll('.mode-switch button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === config.mode));
  $('#delay-controls').hidden = config.mode !== 'delay';
  $('#delay-select').value = String(config.delayMinutes);
}

function renderNotice(notice) {
  const n = $('#notice');
  if (config.mode === 'delay' && notice?.code === 'recording-too-new') {
    n.textContent = notice.availableAt
      ? `Recording started recently — your ${config.delayMinutes}-min delayed view begins at ${new Date(notice.availableAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}. Keep the app open while you watch.`
      : 'No snapshots recorded yet. Keep the app open from kickoff and the delayed view will fill in.';
    n.hidden = false;
  } else if (config.mode === 'watched') {
    n.textContent = 'Only ticked games count. Tick games you’ve watched in the Games tab.';
    n.hidden = false;
  } else {
    n.hidden = true;
  }
}

function renderScorecard(gated) {
  const { winProb, myExpected, oppExpected } =
    winProbability(gated.me.players, gated.opp.players, data.projections);

  const card = $('#scorecard');
  card.replaceChildren();
  const side = (name, total) => {
    const d = el('div', 'team');
    d.append(el('div', 'team-name', name), el('div', 'team-pts', total.toFixed(2)));
    return d;
  };
  card.append(side(data.myName, gated.me.total), el('div', 'vs', 'vs'), side(data.oppName, gated.opp.total));

  const wp = $('#winprob');
  wp.replaceChildren();
  const bar = el('div', 'bar');
  const fill = el('div');
  fill.style.width = `${Math.round(winProb * 100)}%`;
  bar.append(fill);
  const label = el('div', 'label');
  label.append(
    el('span', null, `Win chance ${Math.round(winProb * 100)}%`),
    el('span', null, `proj ${myExpected.toFixed(1)} – ${oppExpected.toFixed(1)}`),
  );
  wp.append(bar, label);
}

function playerCell(p, meta, right) {
  const d = el('div', `p${right ? ' right' : ''}`);
  const name = meta?.name || (p.pid === '0' ? 'Empty' : p.pid);
  // "Matthew Stafford" → "M. Stafford" so names fit narrow screens (not DEFs)
  const short = meta?.position === 'DEF' ? name : name.replace(/^(\w)\w+ /, '$1. ');
  d.append(el('div', 'n', short));
  const gameLabel = !p.visible ? 'hidden 🔒'
    : p.state === 'pre' ? (meta?.opponent ? `vs ${meta.opponent}` : '—')
    : p.state === 'post' ? 'Final'
    : `In progress`;
  d.append(el('div', `g${p.visible ? '' : ' hidden-pts'}`, gameLabel));
  return d;
}

function renderStarters(gated) {
  const wrap = $('#starters');
  wrap.replaceChildren();
  const n = Math.max(gated.me.players.length, gated.opp.players.length);
  for (let i = 0; i < n; i++) {
    const mine = gated.me.players[i];
    const theirs = gated.opp.players[i];
    const row = el('div', 'row');
    row.append(playerCell(mine, data.playerMeta[mine?.pid], false));
    const pts = el('div', 'pts');
    const fmt = (p) => (p ? (p.visible ? p.points.toFixed(1) : '••') : '');
    pts.append(el('span', mine?.visible ? 'mine' : 'hidden-pts', fmt(mine)),
      el('span', 'hidden-pts', ' · '),
      el('span', theirs?.visible ? 'mine' : 'hidden-pts', fmt(theirs)));
    const slot = el('div', 'slot', data.slots[i] || 'FLX');
    row.prepend(slot);
    row.append(pts, playerCell(theirs, data.playerMeta[theirs?.pid], true));
    wrap.append(row);
  }
}

function renderGames() {
  $('#games-hint').textContent = config.mode === 'watched'
    ? 'Tick a game once you’ve watched it — its players then count in your matchup.'
    : 'Highlights links open a YouTube search for the official (score-free) NFL video.';
  const list = $('#games-list');
  list.replaceChildren();
  const watched = store.watchedFor(config, config.leagueId, config.week);

  for (const g of data.games) {
    const card = el('div', 'game');
    const info = el('div', 'info');
    info.append(el('div', 'matchup-name', `${g.away} @ ${g.home}`));
    // Status only — never a score. Pre-game shows kickoff time.
    const status = g.state === 'pre'
      ? new Date(g.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })
      : g.state === 'post' ? 'Final' : 'In progress';
    info.append(el('div', 'status', status));
    card.append(info);

    const toggle = el('label', 'watch-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = Boolean(watched[g.gameKey]);
    cb.onchange = () => { store.setWatched(config, config.leagueId, config.week, g.gameKey, cb.checked); render(); };
    toggle.append(cb, el('span', 'status', 'seen'));
    card.append(toggle);

    // Direct link to the exact official video when the resolver found one
    // (skips the YouTube results page entirely); search link otherwise.
    const videoId = data.highlights[g.gameKey];
    const a = el('a', 'yt', videoId ? 'Highlights ▶▶' : 'Highlights ▶');
    a.href = videoId
      ? `https://www.youtube.com/watch?v=${videoId}`
      : highlightSearchUrl({ away: g.away, home: g.home, week: config.week, season: config.season });
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    card.append(a);
    list.append(card);
  }
}

/* ---------------- events ---------------- */

$('#btn-connect').onclick = connect;
$('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('#btn-settings').onclick = showSetup;
$('#week-select').onchange = (e) => { config.week = Number(e.target.value); store.saveConfig(config); loadWeek(); };
$('#delay-select').onchange = (e) => { config.delayMinutes = Number(e.target.value); store.saveConfig(config); render(); };
document.querySelectorAll('.mode-switch button').forEach((b) => {
  b.onclick = () => { config.mode = b.dataset.mode; store.saveConfig(config); render(); };
});
document.querySelectorAll('.bottom-nav button').forEach((b) => {
  b.onclick = () => { activeTab = b.dataset.tab; render(); };
});

function enterMain() { $('#view-setup').hidden = true; loadWeek(); }

if (config.userId && config.leagueId && config.season && config.week) enterMain();
else showSetup();
