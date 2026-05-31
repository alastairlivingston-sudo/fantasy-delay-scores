const BENCH = new Set(["bn","be","bench","ir","taxi","res","reserve","na",""]);
const MY = "alastairl";
const TEAMFIX = { WAS:"WSH", JAC:"JAX", LA:"LAR", OAK:"LV", LVR:"LV", GNB:"GB", KAN:"KC", NWE:"NE", NOR:"NO", SFO:"SF", TAM:"TB", ARZ:"ARI" };
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
  rerender(); confetti(); wireUpload();
}
function rerender() { render(build()); wireDots(); }

const weekSum = (owner, wk, starters) => STATE.rows.filter(r => r.owner===owner && r.week===wk && (!starters||!BENCH.has(r.slot))).reduce((s,r)=>s+r.pts,0);
const topPlayers = (owner, wk, starters, n=4) => STATE.rows.filter(r => r.owner===owner && r.week===wk && (!starters||!BENCH.has(r.slot)))
  .sort((a,b)=>b.pts-a.pts).slice(0,n).map(r=>({player:r.player,pos:r.pos,pts:round2(r.pts)}));

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
  let starters = true, verified = false;
  if (hasCSV) {
    const score = only => seed.matches.reduce((a,m)=>a+(Math.abs(weekSum(MY,m.week,only)-m.mine)<0.5?1:0),0);
    const sOnly = score(true), sAll = score(false);
    starters = sOnly >= sAll; verified = Math.max(sOnly,sAll) >= seed.matches.length-1;
  }
  const matches = seed.matches.map(m => {
    let { mine, them } = m, topMe=null, topOpp=null, bench=null, tl=null;
    const oh = m.handle.toLowerCase();
    if (hasCSV) {
      const cm = weekSum(MY,m.week,starters), co = weekSum(oh,m.week,starters);
      if (cm>0){ mine=round2(cm); topMe=topPlayers(MY,m.week,starters); bench=round2(weekSum(MY,m.week,false)-cm); }
      if (co>0){ them=round2(co); topOpp=topPlayers(oh,m.week,starters); }
      tl = timelineFor(m.week, oh, starters);
    }
    const commentary = (comm && comm[m.week]) || m.commentary;
    return { ...m, mine, them, topMe, topOpp, bench, tl, story: narrative(tl), commentary };
  });
  const wins = matches.filter(m=>m.mine>m.them).length, tot = matches.reduce((s,m)=>s+m.mine,0);
  const stats = { wins, losses: matches.length-wins, totalPoints: round2(tot), avg: round2(tot/matches.length),
    high: Math.max(...matches.map(m=>m.mine)), bestMargin: round2(Math.max(...matches.map(m=>m.mine-m.them))) };
  return { ...seed, matches, stats, verified, trades: STATE.trades };
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
  deck.appendChild(panel(`<div class="eyebrow">${d.league} · ${d.season}</div><span class="trophy">🏆</span>
    <h1 class="bigname">Fourth &amp;<br>Goalda Meir</h1><div class="subline">Champions</div>
    ${d.verified?`<div class="verified">verified from full player data</div>`:``}`, { hint:true }));
  deck.appendChild(panel(`<div class="panel-title">The Season in Numbers</div><div class="stat-grid">
    <div class="stat"><div class="n g">${s.wins}</div><div class="l">Wins</div></div>
    <div class="stat"><div class="n r">${s.losses}</div><div class="l">Losses</div></div>
    <div class="stat"><div class="n">${s.totalPoints.toFixed(1)}</div><div class="l">Total Points</div></div>
    <div class="stat"><div class="n">${s.avg}</div><div class="l">Avg / Week</div></div>
    <div class="stat"><div class="n">${fmt(s.high)}</div><div class="l">High Score</div></div>
    <div class="stat"><div class="n">+${fmt(s.bestMargin)}</div><div class="l">Best Margin</div></div></div>`));
  d.matches.filter(m=>!m.playoff).forEach((m)=>deck.appendChild(matchPanel(m, d.matches.indexOf(m))));
  deck.appendChild(panel(`<div class="bye"><div class="icon">🛋️</div>
    <div class="bigname" style="font-size:clamp(32px,9vw,56px)">Week ${d.playoffStart}</div>
    <div class="subline">First-Round Bye · Earned</div>
    <p class="m-report" style="text-align:center;margin-top:20px">Top seeding. While the league fought through Round 1, we rested and prepared.</p></div>`));
  d.matches.filter(m=>m.playoff).forEach((m)=>deck.appendChild(matchPanel(m, d.matches.indexOf(m))));
  if (d.trades && d.trades.length) deck.appendChild(tradesPanel(d.trades));
  deck.appendChild(panel(`<div style="text-align:center"><span class="trophy">🏆</span>
    <h1 class="bigname">2025<br>Champions</h1><div class="subline">Borehamwood Plancy League</div>
    <button class="cta" onclick="shareIt()">Share the Glory</button></div>`, { cls:"finale" }));
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
      <path d="${ln("them")}" fill="none" stroke="#5A7080" stroke-width="2"/>
      <path d="${ln("me")}" fill="none" stroke="#C8A951" stroke-width="2.5"/></svg>
    <div class="spark-x">${tl.map(p=>`<span>${p.label}</span>`).join("")}</div></div>`;
}

function matchPanel(m, idx) {
  const won=m.mine>m.them, diff=Math.abs(m.mine-m.them).toFixed(2);
  return panel(`<div class="m-week ${m.playoff?"po":""}">${m.playoff?"Playoff · ":""}Week ${m.week}</div>
    <div class="m-result ${won?"w":"l"}">${won?"Win":"Loss"}</div>
    <div class="m-score"><div class="m-side me"><div class="t">Goalda Meir</div><div class="p ${won?"win gold":"lose"}">${fmt(m.mine)}</div></div>
      <div class="m-sep">–</div><div class="m-side them"><div class="t">${m.opp}</div><div class="p ${won?"lose":"win"}">${fmt(m.them)}</div></div></div>
    ${m.tl?sparkline(m.tl):""}${m.story?`<div class="story">${m.story}</div>`:""}
    <p class="m-report">${m.commentary || (won?`A ${diff}-point win over ${m.opp}.`:`Beaten by ${m.opp} by ${diff}.`)}</p>
    ${m.bench!=null?`<div class="bench-stat">Points left on your bench: <b>${fmt(m.bench)}</b></div>`:``}
    <div class="perf-wrap">${perf("Your top scorers",m.topMe)}${perf(m.opp+" top scorers",m.topOpp)}</div>
    <button class="card-btn" onclick="makeCard(${idx})">📸 Save match card</button>`, { cls:"match" });
}
function tradesPanel(trades) {
  return panel(`<div class="panel-title">Deadline Moves</div>
    <div class="trades">${trades.map(t=>`<div class="trade ${t.parties&&t.parties.includes(STATE.seed.champion)?"mine":""}">
      <div class="trade-wk">Week ${t.week}</div><div class="trade-sum">${t.summary||(t.parties||[]).join(" ↔ ")}</div></div>`).join("")}</div>
    <p class="m-report" style="text-align:center;margin-top:14px;color:#5A7080">Every deal that shaped the season.</p>`);
}

async function makeCard(idx) {
  const m = MATCHCACHE[idx], won = m.mine > m.them;
  await (document.fonts ? document.fonts.ready : Promise.resolve());
  const c = document.getElementById("cardcanvas"); c.width = 1080; c.height = 1350;
  const x = c.getContext("2d");
  x.fillStyle = "#05080D"; x.fillRect(0,0,1080,1350);
  const g = x.createRadialGradient(540,180,40,540,180,820); g.addColorStop(0,"rgba(200,169,81,.20)"); g.addColorStop(1,"transparent");
  x.fillStyle = g; x.fillRect(0,0,1080,1350); x.textAlign = "center";
  x.fillStyle = "#C8A951"; x.font = "600 30px Oswald, sans-serif"; x.fillText("BOREHAMWOOD PLANCY LEAGUE · 2025", 540, 130);
  x.fillStyle = won ? "#1DB954" : "#E53E3E"; x.font = "700 150px Oswald, sans-serif"; x.fillText(won ? "WIN" : "LOSS", 540, 330);
  x.fillStyle = "#F0F4F8"; x.font = "600 38px Oswald, sans-serif"; x.fillText((m.playoff?"PLAYOFF · ":"") + "WEEK " + m.week, 540, 400);
  x.font = "700 120px Oswald, sans-serif"; x.fillStyle = won ? "#C8A951" : "#8A9BAB"; x.textAlign = "right"; x.fillText(fmt(m.mine), 500, 600);
  x.fillStyle = "#5A7080"; x.textAlign = "center"; x.font = "400 60px Oswald, sans-serif"; x.fillText("–", 540, 590);
  x.fillStyle = won ? "#8A9BAB" : "#C8A951"; x.textAlign = "left"; x.font = "700 120px Oswald, sans-serif"; x.fillText(fmt(m.them), 580, 600);
  x.textAlign = "center"; x.fillStyle = "#8A9BAB"; x.font = "500 34px Inter, sans-serif"; x.fillText("Fourth & Goalda Meir", 360, 660); x.fillText(m.opp, 720, 660);
  if (m.story) { x.fillStyle = "#F0D070"; x.font = "600 34px Oswald, sans-serif"; x.fillText(m.story.toUpperCase(), 540, 760); }
  x.fillStyle = "#B8CCD8"; x.font = "400 36px Inter, sans-serif"; wrap(x, m.commentary || "", 540, 860, 920, 50);
  x.fillStyle = "#C8A951"; x.font = "600 26px Oswald, sans-serif"; x.fillText("🏆 2025 CHAMPIONS", 540, 1290);
  c.toBlob(b => { const file = new File([b], `golda-meir-week-${m.week}.png`, { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) navigator.share({ files: [file], title: "Match card" });
    else { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = file.name; a.click(); } });
}
function wrap(x, text, cx, cy, maxW, lh) {
  const words = String(text).split(" "); let line = "", y = cy;
  for (const w of words) { if (x.measureText(line + w).width > maxW && line) { x.fillText(line.trim(), cx, y); line = ""; y += lh; } line += w + " "; }
  x.fillText(line.trim(), cx, y);
}

function wireUpload() {
  const btn = document.getElementById("upload"), input = document.getElementById("fileinput");
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", async e => {
    const f = e.target.files[0]; if (!f) return;
    const text = await f.text();
    if (f.name.endsWith(".csv")) STATE.rows = parseCSV(text);
    else { const j = JSON.parse(text); if (Array.isArray(j)) STATE.trades = j; else if (j.matches) STATE.seed = j; else STATE.comm = j; }
    rerender(); alert(`Loaded ${f.name}. (Preview only — commit it to public/data to keep it.)`);
  });
}
function wireDots() {
  const panels = [...document.querySelectorAll(".panel")], dots = document.getElementById("dots");
  dots.innerHTML = panels.map(()=>"<b></b>").join(""); const marks = [...dots.children];
  const io = new IntersectionObserver(es=>es.forEach(e=>{ if(e.isIntersecting){ const i=panels.indexOf(e.target); marks.forEach((d,j)=>d.classList.toggle("on",j===i)); }}),{threshold:.6});
  panels.forEach(p=>io.observe(p));
}
function shareIt() {
  const t = "Fourth and Goalda Meir — 2025 Borehamwood Plancy League Champions 🏆";
  if (navigator.share) navigator.share({ title:t, url:location.href });
  else navigator.clipboard.writeText(location.href).then(()=>alert("Link copied! 🏆"));
}
document.getElementById("share").addEventListener("click", shareIt);
function confetti() {
  const cv=document.getElementById("fx"),ctx=cv.getContext("2d");
  const rs=()=>{cv.width=innerWidth;cv.height=innerHeight;};rs();addEventListener("resize",rs);
  const cols=["#C8A951","#F0D070","#1DB954","#60a5fa","#fff"];
  const ps=Array.from({length:80},()=>({x:Math.random()*innerWidth,y:Math.random()*-innerHeight,r:Math.random()*6+3,spd:Math.random()*1.1+.4,c:cols[~~(Math.random()*cols.length)],a:0}));
  (function loop(){ctx.clearRect(0,0,cv.width,cv.height);ps.forEach(p=>{p.a+=.012;p.y+=p.spd;if(p.y>cv.height+10){p.y=-10;p.x=Math.random()*cv.width;}const t=Math.sin(p.a)*10;ctx.beginPath();ctx.lineWidth=p.r*.5;ctx.strokeStyle=p.c;ctx.moveTo(p.x+t+p.r/3,p.y);ctx.lineTo(p.x+t,p.y+p.r);ctx.stroke();});requestAnimationFrame(loop);})();
}
load();
