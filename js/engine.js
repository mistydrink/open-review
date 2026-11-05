// Thin wrapper around the Stockfish 17.1 (lite, single-threaded) WebAssembly build.
// Runs in a Web Worker so analysis never freezes the page.

const ENGINE_URL = "engine/stockfish-17.1-lite-single-03e3232.js";

export class Engine {
  constructor() {
    this.worker = null;
    this.listeners = new Set();
  }

  async start() {
    if (this.worker) return;
    try {
      this.worker = new Worker(ENGINE_URL);
    } catch (err) {
      throw new Error("ENGINE_BLOCKED");
    }
    this.worker.onmessage = (e) => {
      const line = typeof e.data === "string" ? e.data : "";
      for (const fn of this.listeners) fn(line);
    };
    const failed = new Promise((_, reject) => {
      this.worker.onerror = () => reject(new Error("ENGINE_BLOCKED"));
    });
    this.send("uci");
    await Promise.race([this.waitFor("uciok"), failed]);
    this.send("setoption name MultiPV value 2");
    this.send("isready");
    await Promise.race([this.waitFor("readyok"), failed]);
  }

  send(cmd) {
    this.worker.postMessage(cmd);
  }

  waitFor(token) {
    return new Promise((resolve) => {
      const fn = (line) => {
        if (line.startsWith(token)) {
          this.listeners.delete(fn);
          resolve(line);
        }
      };
      this.listeners.add(fn);
    });
  }

  // Analyse one position. Scores are from the side to move, in centipawns
  // (mate scores are converted to large centipawn values).
  analyse(fen, depth) {
    return new Promise((resolve) => {
      const lines = { 1: null, 2: null };
      const fn = (line) => {
        if (line.startsWith("info") && line.includes(" pv ")) {
          const pvIndex = Number((line.match(/ multipv (\d+)/) || [0, 1])[1]);
          const mate = line.match(/ score mate (-?\d+)/);
          const cp = line.match(/ score cp (-?\d+)/);
          const move = (line.match(/ pv (\S+)/) || [])[1];
          let score = 0;
          let mateIn = null;
          if (mate) {
            mateIn = Number(mate[1]);
            score = mateIn > 0 ? 10000 - mateIn : -10000 - mateIn;
          } else if (cp) {
            score = Number(cp[1]);
          }
          lines[pvIndex] = { score, mateIn, move };
        } else if (line.startsWith("bestmove")) {
          this.listeners.delete(fn);
          const best = line.split(" ")[1];
          if (!lines[1]) {
            // Game-over position: no legal moves. Stockfish reports mate 0 or a draw.
            resolve({ best: null, score: 0, mateIn: null, second: null, over: true });
            return;
          }
          resolve({
            best: best && best !== "(none)" ? best : lines[1].move,
            score: lines[1].score,
            mateIn: lines[1].mateIn,
            second: lines[2] ? lines[2].score : null,
            over: false,
          });
        }
      };
      this.listeners.add(fn);
      this.send("position fen " + fen);
      this.send("go depth " + depth);
    });
  }

  newGame() {
    this.send("ucinewgame");
    this.send("isready");
    return this.waitFor("readyok");
  }
}
