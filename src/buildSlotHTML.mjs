/**
 * Slot GDD Factory · build standalone playable slot HTML — BASE GAME ONLY.
 *
 * Static grid render. No animations, no spin/bet/autoplay controls,
 * no HUD, no footer. Grid is centered in the viewport with reference-grade
 * dimensions (frame inset, gap, cell radius, shadows, palette) extracted
 * from an industry reference base game.
 *
 * Dimensions reference (vendor-neutral):
 *   • Frame:        min(1200px, 82vw) × min(732px, 82vw·0.61)  — 1.64:1
 *   • Frame inset:  18px from frame edge to first cell
 *   • Cell gap:     6px between cells
 *   • Cell radius:  10px
 *   • Frame radius: 16px
 *   • Shadow:       0 20px 60px rgba(0,0,0,.5), inset 0 0 80px rgba(0,0,0,.3)
 *
 * Palette tokens (from theme.palette[] override these if present):
 *   --bg0  #05070c   deep blue-black
 *   --bg1  #0b0f16   mid background
 *   --gold #c9a227   primary accent
 *   --text #f2f2f2   default text
 *
 * Same module is consumed by app.js (browser tab) and tests (Node + Playwright).
 */
import { buildGridShape } from './gridShape.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* Build the base-game-only standalone HTML for a parsed model. */
export function buildSlotHTML(model) {
  const allSyms = [
    ...model.symbols.specials, ...model.symbols.high,
    ...model.symbols.mid, ...model.symbols.low,
  ];
  /* Fallback if GDD declared no symbols */
  const pool = allSyms.length > 0 ? allSyms : [
    { id: "W", name: "Wild" }, { id: "S", name: "Scatter" },
    { id: "A", name: "Ace" }, { id: "K", name: "King" }, { id: "Q", name: "Queen" },
    { id: "J", name: "Jack" }, { id: "T", name: "Ten" }, { id: "9", name: "Nine" },
  ];
  const shape = buildGridShape(model);
  const reels = shape.reels;
  const rows  = shape.rows;

  /* Palette — use GDD palette[] if available, else reference defaults */
  const p = model.theme.palette || [];
  const bg0    = p[0] || "#05070c";   // deep background
  const bg1    = p[1] || "#0b0f16";   // mid background
  const accent = p[2] || "#c9a227";   // primary accent (gold)
  const text   = "#f2f2f2";

  const layoutSub = `${shape.shapeNote}${shape.paylines ? ` · ${shape.paylines} lines` : ''}${shape.wayCount ? ` · ${shape.wayCount} ways` : ''}`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>${escapeHtml(model.name)} · Base Game</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg0: ${bg0};
  --bg1: ${bg1};
  --accent: ${accent};
  --text: ${text};
  --frame-inset: 18px;
  --cell-gap: 6px;
  --cell-radius: 10px;
  --frame-radius: 16px;
  --frame-shadow: 0 20px 60px rgba(0,0,0,0.55), inset 0 0 80px rgba(0,0,0,0.35);
}
html, body { width: 100%; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  background: radial-gradient(ellipse at center, var(--bg1) 0%, var(--bg0) 80%);
  color: var(--text);
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.stage {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "play"
    "hub";
  width: 100%;
  height: 100vh;
  max-width: 1280px;
  padding: 12px 16px 12px;
  gap: 10px;
}
.header { grid-area: header; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.title {
  color: var(--accent);
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
}
.sub {
  color: var(--text);
  opacity: 0.5;
  font-size: 0.7rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
/* Play area = frame + side spin column. Stage grid resizes frame to
   exactly fill the remaining vertical and horizontal space. */
.play {
  grid-area: play;
  display: grid;
  grid-template-columns: 1fr 84px;
  gap: 14px;
  align-items: stretch;
  min-height: 0;
}
.frame {
  position: relative;
  background: rgba(0, 0, 0, 0.18);
  border: 1px solid rgba(201, 162, 39, 0.25);
  border-radius: var(--frame-radius);
  box-shadow: var(--frame-shadow);
  padding: var(--frame-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}
/* Side controls — vertical SPIN button column on the right of the frame */
.sideHud {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
}
.spinBtn {
  width: 76px;
  height: 76px;
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: radial-gradient(circle at 30% 30%, #f3d27a 0%, var(--accent) 60%, #6d520f 100%);
  box-shadow:
    0 0 22px rgba(201, 162, 39, 0.55),
    inset 0 2px 6px rgba(255, 230, 168, 0.4),
    inset 0 -3px 8px rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  color: #1a1206;
  transition: transform .15s ease, box-shadow .2s ease;
}
.spinBtn:hover { transform: scale(1.04); box-shadow: 0 0 30px rgba(201, 162, 39, 0.75), inset 0 2px 6px rgba(255, 230, 168, 0.5), inset 0 -3px 8px rgba(0, 0, 0, 0.5); }
.spinBtn svg { width: 32px; height: 32px; fill: #1a1206; }
.autoBtn {
  width: 50px;
  height: 50px;
  border-radius: 50%;
  border: 1px solid rgba(201, 162, 39, 0.4);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.08), 0 2px 6px rgba(0, 0, 0, 0.4);
}
.autoBtn svg { width: 22px; height: 22px; }
/* Bottom bar — BAL | STATUS | BET-/BET/BET+ | SOUND */
.hub {
  grid-area: hub;
  display: grid;
  grid-template-columns: 36px 1fr 1.4fr 1fr 36px;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.7), rgba(10, 8, 6, 0.85));
  border: 1px solid rgba(201, 162, 39, 0.22);
  border-radius: 14px;
  box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.05), 0 4px 14px rgba(0, 0, 0, 0.45);
}
.iconBtn {
  width: 36px; height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.25);
  background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  cursor: pointer;
}
.iconBtn svg { width: 18px; height: 18px; }
.statBox {
  display: flex; flex-direction: column; align-items: center;
  padding: 4px 12px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.22);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.08), 0 2px 6px rgba(0, 0, 0, 0.4);
  min-width: 0;
}
.statBox__label {
  font-size: 0.55rem; letter-spacing: 2px;
  color: var(--accent); opacity: 0.75;
  text-transform: uppercase;
}
.statBox__value {
  font-size: 1.05rem; font-weight: 800;
  color: #ffe6a8;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.statBox--status .statBox__value { font-size: 0.95rem; letter-spacing: 1.5px; }
.betGroup {
  display: grid;
  grid-template-columns: 32px 1fr 32px;
  gap: 6px;
  align-items: stretch;
}
.betStep {
  width: 32px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.3);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  color: var(--accent);
  font-size: 1rem; font-weight: 800;
  cursor: pointer;
}
.gridHost {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.grid-rect  { display: grid; gap: var(--cell-gap); }
.grid-vrl   { display: flex; gap: var(--cell-gap); align-items: center; height: 100%; }
.col        { display: flex; flex-direction: column; gap: var(--cell-gap); height: 100%; justify-content: center; }
.grid-hex   { position: relative; }
.grid-wheel { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.grid-plinko{ display: flex; flex-direction: column; align-items: center; gap: 4px; }
.plinko-row { display: flex; gap: 18px; }
.peg        { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); opacity: 0.85; }
.grid-crash { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.crash-curve{ width: 80%; max-width: 520px; height: 60%; max-height: 280px; }
.grid-slingo{ display: flex; flex-direction: column; gap: 12px; align-items: center; }
.cell {
  background: linear-gradient(180deg, #1a2230 0%, #131922 100%);
  border: 1px solid rgba(201, 162, 39, 0.28);
  border-radius: var(--cell-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(0.9rem, 1.4vw, 1.8rem);
  font-weight: 800;
  color: var(--accent);
  text-shadow: 0 1px 2px rgba(0,0,0,0.6);
  box-shadow:
    inset 0 1px 0 rgba(255, 230, 168, 0.06),
    inset 0 -1px 0 rgba(0, 0, 0, 0.4),
    0 1px 3px rgba(0, 0, 0, 0.5);
}
.cell.lockable {
  box-shadow:
    inset 0 0 0 2px rgba(255, 215, 88, 0.35),
    inset 0 1px 0 rgba(255, 230, 168, 0.08),
    0 1px 3px rgba(0, 0, 0, 0.5);
}
.cell.hex {
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  position: absolute;
  border: none;
  background: linear-gradient(180deg, #1a2230 0%, #131922 100%);
}
.cell.hex::before {
  content: "";
  position: absolute;
  inset: 2px;
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  border: 1px solid rgba(201, 162, 39, 0.4);
  pointer-events: none;
}
.wheel-svg { width: 80%; max-width: 480px; aspect-ratio: 1 / 1; }
.grow-tag {
  position: absolute;
  top: 10px;
  right: 14px;
  font-size: 0.6rem;
  color: var(--accent);
  border: 1px dashed var(--accent);
  border-radius: 12px;
  padding: 2px 8px;
  background: rgba(0, 0, 0, 0.5);
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
</style></head><body>

<div class="stage">
  <div class="header">
    <div class="title">${escapeHtml(model.name)}</div>
    <div class="sub">${escapeHtml(layoutSub)}</div>
  </div>
  <div class="play">
    <div class="frame" id="frameHost">
      <div class="gridHost" id="gridHost" data-kind="${shape.kind}"></div>
    </div>
    <aside class="sideHud" aria-label="Game Controls">
      <button class="spinBtn" id="spinBtn" aria-label="Spin" type="button">
        <svg viewBox="0 0 24 24"><path d="M13 2L4.5 14H11L10 22L18.5 9H12L13 2Z"/></svg>
      </button>
      <button class="autoBtn" id="autoBtn" aria-label="Auto" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
      </button>
    </aside>
  </div>
  <div class="hub">
    <button class="iconBtn" aria-label="Menu" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
    <div class="statBox statBox--balance">
      <div class="statBox__label">BAL</div>
      <div class="statBox__value" id="bal">1000.00</div>
    </div>
    <div class="statBox statBox--status">
      <div class="statBox__label">STATUS</div>
      <div class="statBox__value" id="status">PRESS SPIN</div>
    </div>
    <div class="betGroup">
      <button class="betStep" aria-label="bet -" type="button">−</button>
      <div class="statBox statBox--bet">
        <div class="statBox__label">BET</div>
        <div class="statBox__value" id="bet">1.00</div>
      </div>
      <button class="betStep" aria-label="bet +" type="button">+</button>
    </div>
    <button class="iconBtn" aria-label="Sound" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    </button>
  </div>
</div>

<script>
  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const SHAPE = ${JSON.stringify(shape)};
  const REELS = SHAPE.reels;
  const ROWS  = SHAPE.rows;

  const grid = document.getElementById("gridHost");
  const frame = document.getElementById("frameHost");

  /* Deterministic symbol fill — repeatable layout per fixture for snapshots */
  function symAt(i) { return POOL[i % POOL.length]; }

  function makeCell(text, extraClass = "") {
    const el = document.createElement("div");
    el.className = "cell" + (extraClass ? " " + extraClass : "");
    el.textContent = text || "?";
    return el;
  }

  /* Compute the side length so a (cols x rowsCount) grid of square cells
     with the given gap between them fits inside frame inner box. The grid is
     centered automatically by .gridHost flex layout. */
  function cellSize(cols, rowsCount, gap = 6) {
    /* frame already has padding=var(--frame-inset); use clientWidth/Height
       which exclude padding. */
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const cellW = (innerW - gap * Math.max(0, cols - 1)) / cols;
    const cellH = (innerH - gap * Math.max(0, rowsCount - 1)) / rowsCount;
    return Math.max(20, Math.floor(Math.min(cellW, cellH)));
  }

  function renderRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        host.appendChild(makeCell(symAt(idx), SHAPE.kind === "lock_respin" ? "lockable" : ""));
        idx++;
      }
    }
    if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
      const tag = document.createElement("div");
      tag.className = "grow-tag";
      tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
      frame.appendChild(tag);
    }
    grid.appendChild(host);
  }

  function renderVariableReel() {
    const host = document.createElement("div");
    host.className = "grid-vrl";
    const maxRows = Math.max(...SHAPE.columns.map(c => c.rows));
    const side = cellSize(SHAPE.columns.length, maxRows);
    let idx = 0;
    for (let c = 0; c < SHAPE.columns.length; c++) {
      const colEl = document.createElement("div");
      colEl.className = "col";
      const colRows = SHAPE.columns[c].rows;
      for (let r = 0; r < colRows; r++) {
        const cell = makeCell(symAt(idx));
        cell.style.width = side + "px";
        cell.style.height = side + "px";
        colEl.appendChild(cell);
        idx++;
      }
      host.appendChild(colEl);
    }
    grid.appendChild(host);
  }

  function renderMaskedRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
        const enabled = colMask ? colMask[r] : true;
        if (enabled) {
          host.appendChild(makeCell(symAt(idx)));
          idx++;
        } else {
          const blank = document.createElement("div");
          blank.style.cssText = "width:" + side + "px;height:" + side + "px;opacity:0.02";
          host.appendChild(blank);
        }
      }
    }
    grid.appendChild(host);
  }

  function renderHex() {
    const host = document.createElement("div");
    host.className = "grid-hex";
    const ring = Math.floor((SHAPE.columns.length - 1) / 2);
    /* tile size derived from frame dimensions */
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const dim = ring * 2 + 1;
    const size = Math.min(innerW / (dim * 1.05), innerH / (dim * 0.9));
    const w = size, h = size * 0.85;
    host.style.width  = (dim * w * 1.05 + 20) + "px";
    host.style.height = (dim * h + 20) + "px";
    SHAPE.cells.forEach((c, i) => {
      const q = c.hex ? c.hex.q : 0;
      const r = c.hex ? c.hex.r : 0;
      const x = (q + ring) * w * 1.0 + (r % 2 ? w * 0.5 : 0) + 10;
      const y = (r + ring) * h + 10;
      const el = makeCell(symAt(i), "hex");
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.width = w + "px";
      el.style.height = (h * 1.15) + "px";
      host.appendChild(el);
    });
    grid.appendChild(host);
  }

  function renderWheel() {
    const host = document.createElement("div");
    host.className = "grid-wheel";
    const segments = SHAPE.cells.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wheel-svg");
    svg.setAttribute("viewBox", "-100 -100 200 200");
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / segments) * 2 * Math.PI - Math.PI / 2;
      const x0 = Math.cos(a0) * 92, y0 = Math.sin(a0) * 92;
      const x1 = Math.cos(a1) * 92, y1 = Math.sin(a1) * 92;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M 0 0 L " + x0.toFixed(2) + " " + y0.toFixed(2) + " A 92 92 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + " Z");
      path.setAttribute("fill", i % 2 ? "#1a2230" : "#0f1620");
      path.setAttribute("stroke", "${accent}");
      path.setAttribute("stroke-width", "0.5");
      svg.appendChild(path);
      const mid = (a0 + a1) / 2;
      const tx = Math.cos(mid) * 62, ty = Math.sin(mid) * 62;
      const tEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tEl.setAttribute("x", tx.toFixed(2)); tEl.setAttribute("y", ty.toFixed(2));
      tEl.setAttribute("text-anchor", "middle"); tEl.setAttribute("dominant-baseline", "middle");
      tEl.setAttribute("fill", "${accent}");
      tEl.setAttribute("font-size", "8");
      tEl.setAttribute("font-weight", "700");
      tEl.textContent = String(symAt(i) || (i + 1));
      svg.appendChild(tEl);
    }
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderPlinko() {
    const host = document.createElement("div");
    host.className = "grid-plinko";
    let idx = 0;
    for (let r = 0; r < SHAPE.columns.length; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "plinko-row";
      const pegCount = SHAPE.columns[r].rows;
      for (let c = 0; c < pegCount; c++) {
        const peg = document.createElement("div");
        peg.className = "peg";
        rowEl.appendChild(peg);
        idx++;
      }
      host.appendChild(rowEl);
    }
    grid.appendChild(host);
  }

  function renderCrash() {
    const host = document.createElement("div");
    host.className = "grid-crash";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "crash-curve");
    svg.setAttribute("viewBox", "0 0 320 180");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = "M 0 180";
    for (let x = 0; x <= 320; x += 6) {
      const y = 180 - Math.pow(x / 320, 2) * 160 * 0.85;
      d += " L " + x + " " + y.toFixed(1);
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke", "${accent}");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", "240"); txt.setAttribute("y", "40");
    txt.setAttribute("fill", "${accent}");
    txt.setAttribute("font-size", "24"); txt.setAttribute("font-weight", "800");
    txt.textContent = "1.00x";
    svg.appendChild(txt);
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderSlingo() {
    const host = document.createElement("div");
    host.className = "grid-slingo";
    const innerH = grid.clientHeight || frame.clientHeight;
    /* board takes 5 rows, strip is 1 row; reserve 6 row-units total with gap */
    const totalRows = 6 + 0.4; /* small visual separator */
    const side = (innerH - 12 - 6 * 5) / totalRows;
    const board = document.createElement("div");
    board.className = "grid-rect";
    board.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    board.style.gridTemplateRows = "repeat(5, " + side + "px)";
    for (let i = 0; i < 25; i++) board.appendChild(makeCell(symAt(i)));
    host.appendChild(board);
    const strip = document.createElement("div");
    strip.className = "grid-rect";
    strip.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    strip.style.gridTemplateRows = side + "px";
    strip.style.borderTop = "1px dashed var(--accent)";
    strip.style.paddingTop = "10px";
    for (let i = 25; i < 30; i++) strip.appendChild(makeCell(symAt(i)));
    host.appendChild(strip);
    grid.appendChild(host);
  }

  function renderDual() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:20px;align-items:center;width:100%;height:100%;justify-content:center";
    const sgRowsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].rows : ROWS;
    const sgReelsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].reels : REELS;
    const innerW = (grid.clientWidth || frame.clientWidth) - 30;
    const innerH = grid.clientHeight || frame.clientHeight;
    const gap = 4;
    /* Compute each side's max cell so it fits entirely in the available
       half-width AND the full inner height. Subgrid B has more rows so its
       cell will be smaller — this is desired for Colossal asymmetric dual. */
    const halfW = innerW / 2;
    const sideA = Math.min(
      (halfW - gap * (REELS - 1)) / REELS,
      (innerH - gap * (ROWS - 1)) / ROWS,
    );
    const sideB = Math.min(
      (halfW - gap * (sgReelsB - 1)) / sgReelsB,
      (innerH - gap * (sgRowsB - 1)) / sgRowsB,
    );
    /* primary */
    const a = document.createElement("div");
    a.className = "grid-rect";
    a.style.gridTemplateColumns = "repeat(" + REELS + ", " + sideA + "px)";
    a.style.gridTemplateRows = "repeat(" + ROWS + ", " + sideA + "px)";
    a.style.gap = gap + "px";
    const primCells = SHAPE.totalCells || REELS * ROWS;
    for (let i = 0; i < primCells; i++) {
      const el = makeCell(symAt(i));
      el.style.fontSize = (sideA * 0.32) + "px";
      a.appendChild(el);
    }
    wrap.appendChild(a);
    if (SHAPE.subgrids && SHAPE.subgrids[0]) {
      const sg = SHAPE.subgrids[0];
      const b = document.createElement("div");
      b.className = "grid-rect";
      b.style.gridTemplateColumns = "repeat(" + sg.reels + ", " + sideB + "px)";
      b.style.gridTemplateRows = "repeat(" + sg.rows + ", " + sideB + "px)";
      b.style.gap = gap + "px";
      for (let i = 0; i < sg.totalCells; i++) {
        const el = makeCell(symAt(primCells + i));
        el.style.fontSize = Math.max(8, sideB * 0.32) + "px";
        b.appendChild(el);
      }
      wrap.appendChild(b);
    }
    grid.appendChild(wrap);
  }

  /* Dispatch */
  function renderGrid() {
    grid.innerHTML = "";
    switch (SHAPE.kind) {
      case "rectangular":
      case "cluster":
      case "lock_respin":
      case "megaclusters":
      case "infinity":
      case "expanding":
        return renderRect();
      case "variable_reel":
      case "diamond":
      case "pyramid":
        return renderVariableReel();
      case "cross":
      case "l_shape":
        return renderMaskedRect();
      case "hexagonal":
        return renderHex();
      case "radial":
      case "wheel":
        return renderWheel();
      case "plinko":
        return renderPlinko();
      case "crash":
        return renderCrash();
      case "slingo":
        return renderSlingo();
      case "dual":
        return renderDual();
      default:
        return renderRect();
    }
  }

  /* Initial render + responsive on resize */
  function fit() { renderGrid(); }
  window.addEventListener("resize", fit);
  /* run after first layout pass so .frame has measured dimensions */
  requestAnimationFrame(fit);
</script>
</body></html>`;
}
