// Insights across saved reviews: accuracy trend, where errors happen,
// openings, and grade totals for one player.

import { GRADES } from "./review.js";

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

// Which side did this player have in this review?
function sideOf(r, name) {
  if (r.you && r.you.name.toLowerCase() === name.toLowerCase()) return r.you.color;
  if (r.white.toLowerCase() === name.toLowerCase()) return "w";
  if (r.black.toLowerCase() === name.toLowerCase()) return "b";
  return null;
}

function players(list) {
  const counts = new Map();
  for (const r of list) {
    const names = new Set([r.white, r.black]);
    if (r.you) names.add(r.you.name);
    for (const n of names) {
      if (n === "White" || n === "Black") continue;
      const key = n.toLowerCase();
      const cur = counts.get(key) || { name: n, games: 0, you: 0 };
      cur.games++;
      if (r.you && r.you.name.toLowerCase() === key) cur.you++;
      counts.set(key, cur);
    }
  }
  // Players who imported their own games come first, then the most reviewed.
  return [...counts.values()].sort((a, b) => b.you - a.you || b.games - a.games);
}

function compute(list, name) {
  const games = [];
  for (const r of list) {
    const side = sideOf(r, name);
    if (!side || !r.stats) continue;
    const acc = side === "w" ? r.accW : r.accB;
    const res = r.result === "1-0" ? (side === "w" ? "win" : "loss")
      : r.result === "0-1" ? (side === "b" ? "win" : "loss")
      : r.result === "1/2-1/2" ? "draw" : null;
    games.push({
      id: r.id,
      date: new Date(r.gameDate || r.savedAt),
      opponent: side === "w" ? r.black : r.white,
      acc, res, side,
      counts: r.stats.counts[side],
      phases: r.stats.phases[side],
      opening: r.stats.opening || "Unknown opening",
    });
  }
  games.sort((a, b) => a.date - b.date);
  const n = games.length;
  const sum = (f) => games.reduce((s, g) => s + f(g), 0);
  const withAcc = games.filter((g) => g.acc != null);
  const phaseTotals = {};
  for (const ph of ["opening", "middlegame", "endgame"]) {
    const moves = sum((g) => g.phases[ph].moves);
    const errors = sum((g) => g.phases[ph].errors);
    phaseTotals[ph] = { moves, errors, per10: moves ? (errors / moves) * 10 : null };
  }
  const openings = new Map();
  for (const g of games) {
    const o = openings.get(g.opening) || { name: g.opening, games: 0, points: 0, scored: 0, acc: [] };
    o.games++;
    if (g.res) { o.scored++; o.points += g.res === "win" ? 1 : g.res === "draw" ? 0.5 : 0; }
    if (g.acc != null) o.acc.push(g.acc);
    openings.set(g.opening, o);
  }
  const totals = {};
  for (const gr of GRADES) totals[gr.id] = sum((g) => g.counts[gr.id] || 0);
  return {
    n, games,
    wins: games.filter((g) => g.res === "win").length,
    draws: games.filter((g) => g.res === "draw").length,
    losses: games.filter((g) => g.res === "loss").length,
    avgAcc: withAcc.length ? withAcc.reduce((s, g) => s + g.acc, 0) / withAcc.length : null,
    blundersPerGame: n ? totals.blunder / n : 0,
    brilliant: totals.brilliant,
    phaseTotals,
    openings: [...openings.values()].sort((a, b) => b.games - a.games).slice(0, 6),
    totals,
  };
}

function trendChart(games, width) {
  const pts = games.filter((g) => g.acc != null);
  if (pts.length < 2) {
    return `<p class="ins-note">Review at least two games to see your accuracy over time.</p>`;
  }
  const W = Math.max(320, Math.round(width)), H = 180, L = 34, R = 12, T = 14, B = 22;
  const lo = Math.max(0, Math.floor(Math.min(...pts.map((g) => g.acc)) / 10) * 10 - 10);
  const x = (i) => L + (pts.length === 1 ? 0 : (i / (pts.length - 1)) * (W - L - R));
  const y = (v) => T + (1 - (v - lo) / (100 - lo)) * (H - T - B);
  const ticks = [];
  for (let v = lo; v <= 100; v += lo <= 50 ? 25 : 10) ticks.push(v);
  const grid = ticks.map((v) =>
    `<line class="ins-grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="ins-axis" x="${L - 6}" y="${y(v) + 4}" text-anchor="end">${v}</text>`
  ).join("");
  const d = pts.map((g, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(g.acc).toFixed(1)}`).join(" ");
  const dots = pts.map((g, i) =>
    `<g class="ins-pt" data-i="${i}"><circle class="ins-hit" cx="${x(i)}" cy="${y(g.acc)}" r="12"/><circle class="ins-dot" cx="${x(i)}" cy="${y(g.acc)}" r="4.5"/></g>`
  ).join("");
  return `<div class="ins-chart-wrap"><svg class="ins-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Accuracy over your last ${pts.length} reviewed games">${grid}<path class="ins-line" d="${d}"/>${dots}
    <text class="ins-axis" x="${L}" y="${H - 4}">Oldest</text><text class="ins-axis" x="${W - R}" y="${H - 4}" text-anchor="end">Newest</text></svg>
    <div class="ins-tip" hidden></div></div>`;
}

function phaseBars(t) {
  const max = Math.max(1, ...Object.values(t).map((p) => p.per10 || 0));
  const label = { opening: "Opening", middlegame: "Middlegame", endgame: "Endgame" };
  return Object.entries(t).map(([k, p]) => `
    <div class="ins-bar-row">
      <span class="ins-bar-label">${label[k]}</span>
      <span class="ins-bar-track">${p.per10 == null ? "" : `<span class="ins-bar" style="width:${Math.max(2, (p.per10 / max) * 100)}%"></span>`}</span>
      <span class="ins-bar-val">${p.per10 == null ? "No moves" : p.per10.toFixed(1)}</span>
    </div>`).join("");
}

export function renderInsights(root, list, { onOpen } = {}) {
  const people = players(list);
  if (!people.length) {
    root.innerHTML = `<div class="ins-empty"><h1>Insights</h1>
      <p>Review a few of your games and your trends show up here: accuracy over time, where your mistakes happen, and how your openings go.</p>
      <p>Import games by username so the site knows which side you played.</p></div>`;
    return;
  }
  const chosen = root.dataset.player && people.find((p) => p.name.toLowerCase() === root.dataset.player)
    ? root.dataset.player : people[0].name.toLowerCase();
  const person = people.find((p) => p.name.toLowerCase() === chosen);
  const s = compute(list, person.name);
  const options = people.map((p) =>
    `<option value="${esc(p.name.toLowerCase())}"${p.name.toLowerCase() === chosen ? " selected" : ""}>${esc(p.name)} (${p.games})</option>`).join("");
  const worst = Object.entries(s.phaseTotals).filter(([, p]) => p.per10 != null).sort((a, b) => b[1].per10 - a[1].per10)[0];

  root.innerHTML = `
    <div class="ins-head">
      <h1>Insights</h1>
      <label class="ins-pick">Player <select id="insPlayer">${options}</select></label>
    </div>
    <div class="ins-tiles">
      <div class="ins-tile"><span class="ins-num">${s.n}</span><span class="ins-cap">Games reviewed</span><span class="ins-sub">${s.wins} won, ${s.draws} drawn, ${s.losses} lost</span></div>
      <div class="ins-tile"><span class="ins-num">${s.avgAcc == null ? "–" : s.avgAcc.toFixed(1)}</span><span class="ins-cap">Average accuracy</span></div>
      <div class="ins-tile"><span class="ins-num">${s.blundersPerGame.toFixed(1)}</span><span class="ins-cap">Blunders per game</span></div>
      <div class="ins-tile"><span class="ins-num">${s.brilliant}</span><span class="ins-cap">Brilliant moves</span></div>
    </div>
    <div class="ins-grid2">
      <section class="ins-card ins-wide">
        <h2>Accuracy by game</h2>
        ${trendChart(s.games, root.clientWidth - 40)}
      </section>
      <section class="ins-card">
        <h2>Where errors happen</h2>
        <p class="ins-note">Inaccuracies, mistakes, misses and blunders per 10 moves${worst && worst[1].per10 > 0 ? `. Most come in the ${worst[0]}.` : "."}</p>
        ${phaseBars(s.phaseTotals)}
      </section>
      <section class="ins-card">
        <h2>Openings</h2>
        <table class="ins-table"><thead><tr><th>Opening</th><th class="num">Games</th><th class="num">Score</th><th class="num">Accuracy</th></tr></thead>
        <tbody>${s.openings.map((o) => `<tr><td title="${esc(o.name)}">${esc(o.name)}</td><td class="num">${o.games}</td>
          <td class="num">${o.scored ? Math.round((o.points / o.scored) * 100) + "%" : "–"}</td>
          <td class="num">${o.acc.length ? (o.acc.reduce((a, b) => a + b, 0) / o.acc.length).toFixed(1) : "–"}</td></tr>`).join("")}</tbody></table>
      </section>
      <section class="ins-card ins-wide">
        <h2>Every move graded</h2>
        <div class="ins-grades">${GRADES.map((g) => `<span class="ins-grade${s.totals[g.id] ? "" : " zero"}"><span class="chip" style="background:${g.color}">${g.symbol}</span>${g.label}<b>${s.totals[g.id]}</b></span>`).join("")}</div>
      </section>
    </div>`;

  root.querySelector("#insPlayer").addEventListener("change", (e) => {
    root.dataset.player = e.target.value;
    renderInsights(root, list, { onOpen });
  });

  // hover readout and click-to-open on the accuracy chart
  const pts = s.games.filter((g) => g.acc != null);
  const tip = root.querySelector(".ins-tip");
  root.querySelectorAll(".ins-pt").forEach((el) => {
    const g = pts[Number(el.dataset.i)];
    el.addEventListener("mouseenter", () => {
      const wrap = root.querySelector(".ins-chart-wrap").getBoundingClientRect();
      const r = el.querySelector(".ins-dot").getBoundingClientRect();
      tip.innerHTML = `<b>${g.acc.toFixed(1)}</b> vs ${esc(g.opponent)}<br>${fmtDate.format(g.date)}${g.res ? `, ${g.res === "win" ? "won" : g.res === "loss" ? "lost" : "drew"}` : ""}`;
      tip.hidden = false;
      const x = r.left - wrap.left + r.width / 2;
      tip.style.left = Math.min(Math.max(x, 90), wrap.width - 90) + "px";
      tip.style.top = r.top - wrap.top + "px";
    });
    el.addEventListener("mouseleave", () => { tip.hidden = true; });
    el.addEventListener("click", () => onOpen && onOpen(g.id));
  });
}
