/* Fourth and Goalda Meir — Plancy Champions 2025
   Static, data-driven story deck. Scores reconcile to season.seed.json; never fabricated. */
const BENCH = new Set(["bn","be","bench","ir","taxi","res","reserve","na",""]);
const MY = "alastairl";
const TEAMFIX = { WAS:"WSH", JAC:"JAX", LA:"LAR", OAK:"LV", LVR:"LV", GNB:"GB", KAN:"KC", NWE:"NE", NOR:"NO", SFO:"SF", TAM:"TB", ARZ:"ARI" };
const LOGO = "assets/logo.png";
const LOGO_SM = "assets/logo_sm.png";
const norm = s => String(s ?? "").trim().toLowerCase();
const round2 = n => Math.round(n * 100) / 100;
const fmt = n => Number(n).toFixed(2);
let STATE = { seed: null, rows: [], slots: null, comm: null, trades: null };

async function readText(names) {
  if (window.fs && window.fs.readFile) for (const n of names) { try { return await window.fs.readFile(n, { encoding: "utf8" }); } catch (_) {} }
  for (const n of names) { try { const r = await fetch(n); if (r.ok) return await r.text(); } catch (_) {} }
  throw new Error("not found");
}
const readJSON = async n => JSON.parse(await readText(n));
const parseCSV = t => Papa.parse(t, { header: true, dynamicTyping: true, skipEmptyLines: true }).data
  .filter(r => r && r.Owner != null && r.Week != null)
  .map(r => ({ owner: norm(r.Owner), week: +r.Week, player: r.Player, pos: (r.Position||"").toString().toUpperCase(),
    nfl: (r.NFL||"").toString().toUpperCase(), slot: norm(r.Fantasy), pts: +r.Points || 0 }));

async function load() {
  STATE.seed = await readJSON(["data/season.seed.json", "season.seed.json"]);
  try { STATE.rows = parseCSV(await readText(["data/all-weeks.csv", "all-weeks.csv", "all weeks data.csv"])); } catch (_) {}
  try { STATE.slots = await readJSON(["data/nfl-slots.json", "nfl-slots.json"]); } catch (_) {}
  try { STATE.comm = await readJSON(["data/commentary.json", "commentary.json"]); } catch (_) {}
  try { STATE.trades = await readJSON(["data/trades.json", "trades.json"]); } catch (_) {}
  rerender(); confetti(); mountSettings();
}
function rerender() { render(build()); wireDots(); }

const weekSum = (owner, wk, starters) => STATE.rows.filter(r => r.owner===owner && r.week===wk && (!starters||!BENCH.has(r.slot))).reduce((s,r)=>s+r.pts,0);
const topPlayers = (owner, wk, starters, n=4) => STATE.rows.filter(r => r.owner===owner && r.week===wk && (!starters||!BENCH.has(r.slot)))
  .sort((a,b)=>b.pts-a.pts).slice(0,n).map(r=>({player:r.player,pos:r.pos,pts:round2(r.pts)}));
const benchHero = (owner, wk) => { const b = STATE.rows.filter(r => r.owner===owner && r.week===wk && BENCH.has(r.slot)).sort((a,b)=>b.pts-a.pts)[0];
  return b ? { player:b.player, pos:b.pos, pts:round2(b.pts) } : null; };

function timelineFor(wk, opp, starters) {
  if (!STATE.slots || !STATE.slots[wk]) return null;
  const teams = STATE.slots[wk], fix = ab => TEAMFIX[ab] || ab;
  const collect = owner => { const byTime = {}; let unknown = 0;
    STATE.rows.filter(r=>r.owner===owner&&r.week===wk&&(!starters||!BENCH.has(r.slot)))
      .forEach(r=>{ const t=teams[fix(r.nfl)]; if(t) byTime[t]=(byTime[t]||0)+r.pts; else unknown+=r.pts; });
    return { byTime, unknown }; };
  const A = collect(MY), B = collect(opp);
  const times = [...new Set([...Object.keys(A.byTime), ...Object.keys(B.byTime)])].sort();
  if (times.length < 2) return null;
  let ca=0, cb=0;
  const pts = times.map(t => { ca+=A.byTime[t]||0; cb+=B.byTime[t]||0; return { label: slotLabel(t), me: round2(ca), them: round2(cb) }; });
  if (A.unknown || B.unknown) { ca+=A.unknown; cb+=B.unknown; pts.push({ label:"Final", me:round2(ca), them:round2(cb) }); }
  return pts;
}
function slotLabel(iso) {
  const d = new Date(iso);
  const wd = d.toLocaleString("en-US",{weekday:"short",timeZone:"America/New_York"});
  const hr = +d.toLocaleString("en-US",{hour:"2-digit",hour12:false,timeZone:"America/New_York"});
  if (wd==="Thu") return "Thu"; if (wd==="Mon") return "Mon"; if (wd==="Sat") return "Sat";
  if (wd==="Sun") return hr<15 ? "Sun early" : hr<19 ? "Sun late" : "Sun night"; return wd;
}
function narrative(tl) {
  if (!tl || tl.length<2) return "";
  const lead = tl.map(p=>p.me===p.them?0:(p.me>p.them?1:-1));
  const end = lead[lead.length-1], first = lead.find(v=>v!==0)||0;
  const changes = lead.filter((v,i)=>i&&v!==lead[i-1]&&v!==0).length;
  if (end>0 && lead.every(v=>v>=0)) return "Led wire-to-wire.";
  if (end>0 && first<0) return "Came from behind to win it.";
  if (end<0 && lead.every(v=>v<=0)) return "Behind from the first whistle.";
  if (changes>=2) return "A genuine back-and-forth.";
  return "";
}

function build() {
  const { seed, rows, comm } = STATE, hasCSV = rows.length > 0;
  let starters = true;
  if (hasCSV) {
    const score = only => seed.matches.reduce((a,m)=>a+(Math.abs(weekSum(MY,m.week,only)-m.mine)<0.5?1:0),0);
    starters = score(true) >= score(false);
  }
  const matches = seed.matches.map(m => {
    let { mine, them } = m, topMe=null, topOpp=null, bench=null, drawer=null, tl=null;
    const oh = m.handle.toLowerCase();
    if (hasCSV) {
      const cm = weekSum(MY,m.week,starters), co = weekSum(oh,m.week,starters);
      if (cm>0){ mine=round2(cm); topMe=topPlayers(MY,m.week,starters); bench=round2(weekSum(MY,m.week,false)-cm); drawer=benchHero(MY,m.week); }
      if (co>0){ them=round2(co); topOpp=topPlayers(oh,m.week,starters); }
      tl = timelineFor(m.week, oh, starters);
    }
    const commentary = (comm && comm[m.week]) || m.commentary;
    return { ...m, mine, them, topMe, topOpp, bench, drawer, tl, story: narrative(tl), commentary };
  });
  const wins = matches.filter(m=>m.mine>m.them).length, tot = matches.reduce((s,m)=>s+m.mine,0);
  // total points the Drawer cost us across the year (the running gag, but real)
  const drawerTotal = round2(matches.reduce((s,m)=>s+(m.drawer?m.drawer.pts:0),0));
  const stats = { wins, losses: matches.length-wins, totalPoints: round2(tot), avg: round2(tot/matches.length),
    high: Math.max(...matches.map(m=>m.mine)), bestMargin: round2(Math.max(...matches.map(m=>m.mine-m.them))), drawerTotal };
  return { ...seed, matches, stats, trades: STATE.trades };
}

function panel(html, opts={}) {
  const s = document.createElement("section"); s.className = "panel " + (opts.cls||"");
  s.innerHTML = `<div class="bg"></div><div class="scrim"></div><div class="content">${html}</div>` + (opts.hint?`<div class="hint">swipe up</div>`:"");
  return s;
}
let MATCHCACHE = [];
function render(d) {
  const deck = document.getElementById("deck"); deck.innerHTML = ""; MATCHCACHE = d.matches;
  const s = d.stats;

  // HOME — Plancy champion banter, no verified badge
  deck.appendChild(panel(`<div class="eyebrow">${d.league} · ${d.season}</div>
    <img class="crest" src="${LOGO}" alt="Fourth and Goalda Meir crest"/>
    <h1 class="bigname">Fourth &amp;<br>Goalda Meir</h1>
    <div class="plancy"><span class="pill">Plancy Champion</span><span class="pill ghost">Plancy Positive</span></div>
    <p class="tag">Fourth and goal, every week. We went for it. We are, and shall remain, <b>plancy positive</b>.</p>`, { hint:true, cls:"home" }));

  // STATS
  deck.appendChild(panel(`<div class="panel-title">The Season in Numbers</div><div class="stat-grid">
    <div class="stat"><div class="n g">${s.wins}</div><div class="l">Wins</div></div>
    <div class="stat"><div class="n r">${s.losses}</div><div class="l">Losses</div></div>
    <div class="stat"><div class="n">${s.totalPoints.toFixed(1)}</div><div class="l">Total Points</div></div>
    <div class="stat"><div class="n">${s.avg}</div><div class="l">Avg / Week</div></div>
    <div class="stat"><div class="n">${fmt(s.high)}</div><div class="l">High Score</div></div>
    <div class="stat"><div class="n">+${fmt(s.bestMargin)}</div><div class="l">Best Margin</div></div></div>
    ${s.drawerTotal?`<div class="drawer-tot">Points stranded in <b>The Fields Drawer</b> across the season: <b>${fmt(s.drawerTotal)}</b>. We benched him every week. We won the title. No further questions.</div>`:``}`));

  // REGULAR SEASON
  d.matches.filter(m=>!m.playoff).forEach((m)=>deck.appendChild(matchPanel(m, d.matches.indexOf(m))));

  // BYE
  deck.appendChild(panel(`<div class="bye"><div class="icon">🛋️</div>
    <div class="bigname" style="font-size:clamp(32px,9vw,56px)">Week ${d.playoffStart}</div>
    <div class="subline">First-Round Bye · Earned</div>
    <p class="m-report" style="text-align:center;margin-top:20px">Top-two seed, week off. While the rest of the league bled through the wild card round, we put our feet up, polished the crest, and let them tire each other out. This is what the regular season is <em>for</em>.</p></div>`));

  // PLAYOFFS
  d.matches.filter(m=>m.playoff).forEach((m)=>deck.appendChild(matchPanel(m, d.matches.indexOf(m))));

  // TRADES (only when present)
  if (d.trades && d.trades.length) deck.appendChild(tradesPanel(d.trades));

  // FINALE: celebration + champions (merch SVGs removed — real photos slot in via celebrationPanel)
  deck.appendChild(celebrationPanel());
  deck.appendChild(panel(`<div class="finale-hero">
    <img class="crest big" src="${LOGO}" alt="crest"/>
    <h1 class="bigname">2025<br>Champions</h1>
    <div class="plancy"><span class="pill">Borehamwood Plancy League</span></div>
    <p class="tag">The throne stays in Borehamwood.<br><b>Plancy positive. Forever.</b></p>
    <div class="finale-badge"><span>EST. 2025 · PLANCY CHAMPIONS</span></div>
    </div>`, { cls:"finale" }));
}

function perf(title, list) {
  if (!list || !list.length) return "";
  return `<div class="perf"><div class="perf-h">${title}</div>${list.map((p,i)=>
    `<div class="perf-row"><span class="perf-rank">${i+1}</span><span class="perf-name">${p.player||"—"} <em>${p.pos||""}</em></span><span class="perf-pts">${fmt(p.pts)}</span></div>`).join("")}</div>`;
}
function sparkline(tl) {
  if (!tl) return "";
  const W=300,H=64,pad=4, max=Math.max(...tl.flatMap(p=>[p.me,p.them]),1);
  const x=i=>pad+(i/Math.max(tl.length-1,1))*(W-2*pad), y=v=>H-pad-(v/max)*(H-2*pad);
  const ln=k=>tl.map((p,i)=>`${i?"L":"M"}${x(i).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(" ");
  return `<div class="spark-wrap"><div class="spark-legend"><span><i class="dot-me"></i>Goalda Meir</span><span><i class="dot-them"></i>Opponent</span></div>
    <svg class="spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      <path d="${ln("them")}" fill="none" stroke="#7FA3AD" stroke-width="2"/>
      <path d="${ln("me")}" fill="none" stroke="#C8A951" stroke-width="2.5"/></svg>
    <div class="spark-x">${tl.map(p=>`<span>${p.label}</span>`).join("")}</div></div>`;
}
function matchPanel(m, idx) {
  const won=m.mine>m.them, diff=Math.abs(m.mine-m.them).toFixed(2);
  return panel(`<div class="m-week ${m.playoff?"po":""}">${m.playoff?(m.week===STATE.seed.matches[STATE.seed.matches.length-1].week?"Championship · ":"Playoff · "):""}Week ${m.week}</div>
    <div class="m-result ${won?"w":"l"}">${won?"Win":"Loss"}</div>
    <div class="m-score"><div class="m-side me"><div class="t">Goalda Meir</div><div class="p ${won?"win gold":"lose"}">${fmt(m.mine)}</div></div>
      <div class="m-sep">–</div><div class="m-side them"><div class="t">${m.opp}</div><div class="p ${won?"lose":"win"}">${fmt(m.them)}</div></div></div>
    ${m.tl?sparkline(m.tl):""}${m.story?`<div class="story">${m.story}</div>`:""}
    <p class="m-report">${m.commentary || (won?`A ${diff}-point win over ${m.opp}.`:`Beaten by ${m.opp} by ${diff}.`)}</p>
    ${m.decision?`<div class="callout decision"><div class="callout-h">Starting Decisions</div><p>${m.decision}</p></div>`:``}
    ${m.drawer?`<div class="callout drawer"><div class="callout-h">Benchwatch · The Drawer</div><p>Highest-scoring player we left on the bench: <b>${m.drawer.player}</b> <em>${m.drawer.pos}</em> — <b>${fmt(m.drawer.pts)}</b>.${m.bench!=null?` Total points stranded on the pine: <b>${fmt(m.bench)}</b>.`:``}</p></div>`:``}
    <div class="perf-wrap">${perf("Our top scorers",m.topMe)}${perf(m.opp+" top scorers",m.topOpp)}</div>`, { cls:"match" });
}
function tradesPanel(trades) {
  const mine = STATE.seed.champion;
  return panel(`<div class="panel-title">Deadline Moves</div>
    <div class="trades">${trades.map(t=>`<div class="trade ${t.parties&&t.parties.includes(mine)?"mine":""}">
      <div class="trade-wk">Week ${t.week}</div><div class="trade-sum">${t.summary||(t.parties||[]).join(" ↔ ")}</div></div>`).join("")}</div>
    <p class="m-report" style="text-align:center;margin-top:14px;color:var(--muted)">Every deal that shaped the season. Some of you are still paying these off.</p>`);
}

/* ---------- MERCH / CELEBRATION ---------- */
function logoOn(art, cls="") { return `<div class="merch-art ${cls}">${art}<img class="merch-logo" src="${LOGO_SM}" alt=""/></div>`; }
const TEE = `<svg viewBox="0 0 200 210"><path d="M64,28 L84,18 Q100,30 116,18 L136,28 L172,52 L156,80 L140,68 L140,198 L60,198 L60,68 L44,80 L28,52 Z" fill="#2C6A78" stroke="#0A1622" stroke-width="3"/><path d="M84,18 Q100,30 116,18" fill="none" stroke="#0A1622" stroke-width="3"/></svg>`;
const HOODIE = `<svg viewBox="0 0 200 210"><path d="M58,40 Q78,26 100,40 Q122,26 142,40 L176,64 L160,90 L144,78 L144,200 L56,200 L56,78 L40,90 L24,64 Z" fill="#21505C" stroke="#0A1622" stroke-width="3"/><path d="M72,42 Q100,16 128,42 Q100,60 72,42 Z" fill="#0E2A31" stroke="#0A1622" stroke-width="2"/><path d="M100,60 L100,98" stroke="#0A1622" stroke-width="3"/></svg>`;
const CAP = `<svg viewBox="0 0 200 170"><path d="M34,120 Q34,50 100,50 Q166,50 166,120 Z" fill="#2C6A78" stroke="#0A1622" stroke-width="3"/><path d="M150,120 Q192,122 198,144 L150,134 Z" fill="#1B454F" stroke="#0A1622" stroke-width="3"/><circle cx="100" cy="54" r="6" fill="#1B454F"/></svg>`;
const PENNANT = `<svg viewBox="0 0 210 130"><path d="M10,18 L200,58 L10,98 Z" fill="#C8A951" stroke="#0A1622" stroke-width="3"/><rect x="6" y="10" width="8" height="110" rx="3" fill="#21505C"/></svg>`;
const ICON = `<svg viewBox="0 0 200 200"><rect x="14" y="14" width="172" height="172" rx="40" fill="#0E2A31" stroke="#C8A951" stroke-width="3"/></svg>`;
const STICKER = `<svg viewBox="0 0 200 200"><circle cx="100" cy="100" r="86" fill="#EFE5CF" stroke="#C8A951" stroke-width="4"/><circle cx="100" cy="100" r="86" fill="none" stroke="#0A1622" stroke-width="2" stroke-dasharray="3 6"/></svg>`;

function merchPanel() {
  const items = [
    [logoOn(TEE,"tee"), "Home Tee", "Teal · crest front"],
    [logoOn(HOODIE,"hoodie"), "Champions Hoodie", "Matchday issue"],
    [logoOn(CAP,"cap"), "Sideline Cap", "Structured · gold trim"],
    [logoOn(ICON,"icon"), "App Icon", "Add to home screen"],
    [logoOn(STICKER,"sticker"), "Crest Sticker", "Laptop / water bottle"],
    [logoOn(PENNANT,"pennant"), "Wall Pennant", "For the trophy room"],
  ];
  return panel(`<div class="panel-title">The Collection</div>
    <p class="merch-intro">Official Fourth &amp; Goalda Meir merchandise. Everything generated from the one true crest.</p>
    <div class="merch-grid">${items.map(([art,name,sub])=>
      `<div class="merch">${art}<div class="merch-name">${name}</div><div class="merch-sub">${sub}</div></div>`).join("")}</div>`, { cls:"merch-panel" });
}

function celebrationPanel() {
  // four equal-sized celebration tiles using the real logo
  const bigLogo = `<div class="cele-tile tile-champion">
    <img class="tile-logo" src="${LOGO}" alt="Fourth and Goalda Meir"/>
    <div class="tile-label">Plancy Champions 2025</div>
  </div>`;
  const smLogoA = `<div class="cele-tile tile-gold">
    <img class="tile-logo-sm" src="${LOGO_SM}" alt=""/>
    <div class="tile-label">11 — 5</div>
    <div class="tile-sub">Final record</div>
  </div>`;
  const smLogoB = `<div class="cele-tile tile-teal">
    <img class="tile-logo-sm" src="${LOGO_SM}" alt=""/>
    <div class="tile-label">Est. 2025</div>
    <div class="tile-sub">Plancy Positive</div>
  </div>`;
  const ringTile = `<div class="cele-tile tile-ring">
    <div class="ring-band"><span>🏆</span></div>
    <div class="tile-label">MMXXV</div>
    <div class="tile-sub">Borehamwood</div>
  </div>`;
  return panel(`<div class="panel-title">The Celebration</div>
    <div class="cele-mosaic">${bigLogo}${smLogoA}${smLogoB}${ringTile}</div>
    <div class="cele-row">
      <img class="cele-banner-logo" src="${LOGO}" alt=""/>
      <div class="cele-banner-text"><div class="cele-banner-big">PLANCY POSITIVE</div><div class="cele-banner-small">Borehamwood Plancy League · Champions · 2025</div></div>
    </div>`, { cls:"merch-panel cele-panel" });
}

/* ---------- chrome ---------- */
function mountSettings() {
  const cog = document.getElementById("cog"), modal = document.getElementById("settings"),
        close = document.getElementById("closeSettings"), input = document.getElementById("fileinput");
  const open = () => { modal.hidden = false; }, shut = () => { modal.hidden = true; };
  cog.addEventListener("click", open);
  close.addEventListener("click", shut);
  modal.addEventListener("click", e => { if (e.target === modal) shut(); });
  input.addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    if (f.name.endsWith(".csv")) STATE.rows = parseCSV(text);
    else { const j = JSON.parse(text); if (Array.isArray(j)) STATE.trades = j; else if (j.matches) STATE.seed = j; else STATE.comm = j; }
    rerender(); shut();
  });
}
function wireDots() {
  const panels = [...document.querySelectorAll(".panel")], dots = document.getElementById("dots");
  dots.innerHTML = panels.map(()=>"<b></b>").join(""); const marks = [...dots.children];
  const io = new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ const i=panels.indexOf(e.target); marks.forEach((d,j)=>d.classList.toggle("on",j===i)); }}),{threshold:.6});
  panels.forEach(p=>io.observe(p));
}
function confetti() {
  // Subtle field-turf shimmer — small gold/teal specks drifting up like stadium dust
  const cv=document.getElementById("fx"),ctx=cv.getContext("2d");
  const rs=()=>{cv.width=innerWidth;cv.height=innerHeight;};rs();addEventListener("resize",rs);
  const cols=["rgba(200,169,81,.55)","rgba(95,184,203,.45)","rgba(239,229,207,.35)","rgba(62,150,168,.4)"];
  const ps=Array.from({length:40},()=>({
    x:Math.random()*innerWidth, y:Math.random()*innerHeight,
    r:Math.random()*2+1, spd:Math.random()*.4+.15,
    c:cols[~~(Math.random()*cols.length)], a:Math.random()*Math.PI*2
  }));
  (function loop(){
    ctx.clearRect(0,0,cv.width,cv.height);
    ps.forEach(p=>{
      p.a+=.008; p.y-=p.spd;
      if(p.y<-8){p.y=cv.height+8;p.x=Math.random()*cv.width;}
      const drift=Math.sin(p.a)*3;
      ctx.beginPath();ctx.arc(p.x+drift,p.y,p.r,0,Math.PI*2);
      ctx.fillStyle=p.c;ctx.fill();
    });
    requestAnimationFrame(loop);
  })();
}
load();
