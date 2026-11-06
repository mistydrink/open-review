// Thin wrapper around the Stockfish 17.1 (lite, single-threaded) WebAssembly build.
// Runs in a Web Worker so analysis never freezes the page.
// One search runs at a time; live analysis (explore mode) can be stopped.

const ENGINE_URL = "engine/stockfish-17.1-lite-single-03e3232.js";

function parseInfo(line) {
  if (!line.startsWith("info") || !line.includes(" pv ")) return null;
  const pvIndex = Number((line.match(/ multipv (\d+)/) || [0, 1])[1]);
  const depth = Number((line.match(/ depth (\d+)/) || [0, 0])[1]);
  const mate = line.match(/ score mate (-?\d+)/);
  const cp = line.match(/ score cp (-?\d+)/);
  const pv = (line.match(/ pv (.+)$/) || [, ""])[1].trim().split(/\s+/).slice(0, 8);
  let score = 0;
  let mateIn = null;
  if (mate) {
    mateIn = Number(mate[1]);
    score = mateIn > 0 ? 10000 - mateIn : -10000 - mateIn;
  } else if (cp) {
    score = Number(cp[1]);
  }
  return { pvIndex, depth, score, mateIn, pv, move: pv[0] };
}

export class Engine {
  constructor() {
    this.worker = null;
    this.listeners = new Set();
    this.queue = Promise.resolve(); // serialises searches
    this.live = null; // the current stoppable search, if any
  }

  async start() {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      try {
        this.worker = new Worker(ENGINE_URL);
      } catch {
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
    })();
    this.ready.catch(() => { this.ready = null; this.worker = null; });
    return this.ready;
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

  // Run one search. onInfo (optional) gets the best line as it improves.
  // Scores are from the side to move, in centipawns; mates become large values.
  search(fen, depth, onInfo) {
    const run = () =>
      new Promise((resolve) => {
        const lines = { 1: null, 2: null };
        const fn = (line) => {
          const info = parseInfo(line);
          if (info) {
            lines[info.pvIndex] = info;
            if (onInfo && info.pvIndex === 1) onInfo(info);
            return;
          }
          if (line.startsWith("bestmove")) {
            this.listeners.delete(fn);
            this.live = null;
            const best = line.split(" ")[1];
            if (!lines[1]) {
              // Game-over position: no legal moves.
              resolve({ best: null, score: 0, mateIn: null, second: null, over: true, pv: [] });
              return;
            }
            resolve({
              best: best && best !== "(none)" ? best : lines[1].move,
              score: lines[1].score,
              mateIn: lines[1].mateIn,
              second: lines[2] ? lines[2].score : null,
              over: false,
              pv: lines[1].pv,
              depth: lines[1].depth,
            });
          }
        };
        this.listeners.add(fn);
        this.live = { stop: () => this.send("stop") };
        this.send("position fen " + fen);
        this.send("go depth " + depth);
      });
    const job = this.queue.then(run);
    this.queue = job.catch(() => {});
    return job;
  }

  analyse(fen, depth) {
    return this.search(fen, depth);
  }

  // Stop whatever is running; resolves once the engine is idle.
  async stop() {
    if (this.live) this.live.stop();
    await this.queue;
  }

  newGame() {
    const job = this.queue.then(() => {
      this.send("ucinewgame");
      this.send("isready");
      return this.waitFor("readyok");
    });
    this.queue = job.catch(() => {});
    return job;
  }
}
