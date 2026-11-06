# Open Review

Free chess game review in your browser. Paste a PGN and Stockfish 17 grades every move, from **Brilliant** to **Blunder**, with accuracy scores, an evaluation graph and the engine's preferred move drawn on the board.

The big chess sites charge for full game review, but the engine underneath, Stockfish, is free and open source. Open Review runs that same engine on your own computer, so the review costs nothing and your games never leave the page.

**Live site:** https://mistydrink.github.io/open-review/

## Features

- **Import by username** from Chess.com or Lichess using their free public APIs, then pick one of your last 20 games. The board turns to your side, and practice and insights follow your moves.
- **Explore any position.** Click a piece and a square to try your own moves, with Stockfish showing a live evaluation and its best line. "Back to game" returns to the review.
- **Practice your mistakes.** Every mistake, miss and blunder becomes a puzzle from the position before it. Stockfish checks your answer.
- **Engine lines.** The coach line shows the engine's whole plan, not just one move.
- **Openings and book moves** from the Lichess openings database (CC0).
- **Insights** across saved reviews: record, average accuracy, blunders per game, accuracy by game, errors per 10 moves by phase, and results by opening.
- **Share links** that carry the whole review in the URL, so they open instantly with no server. **Download** the game as PGN with grades and evaluations as comments.
- **Works offline** and can be installed as an app. A service worker caches the site, the engine and the openings book.
- Dark and light themes, remembered with a small first-party cookie (`or_theme`). The analysis depth and last usernames are remembered the same way.
- Past reviews are saved in this browser's local storage (cookies are too small to hold a game) and reopen without re-running Stockfish. Up to 50 are kept.
- The layout sizes the board to the window, so a review fits on one laptop screen.
- Two fixed ad slots beside the board on wide screens. No pop-ups, overlays or autoplay. They show a placeholder until an ad network is set up in `js/ads.js`. Ad networks set their own cookies, so check their consent rules for your region before switching ads on.

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
js/history.js       saved reviews (local storage)
js/prefs.js         theme and depth cookies
js/ads.js           side ad slots
js/importers.js     Chess.com and Lichess game import
js/share.js         share links and annotated PGN export
js/insights.js      stats across saved reviews
sw.js               offline cache
data/openings.json  openings book built from lichess-org/chess-openings
engine/             Stockfish 17.1 lite, single-threaded WebAssembly build
vendor/             chess.js, Cburnett pieces, Archivo font
```

## Credits and licences

- [Stockfish](https://stockfishchess.org) via [stockfish.js](https://github.com/nmrugg/stockfish.js), GPLv3. This project is released under GPLv3 too (see `LICENSE`).
- [chess.js](https://github.com/jhlywa/chess.js) by Jeff Hlywa, BSD 2-Clause (`vendor/chess.js.LICENSE`).
- Chess pieces by Cburnett, CC BY-SA 3.0, via [cm-chessboard](https://github.com/shaack/cm-chessboard).
- Opening names from [lichess-org/chess-openings](https://github.com/lichess-org/chess-openings), CC0 (`data/openings.LICENSE`).
- [Archivo](https://fonts.google.com/specimen/Archivo) by Omnibus-Type, SIL Open Font License (`vendor/fonts/OFL.txt`).
