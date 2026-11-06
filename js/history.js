// Saved reviews, kept in this browser's local storage.
// Each entry stores the PGN plus the engine's raw results, so a past review
// reopens instantly without running Stockfish again. (A cookie holds at most
// about 4 KB, too little for even one game, so cookies are only used for
// small preferences.)

const KEY = "openreview.history.v1";
const MAX = 50;

function read() {
  try {
    const list = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function write(list) {
  // If storage is full, drop the oldest reviews until it fits.
  for (let n = list.length; n >= 0; n--) {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.slice(0, n)));
      return true;
    } catch {
      /* try again with fewer entries */
    }
  }
  return false;
}

function hash(text) {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function listReviews() {
  return read();
}

export function getReview(id) {
  return read().find((r) => r.id === id) || null;
}

// evals: engine results per position; packed into arrays to save space.
export function saveReview({ pgn, headers, depth, review, evals, you = null }) {
  const plies = review.plies.length;
  const accuracy = review.accuracy;
  const key = hash(pgn.replace(/\s+/g, " ").trim()) + "-" + depth;
  const entry = {
    id: key + "-" + Date.now().toString(36),
    key,
    savedAt: new Date().toISOString(),
    white: headers.White && headers.White !== "?" ? headers.White : "White",
    black: headers.Black && headers.Black !== "?" ? headers.Black : "Black",
    result: headers.Result && headers.Result !== "*" ? headers.Result : "",
    depth,
    plies,
    accW: accuracy.w,
    accB: accuracy.b,
    pgn,
    evals: evals.map((e) => [e.best, e.score, e.mateIn, e.second, e.over ? 1 : 0, (e.pv || []).slice(0, 6).join(" ")]),
    // summary used by Insights, so it doesn't have to re-grade every game
    stats: statsOf(review),
    you, // set when the game was imported by username: { name, color }
    gameDate: headers.Date && !headers.Date.includes("?") ? headers.Date.replace(/\./g, "-") : null,
  };
  const list = read().filter((r) => r.key !== key); // re-reviewing replaces the old copy
  list.unshift(entry);
  write(list.slice(0, MAX));
  return entry;
}

export function statsOf(review) {
  return {
    opening: review.opening ? review.opening.name : null,
    counts: review.summary,
    phases: review.phases,
  };
}

export function unpackEvals(packed) {
  return packed.map(([best, score, mateIn, second, over, pv]) => ({
    best, score, mateIn, second, over: !!over, pv: pv ? pv.split(" ") : [],
  }));
}

export function updateStats(id, stats) {
  const list = read();
  const r = list.find((x) => x.id === id);
  if (r) { r.stats = stats; write(list); }
}

export function deleteReview(id) {
  write(read().filter((r) => r.id !== id));
}

export function clearReviews() {
  try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}
