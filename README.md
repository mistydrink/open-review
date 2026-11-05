# Open Review

Free chess game review in your browser. Paste a PGN and Stockfish 17 grades every move, from **Brilliant** to **Blunder**, with accuracy scores, an evaluation graph and the engine's preferred move drawn on the board.

The big chess sites charge for full game review, but the engine underneath, Stockfish, is free and open source. Open Review runs that same engine on your own computer, so the review costs nothing and your games never leave the page.

**Live site:** https://mistydrink.github.io/open-review/

## Run locally

The engine runs in a Web Worker, which browsers block on `file://` pages, so serve the folder:

```
python -m http.server 8000
```

## How moves are graded

Each position is analysed by Stockfish (two best lines per position). Scores are turned into a win chance for the player to move, using the curve Lichess publishes for its accuracy metric, and each move is graded by how much win chance it gave away compared with the engine's best move.

| Grade | When |
|---|---|
| Brilliant | A real piece sacrifice that is the engine's move and keeps the position at least level |
| Great | The only good move in a balanced position (the next best loses 25%+ win chance) |
| Best | The engine's first choice |
| Excellent | Within 2% win chance of the best move |
| Good | Within 5% |
| Inaccuracy | Loses 5–10% |
| Mistake | Loses 10–20% |
| Miss | Fails to punish the opponent's mistake or blunder |
| Blunder | Loses 20% or more |

Grade names follow the ones Chess.com players already know, so the review reads familiarly. This project is not affiliated with Chess.com.

Accuracy uses the published Lichess per-move formula, averaged with an arithmetic and a harmonic mean so one blunder still shows.

A fixed-depth search can miss a tactic one move early and spot it a move later. When a player's move matches the engine, the review trusts the engine's later, deeper look at that line, which keeps sacrifices like Morphy's 16. Qb8+ from being marked as blunders.

## Project layout

```
index.html          page structure
css/style.css       design
js/app.js           page logic: import, review loop, board, graph, scoresheet
js/engine.js        Stockfish Web Worker wrapper (UCI)
js/review.js        grading and accuracy
js/board.js         SVG board, best-move arrow, grade badge
js/sample.js        sample games
engine/             Stockfish 17.1 lite, single-threaded WebAssembly build
vendor/             chess.js, Cburnett pieces, Archivo font
```

## Credits and licences

- [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js), GPLv3. This project is released under GPLv3 too (see `LICENSE`).
- [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa, BSD 2-Clause (`vendor/chess.js.LICENSE`).
- Chess pieces by Cburnett, CC BY-SA 3.0, via [cm-chessboard](https://github.com/shaack/cm-chessboard).
- [Archivo](https://fonts.google.com/specimen/Archivo) by Omnibus-Type, SIL Open Font License (`vendor/fonts/OFL.txt`).
