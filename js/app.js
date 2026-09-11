// UI controller. All rendered numbers come from gate.js output (never raw).

import * as api from './api.js';
import * as store from './state.js';
import { gateMatchup, visibleSnapshots } from './gate.js';
import { mergeSnapshots } from './snapshots.js';
import { scoreProjection, winProbability } from './project.js';
import { buildFeed } from './newsflash.js';
import { startRecorder } from './recorder.js';
import { browseSeasonWeek, chooseDefaultWeek, weekOptions } from './weeks.js';
import { quotaState, spendRefresh, resetsAt, WEEKLY_REFRESH_LIMIT } from './quota.js';

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
let nflState = null; // Sleeper's /state/nfl, cached so a league switch can re-derive the week

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

// Every league on the account, newest season first, in the compact shape the
// drawer's dropdown and the setup list both render from (and that gets cached
// in config, so the dropdown is populated before any network call returns).
async function fetchLeagues(userId, nfl) {
  // In-season: only the active season's leagues exist. Off/pre-season:
  // show both the upcoming season's leagues (may be mid-draft) and last
  // season's (for browsing), since a brand-new league only exists in one.
  const currentSeason = Number(nfl.season);
  const seasons = nfl.season_type === 'regular' || nfl.season_type === 'post'
    ? [currentSeason]
    : [currentSeason, Number(nfl.previous_season)];
  const lists = await Promise.all(seasons.map((s) => api.getLeagues(userId, s)));
  return lists.flat()
    .sort((a, b) => Number(b.season) - Number(a.season) || a.name.localeCompare(b.name))
    .map((lg) => ({
      id: lg.league_id, name: lg.name, season: Number(lg.season), teams: lg.total_rosters,
    }));
}

// Open a league. The week carries over between leagues in the same season
// (they share the NFL calendar) and is re-derived only when the season changes.
function selectLeague(lg, { pickMode = false } = {}) {
  config.leagueId = lg.id;
  if (lg.season !== config.season || !config.week) {
    config.season = lg.season;
    config.week = nflState ? weekForSeason(nflState, lg.season) : 1;
  }
  if (pickMode) config.modeConfirmed = false;
  store.saveConfig(config);
  enterMain();
}

async function connect(usernameArg) {
  const username = (usernameArg ?? $('#username').value).trim();
  if (!username) return;
  showLoading(true);
  $('#setup-error').hidden = true;
  try {
    const [user, nfl] = await Promise.all([api.getUser(username), api.getNflState()]);
    if (!user?.user_id) throw new Error('User not found');
    nflState = nfl;
    config.username = username;
    config.userId = user.user_id;

    const leagues = await fetchLeagues(user.user_id, nfl);
    if (!leagues.length) {
      store.saveConfig(config);
      return fail(`No leagues found for ${username}.`);
    }
    config.leagues = leagues;
    store.saveConfig(config);

    const list = $('#setup-leagues');
    list.replaceChildren();
    for (const lg of leagues) {
      const b = el('button');
      b.append(el('span', null, lg.name), el('span', 'meta', `${lg.teams} teams · ${lg.season}`));
      b.onclick = () => selectLeague(lg, { pickMode: true });
      list.append(b);
    }
  } catch (err) {
    fail(`Could not connect: ${err.message}`);
  } finally {
    showLoading(false);
  }
}

// Keep the drawer's league list current (a new league joined mid-season, a
// renamed one). Runs in the background after a load — a failure just leaves
// the cached list in place, so the dropdown always works offline-ish.
async function refreshLeagueList() {
  if (!config.userId || !nflState) return;
  try {
    const leagues = await fetchLeagues(config.userId, nflState);
    if (!leagues.length) return;
    config.leagues = leagues;
    store.saveConfig(config);
    renderLeagueSelect();
  } catch { /* keep the cached list */ }
}

function showSetup() {
  stopRecorder?.();
  $('#view-main').hidden = true;
  $('#view-mode').hidden = true;
  $('#view-highlights').hidden = true;
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
  $('#view-highlights').hidden = true;
  $('#view-mode').hidden = false;
  updateModeChoiceUI();
}

/* ---------------- data loading ---------------- */

async function loadWeek() {
  showLoading(true);
  try {
    const { leagueId, season, week } = config;
    const [league, rosters, users, matchups, playerMeta, games, nfl] = await Promise.all([
      api.getLeague(leagueId),
      api.getRosters(leagueId),
      api.getLeagueUsers(leagueId),
      api.getMatchups(leagueId, week),
      api.getProjections(season, week),
      api.getScoreboard(season, week),
      api.getNflState().catch(() => nflState), // only needed to re-derive a week
    ]);
    if (nfl) nflState = nfl;

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

    // Ticks made before they became shared across leagues live under a
    // per-league key; fold them in the first time we load that league+week.
    store.adoptLegacyWatched(config, season, week, leagueId);

    stopRecorder?.();
    let ticks = 0;
    stopRecorder = startRecorder({
      leagueId, season, week,
      onSnapshot: async () => {
        // Every 5th local tick (~5 min), also pull what the server has moved
        // on: recorded snapshots, game states, newly-resolved highlights.
        if (++ticks % 5 === 0) await refreshServerData();
        render();
      },
    });
    render();
    refreshLeagueList();
    autoCheckIfStale();
  } catch (err) {
    alert(`Failed to load: ${err.message}`);
    showSetup();
  } finally {
    showLoading(false);
  }
}

// Re-pull the parts of the week that move under an open tab: server-recorded
// snapshots, ESPN game states, and resolved highlight links. Without this, a
// tab left open (or a home-screen app resumed from the background) kept
// rendering whatever the initial load fetched — so a highlight the recorder
// resolved an hour ago stayed invisible until a full reload.
let refreshing = null;
function refreshServerData() {
  if (!data || refreshing) return refreshing || Promise.resolve();
  const { leagueId, season, week } = config;
  refreshing = (async () => {
    const [remote, highlights, games] = await Promise.all([
      api.getRemoteSnapshots(leagueId, season, week),
      api.getRemoteHighlights(season, week),
      api.getScoreboard(season, week).catch(() => null), // transient; keep the old list
    ]);
    // A league or week switch may have landed while these were in flight.
    if (config.leagueId !== leagueId || config.season !== season || config.week !== week) return;
    if (remote) data.remoteSnapshots = remote.snapshots;
    if (highlights) {
      data.highlights = highlights.videos || {};
      data.highlightsCheckedAt = highlights.checkedAt || null;
    }
    if (games?.length) {
      data.games = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
      data.playerGames = api.mapPlayersToGames(
        [...(data.mySide?.starters || []), ...(data.oppSide?.starters || [])],
        data.playerMeta, data.games);
    }
  })().catch(() => { /* transient network; the next tick retries */ })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/* ---------------- rendering ---------------- */

function buildCtx() {
  return {
    mode: config.mode,
    playerGames: data.playerGames,
    watched: store.watchedFor(config, config.season, config.week),
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
  $('#view-highlights').hidden = true;
  $('#view-main').hidden = false;
  $('#league-name').textContent = data.league.name;
  renderLeagueSelect();
  renderWeekSelect();
  renderModeSwitch();
  renderModeIndicator();
  renderDefaultHint();
  renderBottomNav();

  const ctx = buildCtx();
  const gated = gateMatchup(data.mySide || {}, data.oppSide || {}, ctx);
  // A league/week with no matchup for you (e.g. a season that hasn't started,
  // or a pre-draft league) has no roster to show — say so instead of rendering
  // an empty "Roster undefined · 0.00" card.
  const hasMatchup = Boolean(data.mySide || data.oppSide);
  $('#no-matchup').hidden = hasMatchup;
  $('#scorecard').hidden = !hasMatchup;
  $('#winprob').hidden = !hasMatchup;
  $('#starters').hidden = !hasMatchup;
  if (hasMatchup) {
    renderNotice(gated.me.notice);
    renderScorecard(gated);
    renderStarters(gated);
  } else {
    $('#notice').hidden = true;
    $('#no-matchup').textContent =
      `No matchup found for Week ${config.week} in ${data.league.name}. `
      + `This league may not have started for ${config.season} yet — pick another week or league from the ☰ menu.`;
  }
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

function renderLeagueSelect() {
  const sel = $('#league-select');
  const known = config.leagues || [];
  // The active league always appears, even when the cached list is stale or
  // predates it — otherwise the dropdown would name a league you aren't in.
  const options = known.some((l) => l.id === config.leagueId) ? known : [
    { id: config.leagueId, season: config.season, name: data?.league?.name || 'Current league' },
    ...known,
  ];
  const sig = options.map((l) => `${l.id}@${l.season}`).join('|');
  if (sel.dataset.sig !== sig) {
    sel.replaceChildren();
    for (const l of options) sel.append(new Option(`${l.name} · ${l.season}`, l.id));
    sel.dataset.sig = sig;
  }
  sel.value = String(config.leagueId);
  $('#league-hint').textContent = options.length > 1
    ? 'Switch any time — your week and spoiler mode carry over.'
    : 'The only league on this Sleeper account.';
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
  // One side can have fewer starters than the other — a bye week, an
  // odd-sized league, or no opponent assigned for the week yet. Render a blank
  // cell for the missing slot: reading p.pid here used to throw, which took
  // the whole view down with a "Failed to load" alert.
  if (!p) {
    d.append(el('div', 'n', '—'), el('div', 'g hidden-pts', 'no opponent'));
    return d;
  }
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

// A starter's points cell. "0.0" and "yet to play" are both zero but mean
// opposite things when you're scanning a roster, so a player whose game hasn't
// kicked off reads "—" instead. Once the game is live, 0.0 is a real 0.0.
// (In delay mode "pre" is the state as of your delayed snapshot, so this stays
// spoiler-safe: it can only ever under-report how far along a player is.)
function pointsText(p) {
  if (!p) return '';
  if (!p.visible) return '••';
  return p.state === 'pre' ? '—' : p.points.toFixed(1);
}

function pointsClass(p) {
  if (!p?.visible) return 'hidden-pts';
  return p.state === 'pre' ? 'to-play' : 'mine';
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
    pts.append(el('span', pointsClass(mine), pointsText(mine)),
      el('span', 'hidden-pts', ' · '),
      el('span', pointsClass(theirs), pointsText(theirs)));
    const slot = el('div', 'slot', data.slots[i] || 'FLX');
    row.prepend(slot);
    row.append(pts, playerCell(theirs, data.playerMeta[theirs?.pid], true));
    wrap.append(row);
  }
}

function relativeTime(when) {
  const mins = Math.round((Date.now() - new Date(when).getTime()) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  if (mins < 60 * 36) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (60 * 24))}d ago`;
}

// How long ago the recorder last looked for this week's highlights. It has to
// carry its AGE, not just a clock time: a stalled recorder rendered as
// "09:17 AM" reads exactly like this morning even when it's two days old.
const STALE_CHECK_MS = 3 * 60 * 60_000;

function renderChecked(node, when) {
  if (!when) {
    node.textContent = `Highlights haven’t been checked for this week yet.${quotaSuffix()}`;
    node.classList.remove('stale');
    return;
  }
  const d = new Date(when);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const stamp = d.toDateString() === new Date().toDateString() ? time
    : `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })}, ${time}`;
  node.textContent = `Highlights last checked: ${stamp} (${relativeTime(when)})${quotaSuffix()}`;
  node.classList.toggle('stale', Date.now() - d.getTime() > STALE_CHECK_MS);
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

// A game card's spoiler-safe info line: kickoff time (never a score) · matchup,
// plus a tiny live/final status tag so you can tell what's on without a
// scoreline. Shared by the league Games tab and the standalone Highlights view.
function gameCardBase(g) {
  const card = el('div', 'game');
  const info = el('div', 'info');
  const kickoff = new Date(g.date).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' });
  const tag = g.state === 'post' ? 'Final' : g.state === 'in' ? 'Live' : '';
  const line = el('div', 'matchup-name');
  line.append(el('span', 'kick', kickoff), el('span', null, ` · ${g.away} @ ${g.home}`));
  if (tag) line.append(el('span', `tag ${g.state}`, tag));
  info.append(line);
  card.append(info);
  return card;
}

// The highlight affordance for a game. Only a resolver-confirmed, full-length
// official upload is ever linked (never a live search — its results page can
// itself show a score); otherwise a non-clickable placeholder.
function highlightEl(g, video) {
  if (video) {
    const a = el('a', 'yt', '▶ Highlights');
    a.title = `Posted ${relativeTime(video.publishedAt)}`;
    a.href = `https://www.youtube.com/watch?v=${video.id}`;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  const label = g.state === 'post' ? 'No highlight yet' : '—';
  return el('span', 'yt pending', label);
}

function renderGames() {
  $('#games-hint').textContent = config.mode === 'watched'
    ? 'Tick a game once you’ve watched it — its players then count in your matchup.'
    : 'Only a confirmed, full-length official NFL highlight is ever linked — never a live search, to avoid spoiling the score.';
  renderChecked($('#highlights-checked'), data.highlightsCheckedAt);
  renderCheckButtons();
  const list = $('#games-list');
  list.replaceChildren();
  const watched = store.watchedFor(config, config.season, config.week);

  for (const g of data.games) {
    const isWatched = Boolean(watched[g.gameKey]);
    const card = gameCardBase(g);
    if (isWatched) card.classList.add('watched');

    const toggle = el('label', 'watch-toggle');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.checked = isWatched;
    cb.onchange = () => {
      store.setWatched(config, config.season, config.week, g.gameKey, cb.checked);
      flashSaved();
      render();
    };
    toggle.append(cb, el('span', 'status', 'seen'));
    card.append(toggle);
    card.append(highlightEl(g, data.highlights[g.gameKey]));
    list.append(card);
  }
}

/* ---------------- standalone highlights view ---------------- */
// A league-free view of the week's official highlight links. Highlights are
// already league-independent — resolve-highlights.js keys them by gameKey
// across every game in a week and never clears them on rollover — so this
// needs only the ESPN scoreboard + the resolved highlights file, no matchup.

const hl = { season: null, currentWeek: null, week: null, games: [], videos: {}, checkedAt: null };

async function enterHighlights(targetWeek) {
  $('#view-setup').hidden = true;
  $('#view-mode').hidden = true;
  $('#view-main').hidden = true;
  $('#view-highlights').hidden = false;
  showLoading(true);
  $('#hl-error').hidden = true;
  try {
    // Anchor to a season + newest browsable week once; week navigation reuses it.
    if (hl.currentWeek == null) {
      const base = browseSeasonWeek(await api.getNflState());
      hl.season = base.season;
      hl.currentWeek = base.week;
    }
    // Default to the most recent week that actually has finished games, so the
    // "latest game week" never opens empty mid-week before kickoff.
    let week = targetWeek;
    if (week == null) {
      const games = await api.getScoreboard(hl.season, hl.currentWeek);
      week = chooseDefaultWeek(hl.currentWeek, games);
    }
    await loadHighlightsWeek(week);
  } catch (err) {
    $('#hl-list').replaceChildren();
    $('#hl-checked').textContent = '';
    $('#hl-error').textContent = `Couldn’t load highlights: ${err.message}`;
    $('#hl-error').hidden = false;
  } finally {
    showLoading(false);
  }
}

async function loadHighlightsWeek(week) {
  showLoading(true);
  try {
    const [games, remote] = await Promise.all([
      api.getScoreboard(hl.season, week),
      api.getRemoteHighlights(hl.season, week),
    ]);
    hl.week = week;
    hl.games = [...games].sort((a, b) => new Date(a.date) - new Date(b.date));
    hl.videos = remote?.videos || {};
    hl.checkedAt = remote?.checkedAt || null;
    renderHighlights();
    autoCheckIfStale();
  } finally {
    showLoading(false);
  }
}

function renderHighlights() {
  const sel = $('#hl-week-select');
  const opts = weekOptions(hl.currentWeek);
  if (sel.options.length !== opts.length) {
    sel.replaceChildren();
    for (const w of opts) sel.append(new Option(`Week ${w}`, w));
  }
  sel.value = String(hl.week);

  renderChecked($('#hl-checked'), hl.checkedAt);
  renderCheckButtons();

  const list = $('#hl-list');
  list.replaceChildren();
  if (!hl.games.length) {
    list.append(el('div', 'empty-state', 'No games scheduled for this week yet.'));
    return;
  }
  for (const g of hl.games) {
    const card = gameCardBase(g);
    card.append(highlightEl(g, hl.videos[g.gameKey]));
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

/* ---------------- manual highlight check ---------------- */
// The hourly resolver is the normal path; this is the "I don't want to wait an
// hour" button. It asks /api/refresh to dispatch the workflow, then polls the
// week's highlight file until its `checkedAt` moves — the workflow takes ~20s,
// so there is nothing to render synchronously.

const CHECK_POLL_MS = 4000;
const CHECK_TIMEOUT_MS = 90_000;
const CHECK_BUTTONS = ['#btn-check-highlights', '#btn-hl-check'];

let checkInFlight = false;
let checkUnavailable = false; // server said the token isn't configured

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function renderCheckButtons() {
  const q = quotaState(store.loadRefreshQuota(), WEEKLY_REFRESH_LIMIT);
  for (const sel of CHECK_BUTTONS) {
    const btn = $(sel);
    if (!btn) continue;
    btn.hidden = checkUnavailable;
    btn.disabled = checkInFlight || q.exhausted;
    btn.textContent = checkInFlight ? 'Checking…' : 'Check now';
    btn.title = q.exhausted
      ? `Weekly limit of ${q.limit} checks reached — resets ${resetsAt().toLocaleDateString([], { weekday: 'long' })}.`
      : `${q.remaining} of ${q.limit} checks left this week`;
  }
}

// Only shown once you've actually spent something, so the common case stays
// uncluttered — but the number is always one tap away in the button's tooltip.
function quotaSuffix() {
  const q = quotaState(store.loadRefreshQuota(), WEEKLY_REFRESH_LIMIT);
  if (checkUnavailable || q.used === 0) return '';
  if (q.exhausted) {
    return ` · no checks left until ${resetsAt().toLocaleDateString([], { weekday: 'long' })}`;
  }
  return ` · ${q.remaining} checks left this week`;
}

async function checkHighlightsNow({ silent = false } = {}) {
  if (checkInFlight) return;
  // A background check never interrupts with a toast; it either quietly
  // produces a highlight or quietly doesn't.
  const say = (msg) => { if (!silent) flashSaved(msg); };
  const spend = spendRefresh(store.loadRefreshQuota(), WEEKLY_REFRESH_LIMIT);
  if (!spend.ok) {
    say(`Weekly limit of ${spend.state.limit} checks reached`);
    renderCheckButtons();
    return;
  }

  const onHighlightsView = !$('#view-highlights').hidden;
  const season = onHighlightsView ? hl.season : config.season;
  const week = onHighlightsView ? hl.week : config.week;
  const before = (onHighlightsView ? hl.checkedAt : data?.highlightsCheckedAt) || 0;

  checkInFlight = true;
  renderCheckButtons();
  try {
    await api.requestHighlightCheck();
    // Charged only once the server accepts it, so a refusal is free.
    store.saveRefreshQuota(spend.stored);
    renderCheckButtons();

    const fresh = await pollForCheck(season, week, before);
    if (!fresh) {
      // Most likely the `snapshots` concurrency group is held by the Sunday
      // live recorder; the dispatch is queued, not lost.
      say('Check queued — results will appear shortly');
      return;
    }
    applyHighlights(fresh, onHighlightsView);
    const added = Object.keys(fresh.videos || {}).length;
    // A background check that actually turned something up is worth saying.
    if (!silent || added) {
      flashSaved(added
        ? `Checked — ${added} highlight${added === 1 ? '' : 's'} available`
        : 'Checked — none up yet');
    }
  } catch (err) {
    if (err.code === 'not-configured') {
      checkUnavailable = true;
      say('Manual checks aren’t set up on the server');
    } else if (err.code === 'rate-limited') {
      say('Weekly check limit reached');
    } else {
      say('Could not start a check');
    }
  } finally {
    checkInFlight = false;
    renderCheckButtons();
    if (onHighlightsView) renderHighlights(); else if (data) render();
  }
}

/* ---------------- automatic staleness check ---------------- */
// GitHub does not deliver scheduled workflows reliably on a quiet repo: the
// hourly resolver cron landed 5 times in 24 hours, at gaps of 2.5-4.6 hours
// (CLAUDE.md fact 8 — it turns out to apply to hourly crons, not just */5).
// A Thursday-night game that ends inside one of those gaps still reads
// "No highlight yet" the next morning, which is the bug this closes.
//
// So the app stops relying on the cron alone. Opening it is itself a reliable
// trigger, and now dispatches a check when — and only when — one would
// actually help: all four conditions must hold, so a routine open costs
// nothing and a stale morning open costs one check.
const AUTO_CHECK_STALE_MS = 15 * 60_000;
let lastAutoCheckAt = 0;

function finishedWithoutHighlight(games, videos) {
  return (games || []).some((g) => g.state === 'post' && !videos?.[g.gameKey]);
}

async function autoCheckIfStale() {
  if (checkInFlight || checkUnavailable) return;
  if (Date.now() - lastAutoCheckAt < AUTO_CHECK_STALE_MS) return;
  if (quotaState(store.loadRefreshQuota(), WEEKLY_REFRESH_LIMIT).exhausted) return;

  const onHighlightsView = !$('#view-highlights').hidden;
  const games = onHighlightsView ? hl.games : data?.games;
  const videos = onHighlightsView ? hl.videos : data?.highlights;
  const checkedAt = (onHighlightsView ? hl.checkedAt : data?.highlightsCheckedAt) || 0;

  // Nothing to find, or the server looked recently enough that a fresh run
  // would just hit the resolver's per-game backoff and do nothing anyway.
  if (!finishedWithoutHighlight(games, videos)) return;
  if (Date.now() - checkedAt < AUTO_CHECK_STALE_MS) return;

  lastAutoCheckAt = Date.now();
  await checkHighlightsNow({ silent: true });
}

async function pollForCheck(season, week, before) {
  const deadline = Date.now() + CHECK_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CHECK_POLL_MS);
    const body = await api.getRemoteHighlights(season, week, { fresh: true });
    if (body && (body.checkedAt || 0) > before) return body;
  }
  return null;
}

function applyHighlights(body, onHighlightsView) {
  if (onHighlightsView) {
    hl.videos = body.videos || {};
    hl.checkedAt = body.checkedAt || null;
  } else if (data) {
    data.highlights = body.videos || {};
    data.highlightsCheckedAt = body.checkedAt || null;
  }
}

/* ---------------- update check ---------------- */
// Detect when a newer build has been deployed and offer a one-tap refresh, so
// nobody has to clear their cache to update. /api/version returns the live
// deployment id; if it changes from what we booted with, a new version is out.
// (Combined with no-cache headers on the HTML/JS/CSS, the reload then actually
// picks up the new code.)

let bootVersion = null;

async function fetchVersion() {
  try {
    const res = await fetch('/api/version', { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()).version || null;
  } catch { return null; }
}

async function checkForUpdate() {
  const v = await fetchVersion();
  if (!v) return; // no version endpoint (local dev / other host) — button still refreshes manually
  if (bootVersion === null) { bootVersion = v; return; }
  if (v !== bootVersion) $('#btn-refresh').classList.add('update');
}

function startUpdateChecks() {
  checkForUpdate();
  setInterval(checkForUpdate, 5 * 60_000);
  // Hide "Check now" up front where the server can't dispatch one, rather than
  // letting the first tap be the thing that discovers it.
  api.getCheckCapability().then((cap) => {
    checkUnavailable = !cap?.configured;
    renderCheckButtons();
  });
}

// Coming back to the app (tab refocused, home-screen app resumed) is the
// moment the on-screen data is most likely to be stale — the 60s recorder
// tick is throttled or suspended while backgrounded, so nothing has been
// pulled in the meantime. Re-check both the deployed build and the week's data.
async function refreshOnResume() {
  if (document.hidden) return;
  checkForUpdate();
  if (!$('#view-highlights').hidden) {
    if (hl.week != null) await loadHighlightsWeek(hl.week).catch(() => { /* transient */ });
    autoCheckIfStale();
    return;
  }
  if (data && !$('#view-main').hidden) {
    await refreshServerData();
    render();
    autoCheckIfStale();
  }
}

/* ---------------- drawer ---------------- */

function openDrawer() { $('#drawer').hidden = false; }
function closeDrawer() { $('#drawer').hidden = true; }
function openHlDrawer() { $('#hl-drawer').hidden = false; }
function closeHlDrawer() { $('#hl-drawer').hidden = true; }

/* ---------------- routing ---------------- */
// The Highlights view has its own shareable URL (/highlights, a Vercel rewrite
// to index.html). The two views reach each other only through the menu.

function goHighlights() {
  if (location.pathname !== '/highlights') history.pushState({ view: 'highlights' }, '', '/highlights');
  enterHighlights();
}

function goApp() {
  if (location.pathname !== '/') history.pushState({ view: 'app' }, '', '/');
  $('#view-highlights').hidden = true;
  if (data) render(); else bootApp();
}

function route() {
  if (location.pathname === '/highlights') enterHighlights();
  else bootApp();
}

/* ---------------- events ---------------- */

$('#btn-connect').onclick = () => connect();
$('#username').addEventListener('keydown', (e) => { if (e.key === 'Enter') connect(); });
$('#btn-menu').onclick = openDrawer;
for (const sel of CHECK_BUTTONS) $(sel).onclick = checkHighlightsNow;
$('#btn-refresh').onclick = () => location.reload();
document.querySelectorAll('#drawer [data-close]').forEach((elm) => { elm.onclick = closeDrawer; });
$('#btn-settings').onclick = () => { closeDrawer(); showSetup(); };
$('#btn-to-highlights').onclick = () => { closeDrawer(); goHighlights(); };

// Highlights view: menu is the way back to the league app.
$('#btn-hl-menu').onclick = openHlDrawer;
$('#btn-hl-refresh').onclick = () => location.reload();
document.querySelectorAll('#hl-drawer [data-hl-close]').forEach((elm) => { elm.onclick = closeHlDrawer; });
$('#btn-hl-to-app').onclick = () => { closeHlDrawer(); goApp(); };
$('#hl-week-select').onchange = (e) => { closeHlDrawer(); loadHighlightsWeek(Number(e.target.value)); };
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
$('#league-select').onchange = (e) => {
  const lg = (config.leagues || []).find((l) => l.id === e.target.value);
  if (!lg || lg.id === config.leagueId) return;
  closeDrawer();
  selectLeague(lg);
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

// Normal (non-highlights) launch. A saved global default opens straight into
// that league + season + mode; otherwise resume the last league or show setup.
function bootApp() {
  $('#view-highlights').hidden = true;
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
}

window.addEventListener('popstate', route);
document.addEventListener('visibilitychange', refreshOnResume);
route();

startUpdateChecks();
