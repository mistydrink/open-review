// Draws the board as a single SVG: squares, last-move highlight, pieces,
// best-move arrow and the classification badge on the destination square.
import { GRADE } from "./review.js";

const NS = "http://www.w3.org/2000/svg";
const S = 40; // square size in SVG units (matches the piece sprite tiles)
const FILES = "abcdefgh";

let spriteLoaded = null;
export function loadPieces() {
  if (!spriteLoaded) {
    spriteLoaded = fetch("vendor/pieces-cburnett.svg")
      .then((r) => r.text())
      .then((text) => {
        const holder = document.createElement("div");
        holder.style.display = "none";
        holder.setAttribute("aria-hidden", "true");
        holder.innerHTML = text.replace(/<\?xml[^>]*>/, "");
        document.body.prepend(holder);
      });
  }
  return spriteLoaded;
}

function el(name, attrs = {}, parent) {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (parent) parent.appendChild(node);
  return node;
}

export class Board {
  constructor(svg) {
    this.svg = svg;
    this.flipped = false;
    svg.setAttribute("viewBox", `0 0 ${S * 8} ${S * 8}`);
  }

  xy(square) {
    let file = FILES.indexOf(square[0]);
    let rank = Number(square[1]) - 1;
    if (this.flipped) { file = 7 - file; rank = 7 - rank; }
    return { x: file * S, y: (7 - rank) * S };
  }

  draw(fen, ply) {
    const svg = this.svg;
    svg.replaceChildren();

    // arrow head definition
    const defs = el("defs", {}, svg);
    const marker = el("marker", {
      id: "arrowhead", markerWidth: "4", markerHeight: "4", refX: "2.2", refY: "2",
      orient: "auto", markerUnits: "strokeWidth",
    }, defs);
    el("path", { d: "M0,0 L4,2 L0,4 Z", fill: "#3f7d3a" }, marker);

    // squares + coordinates
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const light = (r + f) % 2 === 0;
        el("rect", { x: f * S, y: r * S, width: S, height: S, class: light ? "sq-light" : "sq-dark" }, svg);
      }
    }
    for (let i = 0; i < 8; i++) {
      const file = this.flipped ? FILES[7 - i] : FILES[i];
      const rank = this.flipped ? i + 1 : 8 - i;
      const fileLight = (7 + i) % 2 === 0;
      const t1 = el("text", { x: i * S + S - 2.5, y: S * 8 - 2.5, class: "coord " + (fileLight ? "on-light" : "on-dark"), "text-anchor": "end" }, svg);
      t1.textContent = file;
      const rankLight = i % 2 === 0;
      const t2 = el("text", { x: 2.5, y: i * S + 8.5, class: "coord " + (rankLight ? "on-light" : "on-dark") }, svg);
      t2.textContent = rank;
    }

    // last move highlight in the grade colour
    const grade = ply ? GRADE[ply.grade] : null;
    if (ply) {
      for (const sq of [ply.from, ply.to]) {
        const { x, y } = this.xy(sq);
        el("rect", { x, y, width: S, height: S, fill: grade.color, "fill-opacity": "0.42" }, svg);
      }
    }

    // pieces
    const rows = fen.split(" ")[0].split("/");
    rows.forEach((row, ri) => {
      let fi = 0;
      for (const ch of row) {
        if (/\d/.test(ch)) { fi += Number(ch); continue; }
        const color = ch === ch.toUpperCase() ? "w" : "b";
        const square = FILES[fi] + (8 - ri);
        const { x, y } = this.xy(square);
        el("use", { href: "#" + color + ch.toLowerCase(), x, y, width: S, height: S }, svg);
        fi++;
      }
    });

    // engine's preferred move, when the played move was not it
    if (ply && ply.bestUci && ply.bestSan) {
      const a = this.xy(ply.bestUci.slice(0, 2));
      const b = this.xy(ply.bestUci.slice(2, 4));
      const cx = S / 2;
      const dx = b.x - a.x, dy = b.y - a.y;
      const len = Math.hypot(dx, dy);
      const shorten = 9;
      el("line", {
        x1: a.x + cx, y1: a.y + cx,
        x2: b.x + cx - (dx / len) * shorten, y2: b.y + cx - (dy / len) * shorten,
        class: "best-arrow", "marker-end": "url(#arrowhead)",
      }, svg);
    }

    // badge on the destination square
    if (ply) {
      const { x, y } = this.xy(ply.to);
      const bx = Math.min(x + S - 3, S * 8 - 9.5);
      const by = Math.max(y + 3, 9.5);
      const g = el("g", { class: "badge" }, svg);
      el("circle", { cx: bx, cy: by, r: 8.5, fill: grade.color, stroke: "#fff", "stroke-width": 1.4 }, g);
      const t = el("text", { x: bx, y: by + 3.4, "text-anchor": "middle", class: "badge-text" }, g);
      t.textContent = grade.symbol;
    }
  }
}
