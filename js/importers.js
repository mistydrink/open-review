// Fetch a player's recent games from the public Chess.com and Lichess APIs.
// Both APIs are free, need no account, and allow requests from the browser.

const LIMIT = 20;

function resultFor(color, white, black, winner) {
  if (!winner) return "draw";
  return winner === color ? "win" : "loss";
}

export async function fetchChessCom(username) {
  const user = username.trim().toLowerCase();
  const res = await fetch(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
  if (res.status === 404) throw new Error(`No Chess.com player called "${username}".`);
  if (!res.ok) throw new Error("Chess.com didn't respond. Try again in a minute.");
  const { archives = [] } = await res.json();
  const games = [];
  // Archives are monthly, oldest first; read back from the newest month.
  for (const url of archives.slice().reverse()) {
    if (games.length >= LIMIT) break;
    const r = await fetch(url);
    if (!r.ok) break;
    const month = await r.json();
    const list = (month.games || []).filter((g) => g.rules === "chess" && g.pgn).reverse();
    for (const g of list) {
      if (games.length >= LIMIT) break;
      const youWhite = g.white.username.toLowerCase() === user;
      const color = youWhite ? "w" : "b";
      const winner = g.white.result === "win" ? "w" : g.black.result === "win" ? "b" : null;
      games.push({
        source: "Chess.com",
        pgn: g.pgn,
        white: g.white.username,
        black: g.black.username,
        whiteRating: g.white.rating,
        blackRating: g.black.rating,
        you: youWhite ? g.white.username : g.black.username,
        youColor: color,
        opponent: youWhite ? g.black.username : g.white.username,
        outcome: resultFor(color, g.white, g.black, winner),
        speed: g.time_class,
        date: new Date(g.end_time * 1000),
      });
    }
  }
  if (!games.length) throw new Error(`No standard chess games found for "${username}".`);
  return games;
}

export async function fetchLichess(username) {
  const user = username.trim();
  const res = await fetch(
    `https://lichess.org/api/games/user/${encodeURIComponent(user)}?max=${LIMIT}&pgnInJson=true&opening=true&clocks=false&evals=false`,
    { headers: { Accept: "application/x-ndjson" } }
  );
  if (res.status === 404) throw new Error(`No Lichess player called "${username}".`);
  if (res.status === 429) throw new Error("Lichess asked us to slow down. Wait a minute, then try again.");
  if (!res.ok) throw new Error("Lichess didn't respond. Try again in a minute.");
  const text = await res.text();
  const games = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    const g = JSON.parse(line);
    if (g.variant !== "standard" || !g.pgn) continue;
    const w = g.players.white, b = g.players.black;
    const wName = (w.user && w.user.name) || (w.aiLevel ? `Stockfish level ${w.aiLevel}` : "Anonymous");
    const bName = (b.user && b.user.name) || (b.aiLevel ? `Stockfish level ${b.aiLevel}` : "Anonymous");
    const youWhite = wName.toLowerCase() === user.toLowerCase();
    const color = youWhite ? "w" : "b";
    const winner = g.winner === "white" ? "w" : g.winner === "black" ? "b" : null;
    games.push({
      source: "Lichess",
      pgn: g.pgn,
      white: wName,
      black: bName,
      whiteRating: w.rating,
      blackRating: b.rating,
      you: youWhite ? wName : bName,
      youColor: color,
      opponent: youWhite ? bName : wName,
      outcome: resultFor(color, w, b, winner),
      speed: g.speed,
      date: new Date(g.lastMoveAt || g.createdAt),
    });
  }
  if (!games.length) throw new Error(`No standard chess games found for "${username}".`);
  return games;
}
