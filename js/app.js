// UI controller. All rendered numbers come from gate.js output (never raw).

import * as api from './api.js';
import * as store from './state.js';
import { gateMatchup, visibleSnapshots } from './gate.js';
import { mergeSnapshots } from './snapshots.js';
import { scoreProjection, winProbability } from './project.js';
import { buildFeed } from './newsflash.js';
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

// A league not yet underway (drafting/pre-draft) has no current week; a
// completed prior season is browsed at its final week.
function weekForSeason(nfl, leagueSeason) {
  if (leagueSeason === Number(nfl.season) && nfl.season_type === 'regular') {
    return Math.max(1, nfl.week);
  }
  return leagueSeason === Number(nfl.previous_season) ? 17 : 1;
}

async function connect(usernameArg) {
  const username = (usernameArg ?? $('#username').value).trim();
  if (!username) return;
  showLoading(true);
  $('#setup-error').hidden = true;
  try {
    const [user, nfl] = await Promise.all([api.getUser(username), api.getNflState()]);
    if (!user?.user_id) throw new Error('User not found');
    config.username = username;
    config.userId = user.user_id;
    store.saveConfig(config);

    // In-season: only the active season's leagues exist. Off/pre-season:
    // show both the upcoming season's leagues (may be mid-draft) and last
    // season's (for browsing), since a brand-new league only exists in one.
    const currentSeason = Number(nfl.season);
    const seasons = nfl.season_type === 'regular' || nfl.season_type === 'post'
      ? [currentSeason]
      : [currentSeason, Number(nfl.previous_season)];
    const leagueLists = await Promise.all(seasons.map((s) => api.getLeagues(user.user_id, s)));
    const leagues = leagueLists.flat()
      .sort((a, b) => Number(b.season) - Number(a.season) || a.name.localeCompare(b.name));
    if (!leagues.length) return fail(`No leagues found for ${username}.`);
    const list = $('#setup-leagues');
    list.replaceChildren();
    for (const lg of leagues) {
      const b = el('button');
      b.append(el('span', null, lg.name), el('span', 'meta', `${lg.total_rosters} teams · ${lg.season}`));
      b.onclick = () => {
        config.leagueId = lg.league_id;
        config.season = Number(lg.season);
        config.week = weekForSeason(nfl, config.season);
        config.modeConfirmed = false;
        store.saveConfig(config);
        enterMain();
      };
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
  $('#view-mode').hidden = true;
  $('#view-setup').hidden = false;
  $('#username').value = config.username || '';
}

function updateModeChoiceUI() {
  document.querySelectorAll('#mode-choices button').forEach((b) =>
    b.classList.toggle('active', b.dataset.mode === config.mode));
  $('#mode-delay-controls').hidden = config.mode !== 'delay';
  $('#mode-delay-select').value = String(config.delayMinutes);
}

function showModeChoice() {
  $('#view-setup').hidden = true;
  $('#view-main').hidden = true;
  $('#view-mode').hidden = false;
  updateModeChoiceUI();
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

    // Games sorted by kickoff so the list reads chronologically.
    games.sort((a, b) => new Date(a.date) - new Date(b.date));

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
      highlightsCheckedAt: highlights?.checkedAt || null,
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

function buildCtx() {
  return {
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
  };
}

function render() {
  if (!data) return;
  $('#view-setup').hidden = true;
  $('#view-mode').hidden = true;
  $('#view-main').hidden = false;
  $('#league-name').textContent = data.league.name;
  renderWeekSelect();
  renderModeSwitch();
  renderModeIndicator();
  renderDefaultHint();
  renderBottomNav();

  const ctx = buildCtx();
  const gated = gateMatchup(data.mySide || {}, data.oppSide || {}, ctx);
  renderNotice(gated.me.notice);
  renderScorecard(gated);
  renderStarters(gated);
  renderGames();
  renderNews(ctx);
  $('#tab-matchup').hidden = activeTab !== 'matchup';
  $('#tab-games').hidden = activeTab !== 'games';
  $('#tab-news').hidden = activeTab !== 'news';
}

// Second bottom-nav tab depends on mode: highlights (watched) vs news (delay).
function renderBottomNav() {
  const showNews = config.mode === 'delay';
  $('.bottom-nav [data-tab="games"]').hidden = showNews;
  $('.bottom-nav [data-tab="news"]').hidden = !showNews;
  // Keep activeTab valid for the mode.
  if (showNews && activeTab === 'games') activeTab = 'news';
  if (!showNews && activeTab === 'news') activeTab = 'games';
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

function renderModeIndicator() {
  $('#mode-indicator').textContent = config.mode === 'delay'
    ? `Delay ${config.delayMinutes}m` : 'Watched';
}

function renderDefaultHint() {
  const isDefault = config.defaultLeagueId === config.leagueId
    && config.defaultMode === config.mode
    && (config.mode !== 'delay' || config.defaultDelayMinutes === config.delayMinutes);
  const btn = $('#btn-set-default');
  btn.disabled = isDefault;
  $('#default-hint').textContent = isDefault
    ? 'This league + mode opens by default.'
    : 'Opens straight into this league + mode on launch.';
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

function relativeTime(iso) {
  const ms = Date.now() - new Date(iso).getTime();
  const mins = Math.round(ms / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  return `${Math.round(mins / 60)}h ago`;
}

let toastTimer = null;
function flashSaved(msg = 'Saved') {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); t.hidden = true; }, 1200);
}

function renderGames() {
  $('#games-hint').textContent = config.mode === 'watched'
    ? 'Tick a game once you’ve watched it — its players then count in your matchup.'
    : 'Only a confirmed, full-length official NFL highlight is ever linked — never a live search, to avoid spoiling the score.';
  $('#highlights-checked').textContent = data.highlightsCheckedAt
    ? `Highlights last checked: ${new Date(data.highlightsCheckedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    : '';
  const list = $('#games-list');
  list.replaceChildren();
  const watched = store.watchedFor(config, config.leagueId, config.week);

  for (const g of data.games) {
    const isWatched = Boolean(watched[g.gameKey]);
    const card = el('div', `game${isWatched ? ' watched' : ''}`);

    // One compact line: kickoff time (never a score) · matchup, plus a tiny
    // live/final status tag so you can tell what's on without a scoreline.
    const info = el('div', 'info');
    const kickoff = new Date(g.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
    const tag = g.state === 'post' ? 'Final' : g.state === 'in' ? 'Live' : '';
    const line = el('div', 'matchup-name');
    line.append(el('span', 'kick', kickoff), el('span', null, ` · ${g.away} @ ${g.home}`));
    if (tag) line.append(el('span', `tag ${g.state}`, tag));
    info.append(line);
    card.append(info);

    const toggle = el('label', 'watch-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = isWatched;
    cb.onchange = () => {
      store.setWatched(config, config.leagueId, config.week, g.gameKey, cb.checked);
      flashSaved();
      render();
    };
    toggle.append(cb, el('span', 'status', 'seen'));
    card.append(toggle);

    // Only a resolver-confirmed, full-length official upload is ever linked
    // (never a live search — its results page can itself show a score).
    const video = data.highlights[g.gameKey];
    if (video) {
      const a = el('a', 'yt', '▶ Highlights');
      a.title = `Posted ${relativeTime(video.publishedAt)}`;
      a.href = `https://www.youtube.com/watch?v=${video.id}`;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      card.append(a);
    } else {
      const label = g.state === 'post' ? 'No highlight yet' : '—';
      card.append(el('span', 'yt pending', label));
    }
    list.append(card);
  }
}

function renderNews(ctx) {
  if (config.mode !== 'delay') return;
  $('#news-hint').textContent =
    `Latest scoring, delayed ${config.delayMinutes} min to match your view — never ahead of it.`;
  const feed = $('#news-feed');
  feed.replaceChildren();

  // Only snapshots old enough for the delay are ever seen (spoiler rule 1);
  // the gating decision lives in gate.js, we just format the result here.
  const snaps = visibleSnapshots(ctx);
  const myStarters = data.mySide?.starters || [];
  const oppStarters = data.oppSide?.starters || [];
  const events = buildFeed(snaps, data.playerMeta, [...myStarters, ...oppStarters]);

  if (!events.length) {
    feed.append(el('div', 'news-empty',
      'No plays yet in your delayed window. Scoring will appear here as it clears the delay.'));
    return;
  }

  const mine = new Set(myStarters);
  for (const ev of events.slice(0, 60)) {
    const item = el('div', 'news-item');
    const delta = el('div', `delta${ev.pointsDelta < 0 ? ' neg' : ''}`,
      `${ev.pointsDelta > 0 ? '+' : ''}${ev.pointsDelta.toFixed(1)}`);
    const body = el('div', 'body');
    const who = mine.has(ev.pid) ? `${ev.name}` : `${ev.name} (opp)`;
    body.append(el('div', 'who', who));
    if (ev.description) body.append(el('div', 'what', ev.description));
    const when = el('div', 'when',
      new Date(ev.t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    item.append(delta, body, when);
    feed.append(item);
  }
}

/* ---------------- drawer ---------------- */

function openDrawer() { $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; }

/* ---------------- events ---------------- */

$('#btn-connect').onclick = () => connect();
$('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('#btn-menu').onclick = openDrawer;
document.querySelectorAll('#drawer [data-close]').forEach((elm) => { elm.onclick = closeDrawer; });
$('#btn-settings').onclick = () => { closeDrawer(); showSetup(); };
$('#btn-set-default').onclick = () => {
  config.defaultLeagueId = config.leagueId;
  config.defaultSeason = config.season;
  config.defaultWeek = config.week;
  config.defaultMode = config.mode;
  config.defaultDelayMinutes = config.delayMinutes;
  store.saveConfig(config);
  flashSaved('Default set');
  renderDefaultHint();
};
$('#week-select').onchange = (e) => { config.week = Number(e.target.value); store.saveConfig(config); loadWeek(); };
$('#delay-select').onchange = (e) => { config.delayMinutes = Number(e.target.value); store.saveConfig(config); render(); };
document.querySelectorAll('.mode-switch button').forEach((b) => {
  b.onclick = () => { config.mode = b.dataset.mode; store.saveConfig(config); render(); };
});
document.querySelectorAll('.bottom-nav button').forEach((b) => {
  b.onclick = () => { activeTab = b.dataset.tab; render(); };
});
document.querySelectorAll('#mode-choices button').forEach((b) => {
  b.onclick = () => { config.mode = b.dataset.mode; updateModeChoiceUI(); };
});
$('#mode-delay-select').onchange = (e) => { config.delayMinutes = Number(e.target.value); };
$('#btn-mode-confirm').onclick = () => {
  config.modeConfirmed = true;
  store.saveConfig(config);
  if (data) render(); else loadWeek();
};

function enterMain() {
  $('#view-setup').hidden = true;
  if (!config.modeConfirmed) { showModeChoice(); return; }
  loadWeek();
}

// A saved global default opens straight into that league + season + mode.
if (config.userId && config.defaultLeagueId && config.defaultSeason) {
  config.leagueId = config.defaultLeagueId;
  config.season = config.defaultSeason;
  config.week = config.defaultWeek || config.week || 1;
  config.mode = config.defaultMode || config.mode;
  if (config.defaultDelayMinutes) config.delayMinutes = config.defaultDelayMinutes;
  config.modeConfirmed = true;
  enterMain();
} else if (config.userId && config.leagueId && config.season && config.week) {
  enterMain();
} else {
  showSetup();
  connect(config.username);
}
