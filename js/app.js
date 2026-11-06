import { Chess } from "../vendor/chess.js";
import { Engine } from "./engine.js";
import { Board, loadPieces } from "./board.js";
import { GRADES, GRADE, classifyGame, winChance, lineToSan } from "./review.js";
import { SAMPLES } from "./sample.js";
import {
  listReviews, getReview, saveReview, unpackEvals, deleteReview, clearReviews, statsOf, updateStats,
} from "./history.js";
import { applyTheme, currentTheme, toggleTheme, getCookie, setCookie } from "./prefs.js";
import { watchAds } from "./ads.js";
import { fetchChessCom, fetchLichess } from "./importers.js";
import { encodeShare, decodeShare, annotatedPgn, download } from "./share.js";
import { renderInsights } from "./insights.js";

const $ = (id) => document.getElementById(id);

const board = new Board($("board"));
const engine = new Engine();

// The review on screen
let review = null;      // result of classifyGame
let game = null;        // { pgn, headers, depth, evals, you }
let startFen = new Chess().fen();
let current = 0;        // 0 = start position, n = after ply n
let reviewing = false;  // the engine is busy with a full review

// Explore mode: free moves from any position, with live engine lines
let explore = null;     // { chess, fromIndex, moves: [] , selected, info }
let liveToken = 0;

// Practice mode: retry your own mistakes
let practice = null;    // { items, idx, solved, selected, done, revealed }

/* ---------------- openings ---------------- */

let openingsPromise = null;
function getOpenings() {
  if (!openingsPromise) {
    openingsPromise = fetch("data/openings.json").then((r) => r.json()).catch(() => null);
  }
  return openingsPromise;
}

/* ---------------- display helpers ---------------- */

function formatEval(whiteScore, mateIn, toMove) {
  if (mateIn !== null && mateIn !== undefined) {
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
  book: "is a book move",
  inaccuracy: "is an inaccuracy",
  mistake: "is a mistake",
  miss: "is a miss",
  blunder: "is a blunder",
};

function moveLabel(ply) {
  const n = Math.ceil(ply.ply / 2);
  return n + (ply.color === "w" ? ". " : "... ") + ply.san;
}

// "11... Qb4+ 12. Kb1 Qxb5" from a list of SAN moves starting at a position
function numberedLine(fen, sanMoves) {
  const parts = fen.split(" ");
  let side = parts[1];
  let n = Number(parts[5]) || 1;
  return sanMoves.map((san, i) => {
    let tok = "";
    if (side === "w") tok = n + ". " + san;
    else tok = (i === 0 ? n + "... " : "") + san;
    if (side === "b") n++;
    side = side === "w" ? "b" : "w";
    return tok;
  }).join(" ");
}

function setEval(whiteScore, label) {
  $("evalWhite").style.height = winChance(whiteScore) + "%";
  const num = $("evalNum");
  num.textContent = label.replace("+", "").replace("−", "");
  num.classList.toggle("black-ahead", (whiteScore < 0) !== board.flipped);
  $("evalbar").classList.toggle("flipped", board.flipped);
}

function setCoach({ badge = null, main, sub = "", evalText = "" }) {
  const b = $("coachBadge");
  if (badge) {
    b.hidden = false;
    b.textContent = badge.symbol;
    b.style.background = badge.color;
    b.setAttribute("aria-label", badge.label);
  } else {
    b.hidden = true;
  }
  $("coachMain").textContent = main;
  $("coachSub").textContent = sub;
  $("coachSub").title = sub;
  $("coachEval").textContent = evalText;
}

function toast(msg, extra) {
  const t = $("toast");
  t.innerHTML = "";
  const p = document.createElement("span");
  p.textContent = msg;
  t.appendChild(p);
  if (extra) t.appendChild(extra);
  t.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => { t.hidden = true; }, extra ? 12000 : 2600);
}

/* ---------------- render a position of the reviewed game ---------------- */

function show(index) {
  if (explore) exitExplore(false);
  const total = review ? review.plies.length : 0;
  current = Math.max(0, Math.min(total, index));
  const ply = current > 0 ? review.plies[current - 1] : null;
  board.draw(ply ? ply.fenAfter : startFen, ply, { interactive: !reviewing });

  if (ply) {
    const g = GRADE[ply.grade];
    let sub;
    if (ply.grade === "book") sub = review.opening ? review.opening.name : "A known opening move.";
    else if (ply.bestSan) sub = "Engine line: " + numberedLine(ply.fenBefore, ply.bestLine.length ? ply.bestLine : [ply.bestSan]);
    else if (ply.grade === "brilliant") sub = "A sacrifice that keeps the edge.";
    else if (ply.grade === "great") sub = "The only move that holds.";
    else sub = "Matches the engine.";
    const ev = formatEval(ply.whiteScore, ply.mateIn, ply.moverToMoveAfter);
    setCoach({ badge: g, main: moveLabel(ply) + " " + PHRASE[ply.grade], sub, evalText: ev });
    setEval(ply.whiteScore, ev);
  } else if (review) {
    const ev = formatEval(review.startScore, null, "w");
    setCoach({ main: "Starting position", sub: "Step through with the arrows, or move a piece to explore.", evalText: ev });
    setEval(review.startScore, ev);
  }

  const sheetEl = $("sheet");
  document.querySelectorAll(".sheet-move").forEach((b) => {
    const on = Number(b.dataset.ply) === current;
    b.classList.toggle("active", on);
    if (on) {
      // Scroll only the scoresheet, never the panel around it.
      const top = b.offsetTop, h = b.offsetHeight;
      if (top < sheetEl.scrollTop) sheetEl.scrollTop = top;
      else if (top + h > sheetEl.scrollTop + sheetEl.clientHeight) sheetEl.scrollTop = top + h - sheetEl.clientHeight;
    }
  });
  drawGraph();
  updateNav();
}

function updateNav() {
  const total = review ? review.plies.length : 0;
  const inExplore = !!explore;
  $("btnBack").hidden = !inExplore;
  $("btnStart").disabled = $("btnPrev").disabled = !inExplore && current === 0;
  $("btnEnd").disabled = $("btnNext").disabled = inExplore || current === total;
  if (practice) {
    $("btnStart").disabled = $("btnPrev").disabled = $("btnEnd").disabled = $("btnNext").disabled = true;
  }
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
  const css = getComputedStyle(document.documentElement);
  const light = css.getPropertyValue("--bar-light").trim();
  const dark = css.getPropertyValue("--bar-dark").trim();

  let d = `M0,${H} `;
  points.forEach((w, i) => (d += `L${x(i).toFixed(1)},${y(w).toFixed(1)} `));
  d += `L${W},${H} Z`;
  let marks = "";
  review.plies.forEach((p, i) => {
    if (["brilliant", "inaccuracy", "mistake", "miss", "blunder"].includes(p.grade)) {
      marks += `<circle cx="${x(i + 1)}" cy="${y(points[i + 1])}" r="5" fill="${GRADE[p.grade].color}" stroke="${dark}" stroke-width="2"/>`;
    }
  });
  svg.innerHTML =
    `<title>Click to jump to a move</title><path d="${d}" fill="${light}"/>` +
    `<line x1="0" y1="${H / 2}" x2="${W}" y2="${H / 2}" stroke="#8a91a0" stroke-width="1" opacity="0.6"/>` +
    `<line x1="${x(current)}" y1="0" x2="${x(current)}" y2="${H}" stroke="#2f6fd1" stroke-width="2"/>` +
    marks;
}

$("graph").addEventListener("click", (e) => {
  if (!review || practice) return;
  const r = e.currentTarget.getBoundingClientRect();
  show(Math.round(((e.clientX - r.left) / r.width) * review.plies.length));
});

/* ---------------- results panel ---------------- */

function renderResults() {
  const h = game.headers;
  $("nameW").textContent = h.White && h.White !== "?" ? h.White : "White";
  $("nameB").textContent = h.Black && h.Black !== "?" ? h.Black : "Black";
  $("accW").textContent = review.accuracy.w === null ? "–" : review.accuracy.w.toFixed(1);
  $("accB").textContent = review.accuracy.b === null ? "–" : review.accuracy.b.toFixed(1);
  $("openingName").textContent = review.opening ? `${review.opening.name} (${review.opening.eco})` : "Opening not in the book";

  const errors = review.plies.filter((p) =>
    ["mistake", "blunder", "miss"].includes(p.grade) && (!game.you || p.color === game.you.color)).length;
  $("btnPractice").disabled = errors === 0;
  $("btnPractice").textContent = errors ? `Practice mistakes (${errors})` : "No mistakes";
  $("btnPractice").title = errors ? `Retry ${game.you ? "your" : "the"} ${errors} mistake${errors === 1 ? "" : "s"} from this game` : "";

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
    row.innerHTML = `<span class="sheet-num">${Math.ceil(review.plies[i].ply / 2)}</span>`;
    for (const p of [review.plies[i], review.plies[i + 1]]) {
      if (!p) { row.appendChild(document.createElement("span")); continue; }
      const g = GRADE[p.grade];
      const btn = document.createElement("button");
      btn.className = "sheet-move" + (quiet.has(p.grade) ? " quiet" : "");
      btn.dataset.ply = p.ply;
      btn.title = g.label;
      btn.innerHTML = `<span class="chip" style="background:${g.color}">${g.symbol}</span>`;
      btn.appendChild(document.createTextNode(p.san));
      btn.addEventListener("click", () => { if (!practice) show(p.ply); });
      row.appendChild(btn);
    }
    sheet.appendChild(row);
  }

  showPanel("results");
  $("graphWrap").hidden = false;
}

function showPanel(name) {
  $("importView").hidden = name !== "import";
  $("resultsView").hidden = name !== "results";
  $("practiceView").hidden = name !== "practice";
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

// Read a PGN into its moves and every position along the way.
function parseGame(text) {
  const g = new Chess();
  if (!g.load_pgn(text, { sloppy: true })) {
    return { error: "That PGN couldn't be read. Check that it includes the moves, like 1. e4 e5 2. Nf3." };
  }
  const moves = g.history({ verbose: true });
  if (!moves.length) return { error: "That game has no moves to review." };
  const headers = g.header();
  const replay = new Chess();
  if (headers.FEN) replay.load(headers.FEN);
  const fens = [replay.fen()];
  for (const m of moves) { replay.move(m.san, { sloppy: true }); fens.push(replay.fen()); }
  return { moves, fens, headers };
}

async function startEngine() {
  try {
    await engine.start();
    return true;
  } catch {
    setEngineState("Engine unavailable");
    const msg = location.protocol === "file:"
      ? "Browsers block the engine when this page is opened as a file. Open the live site, or start a local server (see the README)."
      : "Stockfish couldn't start in this browser. Try an up-to-date Chrome, Edge, Firefox or Safari.";
    if (!$("importView").hidden) showError(msg); else toast(msg);
    return false;
  }
}

async function runReview(text, you = null) {
  showError("");
  text = (text || "").trim();
  if (!text) { showError("Paste a game first, or try a sample game."); return; }
  const parsed = parseGame(text);
  if (parsed.error) { showError(parsed.error); return; }
  const { moves, fens, headers } = parsed;
  const depth = Number(document.querySelector('input[name="depth"]:checked').value);

  if (explore) exitExplore(false);
  $("btnReview").disabled = true;
  $("progress").hidden = false;
  $("progressFill").style.width = "0%";
  $("progressText").textContent = "Starting the engine";
  setEngineState("Starting Stockfish", "busy");
  if (!(await startEngine())) { $("btnReview").disabled = false; $("progress").hidden = true; return; }

  reviewing = true;
  setEngineState("Stockfish 17 is reviewing", "busy");
  await engine.stop();
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
  reviewing = false;
  setEngineState("Stockfish 17 ready", "ready");
  $("btnReview").disabled = false;
  $("progress").hidden = true;

  await presentReview({ moves, fens, headers, evals, pgn: text, depth, you });
  saveReview({ pgn: text, headers, depth, review, evals, you });
  renderHistory();
}

async function presentReview({ moves, fens, headers, evals, pgn, depth, you = null }) {
  const openings = await getOpenings();
  startFen = fens[0];
  review = classifyGame(moves, fens, evals, openings);
  game = { pgn, headers, depth, evals, you };
  // Show the game from the importing player's side.
  board.flipped = !!(you && you.color === "b");
  renderResults();
  show(0);
}

/* ---------------- importing by username ---------------- */

let importSource = "paste";

function setSource(src) {
  importSource = src;
  document.querySelectorAll("[data-source]").forEach((b) => b.setAttribute("aria-selected", b.dataset.source === src ? "true" : "false"));
  $("srcPaste").hidden = src !== "paste";
  $("srcUser").hidden = src === "paste";
  if (src !== "paste") {
    const name = src === "chesscom" ? "Chess.com" : "Lichess";
    $("userLabel").textContent = `${name} username`;
    $("username").value = getCookie(src === "chesscom" ? "or_user_chesscom" : "or_user_lichess") || "";
    $("gameList").innerHTML = "";
    $("userStatus").textContent = "";
  }
  $("btnReview").hidden = src !== "paste";
}

async function findGames(e) {
  e.preventDefault();
  const name = $("username").value.trim();
  if (!name) { $("userStatus").textContent = "Enter a username first."; return; }
  setCookie(importSource === "chesscom" ? "or_user_chesscom" : "or_user_lichess", name);
  $("userStatus").textContent = "Looking up recent games";
  $("gameList").innerHTML = "";
  $("btnFind").disabled = true;
  try {
    const games = importSource === "chesscom" ? await fetchChessCom(name) : await fetchLichess(name);
    $("userStatus").textContent = `${games.length} recent games. Pick one to review.`;
    renderGameList(games);
  } catch (err) {
    $("userStatus").textContent = err instanceof TypeError
      ? "Couldn't reach the site. Check your connection and try again."
      : err.message;
  } finally {
    $("btnFind").disabled = false;
  }
}

const shortDate = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

function renderGameList(games) {
  const ol = $("gameList");
  ol.innerHTML = "";
  for (const g of games) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "game-pick";
    const oppRating = g.youColor === "w" ? g.blackRating : g.whiteRating;
    btn.innerHTML =
      `<span class="pick-opp"></span><span class="pick-outcome ${g.outcome}"></span><span class="pick-meta"></span>`;
    btn.querySelector(".pick-opp").textContent = `vs ${g.opponent}${oppRating ? ` (${oppRating})` : ""}`;
    btn.querySelector(".pick-outcome").textContent = g.outcome === "win" ? "Won" : g.outcome === "loss" ? "Lost" : "Draw";
    btn.querySelector(".pick-meta").textContent =
      `${g.youColor === "w" ? "White" : "Black"}, ${g.speed}, ${shortDate.format(g.date)}`;
    btn.addEventListener("click", () => {
      $("pgn").value = g.pgn;
      runReview(g.pgn, { name: g.you, color: g.youColor });
    });
    li.appendChild(btn);
    ol.appendChild(li);
  }
}

/* ---------------- past reviews ---------------- */

const dateFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });

function renderHistory() {
  const list = listReviews();
  $("historyCount").textContent = list.length ? ` (${list.length})` : "";
  const ol = $("historyList");
  ol.innerHTML = "";
  $("historyEmpty").hidden = list.length > 0;
  $("btnClearHistory").hidden = list.length === 0;
  for (const r of list) {
    const li = document.createElement("li");
    li.className = "history-item";
    const open = document.createElement("button");
    open.className = "history-open";
    open.type = "button";
    const moves = Math.ceil(r.plies / 2);
    const meta = [r.result, moves + (moves === 1 ? " move" : " moves"), dateFmt.format(new Date(r.savedAt))]
      .filter(Boolean).join(", ");
    const acc = r.accW == null || r.accB == null ? "" : `${r.accW.toFixed(1)} / ${r.accB.toFixed(1)}`;
    open.innerHTML = `<span class="history-players"></span><span class="history-meta"></span><span class="history-acc"></span>`;
    open.querySelector(".history-players").textContent = `${r.white} vs ${r.black}`;
    open.querySelector(".history-players").title = `${r.white} vs ${r.black}`;
    open.querySelector(".history-meta").textContent = meta;
    open.querySelector(".history-acc").textContent = acc;
    open.addEventListener("click", () => openSaved(r.id));
    const del = document.createElement("button");
    del.className = "history-del";
    del.type = "button";
    del.textContent = "×";
    del.setAttribute("aria-label", `Delete review of ${r.white} vs ${r.black}`);
    del.addEventListener("click", () => { deleteReview(r.id); renderHistory(); });
    li.append(open, del);
    ol.appendChild(li);
  }
}

async function openSaved(id) {
  const r = getReview(id);
  if (!r) { renderHistory(); return; }
  const parsed = parseGame(r.pgn);
  if (parsed.error) { toast("That saved review couldn't be opened."); return; }
  showError("");
  $("pgn").value = r.pgn;
  await presentReview({ ...parsed, evals: unpackEvals(r.evals), pgn: r.pgn, depth: r.depth, you: r.you || null });
}

/* ---------------- explore mode ---------------- */

function currentFen() {
  if (explore) return explore.chess.fen();
  if (!review) return startFen;
  return current > 0 ? review.plies[current - 1].fenAfter : startFen;
}

function drawExplore() {
  const last = explore.moves[explore.moves.length - 1];
  const targets = explore.selected
    ? explore.chess.moves({ square: explore.selected, verbose: true }).map((m) => m.to)
    : [];
  board.draw(explore.chess.fen(), null, {
    interactive: true,
    highlight: last ? { from: last.from, to: last.to } : null,
    selected: explore.selected,
    targets,
    arrow: explore.info && explore.info.move ? explore.info.move : null,
  });
}

function startExplore() {
  explore = { chess: new Chess(currentFen()), fromIndex: current, moves: [], selected: null, info: null };
  updateNav();
}

function exitExplore(redraw = true) {
  if (!explore) return;
  explore = null;
  liveToken++;
  engine.stop();
  if (redraw) show(current);
}

function exploreLabel() {
  const fen0 = explore.moves.length ? null : explore.chess.fen();
  if (!explore.moves.length) return "Exploring from this position";
  const startFenEx = new Chess(currentFenOfGame()).fen();
  return "Exploring: " + numberedLine(startFenEx, explore.moves.map((m) => m.san));
}

function currentFenOfGame() {
  if (!review) return startFen;
  return explore.fromIndex > 0 ? review.plies[explore.fromIndex - 1].fenAfter : startFen;
}

async function analyseLive() {
  const token = ++liveToken;
  const fen = explore.chess.fen();
  const turn = explore.chess.turn();
  explore.info = null;
  if (explore.chess.game_over()) {
    const over = explore.chess.in_checkmate() ? "Checkmate" : "Draw";
    setCoach({ main: exploreLabel(), sub: over + ".", evalText: "" });
    drawExplore();
    return;
  }
  setCoach({ main: exploreLabel(), sub: "Stockfish is thinking", evalText: $("coachEval").textContent });
  if (!(await startEngine())) return;
  await engine.stop();
  if (token !== liveToken) return;
  let lastDraw = 0;
  engine.search(fen, 18, (info) => {
    if (token !== liveToken || !explore) return;
    explore.info = info;
    const whiteScore = turn === "w" ? info.score : -info.score;
    const ev = formatEval(whiteScore, info.mateIn, turn);
    const line = numberedLine(fen, lineToSan(fen, info.pv));
    setCoach({ main: exploreLabel(), sub: `Depth ${info.depth}: ${line}`, evalText: ev });
    setEval(whiteScore, ev);
    const now = performance.now();
    if (now - lastDraw > 150) { lastDraw = now; drawExplore(); }
  }).then(() => { if (token === liveToken && explore) drawExplore(); });
}

function handleExploreClick(sq) {
  if (!explore) startExplore();
  const c = explore.chess;
  const piece = c.get(sq);
  if (explore.selected) {
    const move = c.moves({ square: explore.selected, verbose: true }).find((m) => m.to === sq);
    if (move) {
      const made = c.move({ from: move.from, to: move.to, promotion: "q" });
      explore.moves.push(made);
      explore.selected = null;
      drawExplore();
      updateNav();
      analyseLive();
      return;
    }
  }
  explore.selected = piece && piece.color === c.turn() ? (explore.selected === sq ? null : sq) : null;
  if (!explore.moves.length && !explore.selected) { exitExplore(); return; }
  drawExplore();
}

function exploreUndo() {
  if (!explore) return;
  if (!explore.moves.length) { exitExplore(); return; }
  explore.chess.undo();
  explore.moves.pop();
  explore.selected = null;
  if (!explore.moves.length) { exitExplore(); return; }
  drawExplore();
  analyseLive();
}

/* ---------------- practice mode ---------------- */

function practiceItems(side) {
  return review.plies.filter((p) =>
    ["mistake", "blunder", "miss"].includes(p.grade) && (side === "both" || p.color === side));
}

function startPractice() {
  if (!review) return;
  if (explore) exitExplore(false);
  const side = game.you ? game.you.color : "both";
  practice = { side, items: practiceItems(side), idx: 0, solved: 0, selected: null, done: false, revealed: false, busy: false };
  document.querySelectorAll("[data-pside]").forEach((b) => {
    b.setAttribute("aria-pressed", b.dataset.pside === side ? "true" : "false");
  });
  $("practiceSides").hidden = !!game.you;
  showPanel("practice");
  showPracticeItem();
}

function setPracticeSide(side) {
  practice.side = side;
  practice.items = practiceItems(side);
  practice.idx = 0; practice.solved = 0;
  document.querySelectorAll("[data-pside]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.pside === side ? "true" : "false"));
  showPracticeItem();
}

function practiceBoard(extra = {}) {
  const item = practice.items[practice.idx];
  const c = new Chess(practice.fen);
  const targets = practice.selected ? c.moves({ square: practice.selected, verbose: true }).map((m) => m.to) : [];
  board.draw(practice.fen, null, {
    interactive: !practice.done,
    selected: practice.selected,
    targets,
    arrow: practice.revealed ? item.bestUci : null,
    ...extra,
  });
}

function showPracticeItem() {
  const items = practice.items;
  $("practiceNext").hidden = true;
  $("practiceReveal").hidden = false;
  $("practiceFeedback").textContent = "";
  $("practiceFeedback").className = "practice-feedback";
  if (!items.length) {
    $("practiceCount").textContent = "";
    $("practicePrompt").textContent = "No mistakes or blunders for this side. Nicely played.";
    $("practiceReveal").hidden = true;
    return;
  }
  if (practice.idx >= items.length) {
    practice.done = true;
    $("practiceCount").textContent = "";
    $("practicePrompt").textContent = `Done. You found a good move in ${practice.solved} of ${items.length} positions.`;
    $("practiceReveal").hidden = true;
    $("practiceNext").hidden = false;
    $("practiceNext").textContent = "Start again";
    return;
  }
  const item = items[practice.idx];
  practice.fen = item.fenBefore;
  practice.selected = null;
  practice.revealed = false;
  practice.done = false;
  practice.found = false;
  board.flipped = item.color === "b";
  const side = item.color === "w" ? "White" : "Black";
  $("practiceCount").textContent = `Position ${practice.idx + 1} of ${items.length}`;
  $("practicePrompt").textContent =
    `${side} to play. In the game, ${moveLabel(item)} was ${GRADE[item.grade].label.toLowerCase() === "miss" ? "a miss" : "a " + GRADE[item.grade].label.toLowerCase()}. Find a better move.`;
  setCoach({ badge: GRADE[item.grade], main: `Find a better move than ${item.san}`, sub: `${side} to play.`, evalText: "" });
  const ws = item.color === "w" ? item.bestScore : -item.bestScore;
  setEval(ws, formatEval(ws, null, item.color));
  practiceBoard();
  updateNav();
}

async function handlePracticeClick(sq) {
  if (practice.done || practice.busy || practice.found || !practice.items.length || practice.idx >= practice.items.length) return;
  const item = practice.items[practice.idx];
  const c = new Chess(practice.fen);
  if (practice.selected) {
    const move = c.moves({ square: practice.selected, verbose: true }).find((m) => m.to === sq);
    if (move) {
      practice.selected = null;
      const made = c.move({ from: move.from, to: move.to, promotion: "q" });
      const uci = made.from + made.to + (made.promotion || "");
      board.draw(c.fen(), null, { highlight: { from: made.from, to: made.to } });
      await judgePractice(item, made, uci, c.fen());
      return;
    }
  }
  const piece = c.get(sq);
  practice.selected = piece && piece.color === c.turn() ? (practice.selected === sq ? null : sq) : null;
  practiceBoard();
}

async function judgePractice(item, made, uci, fenAfter) {
  const fb = $("practiceFeedback");
  const correct = (msg) => {
    practice.found = true;
    practice.solved++;
    fb.textContent = msg;
    fb.className = "practice-feedback good";
    $("practiceReveal").hidden = true;
    $("practiceNext").hidden = false;
    $("practiceNext").textContent = practice.idx + 1 < practice.items.length ? "Next position" : "See results";
  };
  const retry = (msg) => {
    fb.textContent = msg;
    fb.className = "practice-feedback bad";
    setTimeout(() => { if (!practice || practice.found) return; practiceBoard(); }, 900);
  };
  if (uci === item.bestUci) { correct(`${made.san} is the engine's top move.`); return; }
  if (made.san === item.san) { retry(`${made.san} is the move from the game. Try something else.`); return; }
  practice.busy = true;
  fb.textContent = "Checking with Stockfish";
  fb.className = "practice-feedback";
  if (!(await startEngine())) { practice.busy = false; return; }
  liveToken++;
  await engine.stop();
  const res = await engine.analyse(fenAfter, 12);
  practice.busy = false;
  const moverScore = res.over ? (new Chess(fenAfter).in_checkmate() ? 10000 : 0) : -res.score;
  const drop = winChance(item.bestScore) - winChance(moverScore);
  if (drop < 5) correct(`${made.san} works. It's nearly as strong as the engine's choice.`);
  else retry(`${made.san} isn't enough. Try again, or show the answer.`);
}

/* ---------------- share and export ---------------- */

async function shareReview() {
  if (!game) return;
  const token = await encodeShare({
    v: 1, pgn: game.pgn, depth: game.depth,
    evals: game.evals.map((e) => [e.best, e.score, e.mateIn, e.second, e.over ? 1 : 0, (e.pv || []).slice(0, 6).join(" ")]),
  });
  const url = `${location.origin}${location.pathname}#r=${token}`;
  try {
    await navigator.clipboard.writeText(url);
    toast("Link copied. Anyone who opens it sees this review instantly.");
  } catch {
    const input = document.createElement("input");
    input.value = url;
    input.readOnly = true;
    input.className = "toast-input";
    input.addEventListener("focus", () => input.select());
    toast("Copy this link:", input);
    input.focus();
  }
}

async function openShared() {
  const m = location.hash.match(/^#r=([A-Za-z0-9_-]+)/);
  if (!m) return false;
  try {
    const data = await decodeShare(m[1]);
    const parsed = parseGame(data.pgn);
    if (parsed.error) throw new Error();
    const evals = unpackEvals(data.evals);
    await presentReview({ ...parsed, evals, pgn: data.pgn, depth: data.depth });
    saveReview({ pgn: data.pgn, headers: parsed.headers, depth: data.depth, review, evals });
    renderHistory();
    return true;
  } catch {
    toast("That share link is incomplete or damaged.");
    return false;
  }
}

function exportPgn() {
  if (!game) return;
  const h = game.headers;
  const name = `${h.White || "white"}-vs-${h.Black || "black"}`.replace(/[^\w.-]+/g, "_");
  download(`${name}-review.pgn`, annotatedPgn(h, review));
  toast("Annotated PGN downloaded.");
}

/* ---------------- views: review and insights ---------------- */

async function showView(view) {
  $("reviewView").hidden = view !== "review";
  $("insightsView").hidden = view !== "insights";
  document.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-current", b.dataset.view === view ? "page" : "false"));
  if (view === "insights") {
    // Older saved reviews may not have stats yet; fill them in once.
    const openings = await getOpenings();
    for (const r of listReviews()) {
      if (r.stats && r.stats.phases) continue;
      const parsed = parseGame(r.pgn);
      if (parsed.error) continue;
      const rv = classifyGame(parsed.moves, parsed.fens, unpackEvals(r.evals), openings);
      updateStats(r.id, statsOf(rv));
    }
    renderInsights($("insightsView"), listReviews(), {
      onOpen: async (id) => { await showView("review"); openSaved(id); },
    });
  } else if (review) {
    drawGraph();
  }
}

/* ---------------- going home ---------------- */

function goHome() {
  if (explore) exitExplore(false);
  practice = null;
  review = null;
  game = null;
  current = 0;
  startFen = new Chess().fen();
  showPanel("import");
  $("graphWrap").hidden = true;
  setCoach({ main: "Paste a game or enter a username to start.", sub: "Or move a piece to explore any position with Stockfish." });
  $("evalWhite").style.height = "50%";
  $("evalNum").textContent = "0.0";
  board.draw(startFen, null, { interactive: true });
  updateNav();
  renderHistory();
  if (location.hash) history.replaceState(null, "", location.pathname);
}

/* ---------------- wiring ---------------- */

board.svg.addEventListener("click", (e) => {
  if (reviewing) return;
  const sq = board.squareAt(e);
  if (!sq) return;
  if (practice) handlePracticeClick(sq);
  else handleExploreClick(sq);
});

$("btnReview").addEventListener("click", () => runReview($("pgn").value));
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
document.querySelectorAll("[data-source]").forEach((b) => b.addEventListener("click", () => setSource(b.dataset.source)));
$("userForm").addEventListener("submit", findGames);
document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("[data-tab]").forEach((x) => x.setAttribute("aria-selected", x === b ? "true" : "false"));
  $("tabNew").hidden = b.dataset.tab !== "new";
  $("tabHistory").hidden = b.dataset.tab !== "history";
}));

$("btnNew").addEventListener("click", goHome);
$("btnPractice").addEventListener("click", startPractice);
$("btnShare").addEventListener("click", shareReview);
$("btnExport").addEventListener("click", exportPgn);
$("practiceExit").addEventListener("click", () => {
  practice = null;
  board.flipped = !!(game && game.you && game.you.color === "b");
  showPanel("results");
  show(current);
});
$("practiceReveal").addEventListener("click", () => {
  const item = practice.items[practice.idx];
  practice.revealed = true;
  practice.found = true;
  $("practiceFeedback").textContent = `The engine plays ${item.bestSan || "the arrowed move"}.` +
    (item.bestLine.length > 1 ? ` Line: ${numberedLine(item.fenBefore, item.bestLine)}` : "");
  $("practiceFeedback").className = "practice-feedback";
  $("practiceReveal").hidden = true;
  $("practiceNext").hidden = false;
  $("practiceNext").textContent = practice.idx + 1 < practice.items.length ? "Next position" : "See results";
  practiceBoard();
});
$("practiceNext").addEventListener("click", () => {
  if (practice.done) { practice.idx = 0; practice.solved = 0; practice.done = false; }
  else practice.idx++;
  showPracticeItem();
});
document.querySelectorAll("[data-pside]").forEach((b) => b.addEventListener("click", () => setPracticeSide(b.dataset.pside)));

// "Clear all" asks for a second click instead of opening a dialog.
let clearTimer = null;
$("btnClearHistory").addEventListener("click", (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.armed) {
    clearTimeout(clearTimer);
    delete btn.dataset.armed;
    btn.textContent = "Clear all";
    clearReviews();
    renderHistory();
    return;
  }
  btn.dataset.armed = "1";
  btn.textContent = "Click again to delete all";
  clearTimer = setTimeout(() => { delete btn.dataset.armed; btn.textContent = "Clear all"; }, 3000);
});

$("btnTheme").addEventListener("click", () => {
  toggleTheme();
  if (review && !$("reviewView").hidden) drawGraph();
  if (!$("insightsView").hidden) showView("insights");
});
document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => showView(b.dataset.view)));

const savedDepth = getCookie("or_depth");
if (savedDepth) {
  const input = document.querySelector(`input[name="depth"][value="${savedDepth}"]`);
  if (input) input.checked = true;
}
document.querySelectorAll('input[name="depth"]').forEach((input) =>
  input.addEventListener("change", () => setCookie("or_depth", input.value))
);

$("btnStart").addEventListener("click", () => { if (explore) exitExplore(); else show(0); });
$("btnPrev").addEventListener("click", () => { if (explore) exploreUndo(); else show(current - 1); });
$("btnNext").addEventListener("click", () => show(current + 1));
$("btnEnd").addEventListener("click", () => show(review ? review.plies.length : 0));
$("btnBack").addEventListener("click", () => exitExplore());
$("btnFlip").addEventListener("click", () => {
  board.flipped = !board.flipped;
  if (practice) practiceBoard();
  else if (explore) drawExplore();
  else if (review) show(current);
  else board.draw(startFen, null, { interactive: true });
  $("evalbar").classList.toggle("flipped", board.flipped);
});
document.addEventListener("keydown", (e) => {
  if (["TEXTAREA", "INPUT"].includes(e.target.tagName) || practice || $("reviewView").hidden) return;
  if (e.key === "Escape" && explore) { exitExplore(); return; }
  if (!review && !explore) return;
  if (e.key === "ArrowLeft") { if (explore) exploreUndo(); else show(current - 1); e.preventDefault(); }
  if (e.key === "ArrowRight" && !explore) { show(current + 1); e.preventDefault(); }
  if (e.key === "Home" && !explore) { show(0); e.preventDefault(); }
  if (e.key === "End" && !explore) { show(review.plies.length); e.preventDefault(); }
});
window.addEventListener("resize", () => { if (review && !$("reviewView").hidden) drawGraph(); });

/* ---------------- offline app ---------------- */

let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installEvent = e;
  $("btnInstall").hidden = false;
});
$("btnInstall").addEventListener("click", async () => {
  if (!installEvent) return;
  installEvent.prompt();
  await installEvent.userChoice;
  installEvent = null;
  $("btnInstall").hidden = true;
});
if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

/* ---------------- start ---------------- */

applyTheme(currentTheme());
renderHistory();
watchAds();
setSource("paste");
updateNav();
loadPieces().then(async () => {
  board.draw(startFen, null, { interactive: true });
  if (!(await openShared())) goHome();
});
