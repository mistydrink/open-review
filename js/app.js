import { Chess } from "../vendor/chess.js";
import { Engine } from "./engine.js";
import { Board, loadPieces } from "./board.js";
import { GRADES, GRADE, classifyGame, winChance } from "./review.js";
import { SAMPLES } from "./sample.js";

const $ = (id) => document.getElementById(id);

const board = new Board($("board"));
const engine = new Engine();

let review = null; // result of classifyGame
let startFen = new Chess().fen();
let current = 0; // 0 = start position, n = after ply n

/* ---------------- display helpers ---------------- */

function formatEval(whiteScore, mateIn, toMove) {
  if (mateIn !== null && mateIn !== undefined) {
    // mateIn is from the side to move; convert to White's view
    const whiteMates = (toMove === "w") === mateIn > 0;
    return (whiteMates ? "" : "−") + "M" + Math.abs(mateIn);
  }
  if (Math.abs(whiteScore) >= 9900) return whiteScore > 0 ? "1-0" : "0-1";
  const v = whiteScore / 100;
  const s = Math.abs(v).toFixed(1);
  return v > 0.05 ? "+" + s : v < -0.05 ? "−" + s : "0.0";
}

const PHRASE = {
  brilliant: "is brilliant",
  great: "is a great move",
  best: "is the best move",
  excellent: "is excellent",
  good: "is good",
  inaccuracy: "is an inaccuracy",
  mistake: "is a mistake",
  miss: "is a miss",
  blunder: "is a blunder",
};

function moveLabel(ply) {
  const n = Math.ceil(ply.ply / 2);
  return n + (ply.color === "w" ? ". " : "... ") + ply.san;
}

/* ---------------- render a position ---------------- */

function show(index) {
  const total = review ? review.plies.length : 0;
  current = Math.max(0, Math.min(total, index));
  const ply = current > 0 ? review.plies[current - 1] : null;
  board.draw(ply ? ply.fenAfter : startFen, ply);

  // coach line
  const badge = $("coachBadge");
  if (ply) {
    const g = GRADE[ply.grade];
    badge.hidden = false;
    badge.textContent = g.symbol;
    badge.style.background = g.color;
    badge.setAttribute("aria-label", g.label);
    $("coachMain").textContent = moveLabel(ply) + " " + PHRASE[ply.grade];
    $("coachSub").textContent = ply.bestSan
      ? "The engine preferred " + ply.bestSan + "."
      : ply.grade === "brilliant"
        ? "A sacrifice that still holds the advantage."
        : ply.grade === "great"
          ? "The only move that keeps the position together."
          : "Matches the engine's choice.";
    $("coachEval").textContent = formatEval(ply.whiteScore, ply.mateIn, ply.moverToMoveAfter);
  } else if (review) {
    badge.hidden = true;
    $("coachMain").textContent = "Starting position";
    $("coachSub").textContent = "Use the arrows or your keyboard to step through the game.";
    $("coachEval").textContent = formatEval(review.startScore, null, "w");
  }

  // eval bar
  const whiteScore = ply ? ply.whiteScore : review ? review.startScore : 0;
  const pct = winChance(whiteScore);
  $("evalWhite").style.height = pct + "%";
  const num = $("evalNum");
  num.textContent = ply
    ? formatEval(ply.whiteScore, ply.mateIn, ply.moverToMoveAfter).replace("+", "").replace("−", "")
    : review ? formatEval(review.startScore, null, "w").replace("+", "").replace("−", "") : "0.0";
  const blackAhead = whiteScore < 0;
  num.classList.toggle("black-ahead", blackAhead !== board.flipped);
  $("evalbar").classList.toggle("flipped", board.flipped);

  // scoresheet + graph highlight
  document.querySelectorAll(".sheet-move").forEach((b) => {
    const on = Number(b.dataset.ply) === current;
    b.classList.toggle("active", on);
    if (on) b.scrollIntoView({ block: "nearest" });
  });
  drawGraph();

  $("btnStart").disabled = $("btnPrev").disabled = current === 0;
  $("btnEnd").disabled = $("btnNext").disabled = current === total;
}

/* ---------------- evaluation graph ---------------- */

function drawGraph() {
  if (!review) return;
  const svg = $("graph");
  const W = Math.max(1, Math.round(svg.clientWidth)), H = Math.max(1, Math.round(svg.clientHeight));
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  const n = review.plies.length;
  const points = [winChance(review.startScore), ...review.plies.map((p) => winChance(p.whiteScore))];
  const x = (i) => (i / n) * W;
  const y = (w) => H - (w / 100) * H;

  let d = `M0,${H} `;
  points.forEach((w, i) => (d += `L${x(i).toFixed(1)},${y(w).toFixed(1)} `));
  d += `L${W},${H} Z`;

  let marks = "";
  review.plies.forEach((p, i) => {
    if (["brilliant", "inaccuracy", "mistake", "miss", "blunder"].includes(p.grade)) {
      marks += `<circle cx="${x(i + 1)}" cy="${y(points[i + 1])}" r="5" fill="${GRADE[p.grade].color}" stroke="#1c2433" stroke-width="2"/>`;
    }
  });

  svg.innerHTML =
    `<path d="${d}" fill="#f4f4f1"/>` +
    `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#8a91a0" stroke-width="1" vector-effect="non-scaling-stroke" opacity="0.6"/>` +
    `<line x1="${x(current)}" y1="0" x2="${x(current)}" y2="${H}" stroke="#2f6fd1" stroke-width="2" vector-effect="non-scaling-stroke"/>` +
    marks;
}

$("graph").addEventListener("click", (e) => {
  if (!review) return;
  const r = e.currentTarget.getBoundingClientRect();
  const ratio = (e.clientX - r.left) / r.width;
  show(Math.round(ratio * review.plies.length));
});

/* ---------------- results panel ---------------- */

function renderResults(headers) {
  $("nameW").textContent = headers.White && headers.White !== "?" ? headers.White : "White";
  $("nameB").textContent = headers.Black && headers.Black !== "?" ? headers.Black : "Black";
  $("accW").textContent = review.accuracy.w === null ? "–" : review.accuracy.w.toFixed(1);
  $("accB").textContent = review.accuracy.b === null ? "–" : review.accuracy.b.toFixed(1);

  const tbody = $("grades").querySelector("tbody");
  tbody.innerHTML = "";
  for (const g of GRADES) {
    const w = review.summary.w[g.id], b = review.summary.b[g.id];
    const tr = document.createElement("tr");
    if (w + b === 0) tr.className = "zero";
    tr.innerHTML =
      `<td><span class="grade-cell"><span class="chip" style="background:${g.color}">${g.symbol}</span>${g.label}</span></td>` +
      `<td class="num">${w}</td><td class="num">${b}</td>`;
    tbody.appendChild(tr);
  }

  const sheet = $("sheet");
  sheet.innerHTML = "";
  const quiet = new Set(["best", "excellent", "good"]);
  for (let i = 0; i < review.plies.length; i += 2) {
    const row = document.createElement("div");
    row.className = "sheet-row";
    row.innerHTML = `<span class="sheet-num">${i / 2 + 1}</span>`;
    for (const p of [review.plies[i], review.plies[i + 1]]) {
      if (!p) { row.appendChild(document.createElement("span")); continue; }
      const g = GRADE[p.grade];
      const btn = document.createElement("button");
      btn.className = "sheet-move" + (quiet.has(p.grade) ? " quiet" : "");
      btn.dataset.ply = p.ply;
      btn.title = g.label;
      btn.innerHTML = `<span class="chip" style="background:${g.color}">${g.symbol}</span>${p.san}`;
      btn.addEventListener("click", () => show(p.ply));
      row.appendChild(btn);
    }
    sheet.appendChild(row);
  }

  $("importView").hidden = true;
  $("resultsView").hidden = false;
  $("graphWrap").hidden = false;
}

/* ---------------- running a review ---------------- */

function setEngineState(text, cls) {
  const el = $("engineState");
  el.textContent = text;
  el.className = "engine-state " + (cls || "");
}

function showError(msg) {
  const el = $("importError");
  el.textContent = msg;
  el.hidden = !msg;
}

async function runReview() {
  showError("");
  const text = $("pgn").value.trim();
  if (!text) {
    showError("Paste a game first, or try the sample game.");
    return;
  }
  const game = new Chess();
  if (!game.load_pgn(text, { sloppy: true })) {
    showError("That PGN couldn't be read. Check that it includes the moves, like 1. e4 e5 2. Nf3.");
    return;
  }
  const moves = game.history({ verbose: true });
  if (!moves.length) {
    showError("That game has no moves to review.");
    return;
  }
  const headers = game.header();

  // rebuild the list of positions from the game's own starting position
  const replay = new Chess();
  if (headers.FEN) replay.load(headers.FEN);
  const fens = [replay.fen()];
  for (const m of moves) { replay.move(m.san, { sloppy: true }); fens.push(replay.fen()); }

  const depth = Number(document.querySelector('input[name="depth"]:checked').value);
  $("btnReview").disabled = true;
  $("progress").hidden = false;
  $("progressFill").style.width = "0%";
  $("progressText").textContent = "Starting the engine";
  setEngineState("Starting Stockfish", "busy");

  try {
    await engine.start();
  } catch {
    $("btnReview").disabled = false;
    $("progress").hidden = true;
    setEngineState("Engine unavailable");
    showError(
      location.protocol === "file:"
        ? "Browsers block the engine when this page is opened as a file. Open the live site, or start a local server (see the README)."
        : "Stockfish couldn't start in this browser. Try an up-to-date Chrome, Edge, Firefox or Safari."
    );
    return;
  }

  setEngineState("Stockfish 17 is reviewing", "busy");
  await engine.newGame();
  const evals = [];
  const t0 = performance.now();
  for (let i = 0; i < fens.length; i++) {
    evals.push(await engine.analyse(fens[i], depth));
    const done = i + 1;
    $("progressFill").style.width = (done / fens.length) * 100 + "%";
    const perPos = (performance.now() - t0) / done;
    const left = Math.max(0, Math.round((perPos * (fens.length - done)) / 1000));
    $("progressText").textContent =
      `Reviewing position ${done} of ${fens.length}` + (done > 3 && left > 0 ? `, about ${left}s left` : "");
  }

  startFen = fens[0];
  review = classifyGame(moves, fens, evals);
  renderResults(headers);
  setEngineState("Stockfish 17 ready", "ready");
  $("btnReview").disabled = false;
  $("progress").hidden = true;
  show(0);
}

/* ---------------- wiring ---------------- */

$("btnReview").addEventListener("click", runReview);
document.querySelectorAll("[data-sample]").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("pgn").value = SAMPLES[Number(btn.dataset.sample)].pgn;
    showError("");
    $("pgn").focus();
  });
});
$("pgnFile").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (file) $("pgn").value = await file.text();
});
$("btnNew").addEventListener("click", () => {
  review = null;
  current = 0;
  startFen = new Chess().fen();
  $("resultsView").hidden = true;
  $("graphWrap").hidden = true;
  $("importView").hidden = false;
  $("coachBadge").hidden = true;
  $("coachMain").textContent = "Paste a game to start your review.";
  $("coachSub").textContent = "Every move gets graded from brilliant to blunder.";
  $("coachEval").textContent = "";
  $("evalWhite").style.height = "50%";
  $("evalNum").textContent = "0.0";
  board.draw(startFen, null);
  $("pgn").focus();
});
$("btnStart").addEventListener("click", () => show(0));
$("btnPrev").addEventListener("click", () => show(current - 1));
$("btnNext").addEventListener("click", () => show(current + 1));
$("btnEnd").addEventListener("click", () => show(review ? review.plies.length : 0));
$("btnFlip").addEventListener("click", () => {
  board.flipped = !board.flipped;
  if (review) show(current);
  else board.draw(startFen, null);
});
document.addEventListener("keydown", (e) => {
  if (!review || e.target.tagName === "TEXTAREA") return;
  if (e.key === "ArrowLeft") { show(current - 1); e.preventDefault(); }
  if (e.key === "ArrowRight") { show(current + 1); e.preventDefault(); }
  if (e.key === "Home") { show(0); e.preventDefault(); }
  if (e.key === "End") { show(review.plies.length); e.preventDefault(); }
});

window.addEventListener("resize", () => { if (review) drawGraph(); });

loadPieces().then(() => board.draw(startFen, null));
$("btnStart").disabled = $("btnPrev").disabled = $("btnNext").disabled = $("btnEnd").disabled = true;
