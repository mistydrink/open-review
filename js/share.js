// Share links and annotated PGN downloads. Nothing is uploaded: a share link
// carries the whole review (game plus engine results) inside the URL itself.

import { GRADE } from "./review.js";

const b64url = (bytes) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64url = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

async function pipe(bytes, stream) {
  const out = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(out).arrayBuffer());
}

export async function encodeShare(data) {
  const json = new TextEncoder().encode(JSON.stringify(data));
  if ("CompressionStream" in window) {
    return "z" + b64url(await pipe(json, new CompressionStream("deflate-raw")));
  }
  return "j" + b64url(json);
}

export async function decodeShare(token) {
  const kind = token[0];
  let bytes = unb64url(token.slice(1));
  if (kind === "z") bytes = await pipe(bytes, new DecompressionStream("deflate-raw"));
  return JSON.parse(new TextDecoder().decode(bytes));
}

// Standard PGN annotation glyphs, readable by any chess program.
const NAG = { brilliant: "$3", great: "$1", inaccuracy: "$6", mistake: "$2", miss: "$2", blunder: "$4" };

function evalComment(ply) {
  if (ply.mateIn !== null && ply.mateIn !== undefined) {
    const whiteMates = (ply.moverToMoveAfter === "w") === ply.mateIn > 0;
    return `#${whiteMates ? "" : "-"}${Math.abs(ply.mateIn)}`;
  }
  return (ply.whiteScore / 100).toFixed(2);
}

export function annotatedPgn(headers, review) {
  const tags = { ...headers };
  tags.Annotator = "Open Review (Stockfish 17)";
  if (review.opening) { tags.ECO = review.opening.eco; tags.Opening = review.opening.name; }
  const order = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
  const keys = [...order.filter((k) => k in tags), ...Object.keys(tags).filter((k) => !order.includes(k))];
  const head = keys.map((k) => `[${k} "${String(tags[k] || "?").replace(/"/g, "'")}"]`).join("\n");

  const parts = [];
  if (review.accuracy.w !== null) {
    parts.push(`{ Accuracy: White ${review.accuracy.w.toFixed(1)}, Black ${review.accuracy.b.toFixed(1)} }`);
  }
  for (const p of review.plies) {
    const n = Math.ceil(p.ply / 2);
    if (p.color === "w") parts.push(`${n}.`);
    else if (p === review.plies[0] || parts[parts.length - 1].startsWith("{")) parts.push(`${n}...`);
    parts.push(p.san + (NAG[p.grade] ? " " + NAG[p.grade] : ""));
    let note = `[%eval ${evalComment(p)}] ${GRADE[p.grade].label}.`;
    if (p.bestSan && p.grade !== "book") note += ` Best was ${p.bestSan}.`;
    parts.push(`{ ${note} }`);
  }
  parts.push(headers.Result || "*");

  // wrap movetext at ~80 characters
  const lines = [];
  let line = "";
  for (const tok of parts.join(" ").split(" ")) {
    if ((line + " " + tok).trim().length > 80) { lines.push(line.trim()); line = tok; }
    else line += " " + tok;
  }
  if (line.trim()) lines.push(line.trim());
  return head + "\n\n" + lines.join("\n") + "\n";
}

export function download(filename, text) {
  const blob = new Blob([text], { type: "application/x-chess-pgn" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
