// Turns raw engine evaluations into move classifications and accuracy scores.
import { Chess } from "../vendor/chess.js";

// The grades, in the order they appear in the summary table.
// Names and colours follow the conventions chess.com players already know.
export const GRADES = [
  { id: "brilliant",  label: "Brilliant",  symbol: "!!", color: "#1fa7a1" },
  { id: "great",      label: "Great",      symbol: "!",  color: "#5b8fc9" },
  { id: "best",       label: "Best",       symbol: "★",  color: "#7fae3d" },
  { id: "excellent",  label: "Excellent",  symbol: "✓",  color: "#93b84a" },
  { id: "good",       label: "Good",       symbol: "✓",  color: "#8aa07b" },
  { id: "book",       label: "Book",       symbol: "≡",  color: "#a88865" },
  { id: "inaccuracy", label: "Inaccuracy", symbol: "?!", color: "#e2b100" },
  { id: "mistake",    label: "Mistake",    symbol: "?",  color: "#ef8a2c" },
  { id: "miss",       label: "Miss",       symbol: "✕",  color: "#e86a5c" },
  { id: "blunder",    label: "Blunder",    symbol: "??", color: "#d93a2b" },
];
export const GRADE = Object.fromEntries(GRADES.map((g) => [g.id, g]));

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 100 };

// Win chance (0–100) for the side to move, from a centipawn score.
// Same curve Lichess publishes for its accuracy metric.
export function winChance(cp) {
  const c = Math.max(-10000, Math.min(10000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

// Per-move accuracy from the drop in win chance (Lichess formula).
function moveAccuracy(drop) {
  const a = 103.1668 * Math.exp(-0.04354 * drop) - 3.1669;
  return Math.max(0, Math.min(100, a));
}

// Combine move accuracies into one game number: average of the
// arithmetic and harmonic means, so a single blunder still hurts.
function gameAccuracy(list) {
  if (!list.length) return null;
  const arith = list.reduce((s, x) => s + x, 0) / list.length;
  const harm = list.length / list.reduce((s, x) => s + 1 / Math.max(x, 1), 0);
  return (arith + harm) / 2;
}

// Did the move leave a piece (worth at least a knight) where it can be won?
function isSacrifice(fenAfter, move) {
  const moved = VALUE[move.piece];
  if (moved < 3) return false;
  if (move.captured && VALUE[move.captured] >= moved) return false; // even trade or better
  const g = new Chess(fenAfter);
  const takes = g.moves({ verbose: true }).filter((m) => m.to === move.to && m.captured);
  if (!takes.length) return false;
  for (const t of takes) {
    if (VALUE[t.piece] < moved) return true; // a cheaper piece can take it
    g.move(t);
    const recapture = g.moves({ verbose: true }).some((m) => m.to === move.to && m.captured);
    g.undo();
    if (!recapture) return true; // it simply hangs
  }
  return false;
}

// Score for the side to move in a position, handling game-over positions.
function positionScore(fen, result) {
  if (!result.over) return result.score;
  const g = new Chess(fen);
  return g.in_checkmate() ? -10000 : 0;
}

export function sanFromUci(fen, uci) {
  if (!uci) return null;
  const g = new Chess(fen);
  const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
  return m ? m.san : null;
}

// moves: verbose chess.js moves; fens: fen before each move plus the final fen;
// evals: engine result for every fen.
const uci = (m) => m.from + m.to + (m.promotion || "");

// Mate distance (from the side to move) encoded in a large score, or null.
function mateFromScore(score) {
  if (Math.abs(score) < 9000 || Math.abs(score) === 10000) return null;
  return score > 0 ? 10000 - score : -(10000 + score);
}

// Position key used by the openings book: board, side to move, castling, en passant.
export const epd = (fen) => fen.split(" ").slice(0, 4).join(" ");

// The engine's line, converted from UCI to readable moves.
export function lineToSan(fen, uciMoves, max = 6) {
  if (!uciMoves || !uciMoves.length) return [];
  const g = new Chess(fen);
  const out = [];
  for (const u of uciMoves.slice(0, max)) {
    const m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" });
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// Opening while the game is young or still in the book, endgame once
// most pieces are off, middlegame in between.
export function phaseOf(fen, ply, inBook) {
  const board = fen.split(" ")[0];
  let material = 0;
  let queens = 0;
  for (const ch of board) {
    const c = ch.toLowerCase();
    if (c === "q") { material += 9; queens++; }
    else if (c === "r") material += 5;
    else if (c === "b" || c === "n") material += 3;
  }
  if (material <= 18 || (queens === 0 && material <= 26)) return "endgame";
  if (inBook || ply <= 20) return "opening";
  return "middlegame";
}

export function classifyGame(moves, fens, evals, openings = null) {
  // Raw engine score of every position, from the side to move.
  const raw = fens.map((fen, k) => positionScore(fen, evals[k]));

  // Backward pass: a fixed-depth search can miss a tactic that it finds one
  // move later. When the move played was the engine's choice, trust the later,
  // deeper look at that line. A position is never worth less than the move
  // actually played from it.
  const refined = raw.slice();
  for (let j = moves.length - 1; j >= 0; j--) {
    // Mate scores count moves: stepping back from a lost position to the
    // winning side's turn adds one move to the mate.
    const next = refined[j + 1];
    const viaGame = -next - (next <= -9000 ? 1 : 0);
    refined[j] = uci(moves[j]) === evals[j].best ? viaGame : Math.max(raw[j], viaGame);
  }

  // The database names only some positions along a line, so every move up to
  // the last named position (within the first 40 moves) counts as book.
  let lastBook = -1;
  let opening = null;
  if (openings) {
    for (let i = 0; i < Math.min(moves.length, 80); i++) {
      const hit = openings[epd(fens[i + 1])];
      if (hit) { lastBook = i; opening = { eco: hit[0], name: hit[1] }; }
    }
  }

  const plies = [];
  for (let i = 0; i < moves.length; i++) {
    const mv = moves[i];
    const known = i <= lastBook;
    const before = evals[i];
    const scoreBefore = refined[i];
    const scoreAfter = -refined[i + 1]; // flip to the mover's side

    const winBefore = winChance(scoreBefore);
    const winAfter = winChance(scoreAfter);
    const drop = Math.max(0, winBefore - winAfter);
    const playedUci = uci(mv);
    // Best = the engine's move, or a move that turned out at least as strong
    // once the engine looked one move deeper.
    const isBest =
      (before.best && playedUci === before.best) || scoreAfter >= raw[i] + 30;

    let grade;
    if (isBest || drop < 0.5) {
      grade = isBest ? "best" : "excellent";
      // "Great": the only good move in a position that is still in the balance,
      // and not a forced reply (few legal moves) or a simple recapture.
      const pos = new Chess(fens[i]);
      const legalMoves = pos.moves().length;
      const prevMove = moves[i - 1];
      const recapture = prevMove && prevMove.captured && prevMove.to === mv.to;
      const onlyMove =
        before.second !== null &&
        winChance(before.score) - winChance(before.second) >= 25 &&
        winBefore >= 15 && winBefore <= 85 &&
        legalMoves >= 4 && !recapture && !pos.in_check();
      // "Brilliant": a real piece sacrifice that is the engine's move (or as good)
      // and leaves the position at least holding.
      if (isSacrifice(fens[i + 1], mv) && (isBest || drop < 2) && winAfter >= 45) {
        grade = "brilliant";
      } else if (isBest && onlyMove) {
        grade = "great";
      }
    } else if (drop < 2) grade = "excellent";
    else if (drop < 5) grade = "good";
    else if (drop < 10) grade = "inaccuracy";
    else if (drop < 20) grade = "mistake";
    else grade = "blunder";

    // Book: a known opening move that the engine has no objection to.
    if (known && grade !== "brilliant" && drop < 5) grade = "book";

    // A "miss": the opponent just gave something away and this move let it slip.
    const prev = plies[i - 1];
    if (
      prev &&
      (prev.grade === "mistake" || prev.grade === "blunder") &&
      (grade === "inaccuracy" || grade === "mistake") &&
      winBefore >= 60
    ) {
      grade = "miss";
    }

    plies.push({
      ply: i + 1,
      color: mv.color,
      san: mv.san,
      from: mv.from,
      to: mv.to,
      fenBefore: fens[i],
      fenAfter: fens[i + 1],
      grade,
      drop,
      accuracy: moveAccuracy(drop),
      bestUci: before.best,
      bestSan: isBest ? null : sanFromUci(fens[i], before.best),
      bestLine: lineToSan(fens[i], before.pv),
      bestScore: raw[i], // engine's best, from the mover's side, for practice mode
      phase: phaseOf(fens[i], i + 1, !!known),
      inBook: known,
      // White-perspective evaluation after the move, for the bar and graph.
      whiteScore: mv.color === "w" ? scoreAfter : -scoreAfter,
      mateIn: mateFromScore(refined[i + 1]),
      moverToMoveAfter: mv.color === "w" ? "b" : "w",
    });
  }

  const summary = { w: {}, b: {} };
  for (const g of GRADES) { summary.w[g.id] = 0; summary.b[g.id] = 0; }
  for (const p of plies) summary[p.color][p.grade]++;

  // Errors (inaccuracies and worse) and moves by game phase, per player.
  const phases = {};
  for (const c of ["w", "b"]) {
    phases[c] = { opening: { moves: 0, errors: 0 }, middlegame: { moves: 0, errors: 0 }, endgame: { moves: 0, errors: 0 } };
  }
  for (const p of plies) {
    const slot = phases[p.color][p.phase];
    slot.moves++;
    if (["inaccuracy", "mistake", "miss", "blunder"].includes(p.grade)) slot.errors++;
  }

  return {
    plies,
    summary,
    phases,
    opening,
    accuracy: {
      w: gameAccuracy(plies.filter((p) => p.color === "w").map((p) => p.accuracy)),
      b: gameAccuracy(plies.filter((p) => p.color === "b").map((p) => p.accuracy)),
    },
    startScore: refined[0] * (new Chess(fens[0]).turn() === "w" ? 1 : -1),
  };
}
