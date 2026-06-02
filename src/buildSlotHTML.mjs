/**
 * Slot GDD Factory · build standalone playable slot HTML
 * Pure: takes a parsed model, returns a self-contained HTML string.
 * Shared between app.js (browser, opens new tab) and tests/render-browser-all.mjs.
 */
import { buildGridShape } from './gridShape.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* ─── build self-contained slot HTML (dummy math) ────── */
export function buildSlotHTML(model) {
  const allSyms = [
    ...model.symbols.specials, ...model.symbols.high,
    ...model.symbols.mid, ...model.symbols.low,
  ];
  /* fallback if no symbols */
  const pool = allSyms.length > 0 ? allSyms : [
    { id: "W", name: "Wild" }, { id: "S", name: "Scatter" },
    { id: "A", name: "Ace" }, { id: "K", name: "King" }, { id: "Q", name: "Queen" },
    { id: "J", name: "Jack" }, { id: "T", name: "Ten" }, { id: "9", name: "Nine" },
  ];
  const shape = buildGridShape(model);
  const reels = shape.reels;
  const rows = shape.rows;
  const accent = (model.theme.palette[0]) || "#66fcf1";
  const bg = (model.theme.palette[1]) || "#0b0c10";

  const layoutSub = `${shape.shapeNote}${shape.paylines ? ` · ${shape.paylines} lines` : ''}${shape.wayCount ? ` · ${shape.wayCount} ways` : ''}`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>${escapeHtml(model.name)} · Slot Template</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, sans-serif;
       background: ${bg}; color: #c5c6c7; min-height: 100vh;
       display: flex; flex-direction: column; align-items: center; padding: 1.5rem; }
h1 { color: ${accent}; font-size: 1.8rem; margin-bottom: 0.25rem; }
.sub { color: #45a29e; font-size: 0.85rem; margin-bottom: 0.75rem; opacity: 0.9; }
.features-strip { display: flex; gap: 0.5rem; flex-wrap: wrap; justify-content: center; margin-bottom: 1rem; }
.feat { background: rgba(255,255,255,0.05); border: 1px solid ${accent}; color: ${accent};
        padding: 0.3rem 0.7rem; border-radius: 6px; font-size: 0.75rem;
        text-transform: uppercase; letter-spacing: 1px; }
.grid-host { background: rgba(255,255,255,0.04); padding: 12px; border-radius: 16px;
             box-shadow: 0 8px 40px rgba(0,0,0,0.4); display: flex; gap: 24px; }
.grid-rect { display: grid; gap: 6px; }
.grid-vrl  { display: flex; gap: 6px; align-items: center; }
.col       { display: flex; flex-direction: column; gap: 6px; }
.grid-hex  { position: relative; }
.grid-wheel{ display: flex; align-items: center; justify-content: center; }
.grid-plinko{ display: flex; flex-direction: column; align-items: center; gap: 4px; }
.plinko-row{ display: flex; gap: 18px; }
.peg       { width: 10px; height: 10px; border-radius: 50%; background: ${accent}; opacity: 0.85; }
.grid-crash{ display: flex; align-items: center; justify-content: center; min-width: 360px; min-height: 220px; }
.crash-curve { width: 320px; height: 180px; }
.grid-slingo { display: flex; flex-direction: column; gap: 12px; }
.grow-tag { position: absolute; top: -22px; right: -22px; font-size: 0.65rem; color: ${accent};
            border: 1px dashed ${accent}; border-radius: 12px; padding: 0.1rem 0.5rem;
            background: rgba(0,0,0,0.4); letter-spacing: 1px; text-transform: uppercase; }
.cell { background: #1f2833; border: 1px solid #2a3b4c;
        border-radius: 10px; display: flex; align-items: center; justify-content: center;
        font-size: 1.6rem; font-weight: 800; color: ${accent};
        transition: transform 0.15s, border-color 0.15s; width: 70px; height: 70px; }
.cell.lockable { box-shadow: inset 0 0 0 2px rgba(255, 209, 102, 0.35); }
.cell.hex { width: 60px; height: 68px; clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%); position: absolute; }
.cell.spoke { width: 60px; height: 60px; }
.wheel-svg { width: 320px; height: 320px; }
.cell.spin { animation: blur var(--spinMs, 0.4s) linear; }
.cell.win { border-color: ${accent}; box-shadow: 0 0 12px ${accent}; transform: scale(1.05); }
@keyframes blur { 0% { filter: blur(0px); } 50% { filter: blur(6px); } 100% { filter: blur(0px); } }
.controls { margin-top: 1.5rem; display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; justify-content: center; }
button { background: ${accent}; color: ${bg}; border: 0; border-radius: 10px;
         padding: 0.85rem 1.4rem; font-size: 0.95rem; font-weight: 800; cursor: pointer;
         transition: transform 0.15s, box-shadow 0.15s; }
button:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 4px 16px ${accent}55; }
button:disabled { opacity: 0.4; cursor: not-allowed; }
button.secondary { background: transparent; color: ${accent}; border: 1px solid ${accent}; }
.bet-controls { display: flex; align-items: center; gap: 0.4rem; background: rgba(255,255,255,0.04);
                border: 1px solid #2a3b4c; border-radius: 10px; padding: 0.4rem 0.6rem; }
.bet-controls button { padding: 0.3rem 0.65rem; font-size: 0.95rem; }
.bet-value { min-width: 60px; text-align: center; font-weight: 700; color: ${accent}; }
.info { font-size: 0.8rem; color: #45a29e; }
.info span { color: ${accent}; font-weight: 700; }
.hud { margin-top: 0.5rem; display: flex; gap: 1.25rem; font-size: 0.85rem; }
.badge { padding: 0.2rem 0.6rem; border-radius: 5px; font-size: 0.7rem; letter-spacing: 1px;
         text-transform: uppercase; }
.badge.spinning { background: ${accent}33; color: ${accent}; }
.badge.idle { background: #2a3b4c; color: #45a29e; }
.badge.auto { background: #ffd16633; color: #ffd166; }
.toggles { display: flex; gap: 0.6rem; margin-top: 0.6rem; font-size: 0.75rem; color: #45a29e; }
.toggles label { cursor: pointer; user-select: none; display: flex; align-items: center; gap: 0.3rem; }
.toggles input[type="checkbox"] { accent-color: ${accent}; }
.footer { margin-top: 1.5rem; font-size: 0.65rem; color: #45a29e; opacity: 0.6; text-align: center; max-width: 600px; }
.reduced * { animation: none !important; transition: none !important; }
</style></head><body>

<h1>${escapeHtml(model.name)}</h1>
<div class="sub">${layoutSub} · ${escapeHtml(model.theme.tags.join(" · ") || "")}</div>

<div class="features-strip">
${model.features.map(f => `<span class="feat">${escapeHtml(f.label)}</span>`).join("") || `<span class="feat" style="opacity:0.4">no features</span>`}
</div>

<div class="grid-host" id="gridHost" data-kind="${shape.kind}"></div>

<div class="controls">
<div class="bet-controls">
  <button id="betDown" title="bet -">−</button>
  <span class="bet-value">Bet <span id="betVal">1</span></span>
  <button id="betUp" title="bet +">+</button>
  <button id="betMax" class="secondary" style="margin-left:0.4rem;padding:0.3rem 0.55rem;font-size:0.7rem" title="max bet">MAX</button>
</div>
<button id="spinBtn">🎰 SPIN</button>
<button id="autoBtn" class="secondary">▶ AUTO 10</button>
<button id="resetBtn" class="secondary" style="font-size:0.7rem;padding:0.6rem 0.8rem">↺ RESET</button>
</div>

<div class="hud">
<span class="info">Balance: <span id="bal">1000.00</span></span>
<span class="info">Last win: <span id="win">0.00</span></span>
<span class="info">Spins: <span id="spinCount">0</span></span>
<span id="stateBadge" class="badge idle">IDLE</span>
</div>

<div class="toggles">
<label><input type="checkbox" id="turboTog"> ⚡ Turbo</label>
<label><input type="checkbox" id="reduceTog"> ♿ Reduce motion</label>
<label>Auto count:
  <select id="autoCount" style="background:#1f2833;color:${accent};border:1px solid ${accent};border-radius:4px;padding:0.1rem 0.3rem;font-size:0.7rem">
    <option value="10">10</option>
    <option value="25">25</option>
    <option value="50">50</option>
    <option value="100">100</option>
  </select>
</label>
</div>

<div class="footer">
Math is <strong>placeholder dummy</strong> — uniform reels, linear paytable.<br>
Real math (PAR sheet) hot-swap not yet implemented. Generated by Slot GDD Factory.
</div>

<script>
const POOL = ${JSON.stringify(pool.map(s => s.id))};
const REELS = ${reels};
const ROWS = ${rows};
const SHAPE = ${JSON.stringify(shape)};
const BETS = [1, 2, 5, 10, 25, 50];
const STORE_KEY = "slotgdd.template." + ${JSON.stringify(model.name)}.replace(/\\W+/g, "_");

const grid = document.getElementById("gridHost");
const spinBtn = document.getElementById("spinBtn");
const autoBtn = document.getElementById("autoBtn");
const resetBtn = document.getElementById("resetBtn");
const betUpBtn = document.getElementById("betUp");
const betDownBtn = document.getElementById("betDown");
const betMaxBtn = document.getElementById("betMax");
const betValEl = document.getElementById("betVal");
const balEl = document.getElementById("bal");
const winEl = document.getElementById("win");
const spinCountEl = document.getElementById("spinCount");
const stateBadge = document.getElementById("stateBadge");
const turboTog = document.getElementById("turboTog");
const reduceTog = document.getElementById("reduceTog");
const autoCountSel = document.getElementById("autoCount");

/* state — persisted */
const persisted = (() => {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
})();
let balance = persisted.balance ?? 1000.00;
let betIdx = persisted.betIdx ?? 0;
let totalSpins = persisted.totalSpins ?? 0;
let turbo = persisted.turbo ?? false;
let reduced = persisted.reduced ?? false;
let autoCount = persisted.autoCount ?? 10;
turboTog.checked = turbo;
reduceTog.checked = reduced;
autoCountSel.value = String(autoCount);
if (reduced) document.body.classList.add("reduced");
autoBtn.textContent = "▶ AUTO " + autoCount;

function persist() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify({ balance, betIdx, totalSpins, turbo, reduced, autoCount }));
  } catch {}
}

function refreshBet() {
  betValEl.textContent = BETS[betIdx];
  persist();
}
function refreshBalance() { balEl.textContent = balance.toFixed(2); persist(); }
function refreshSpins() { spinCountEl.textContent = totalSpins; persist(); }

function setSpinMs(ms) { document.documentElement.style.setProperty("--spinMs", ms + "ms"); }
setSpinMs(turbo ? 120 : 420);

function randSym() { return POOL[Math.floor(Math.random() * POOL.length)]; }

/* ─── kind-aware renderer dispatch ─────────────────────── */
function cellsCount() { return SHAPE.totalCells || (REELS * ROWS); }

function renderGrid(syms, winSet = new Set()) {
  grid.innerHTML = "";
  switch (SHAPE.kind) {
    case "rectangular":
    case "cluster":
    case "lock_respin":
    case "megaclusters":
    case "infinity":
    case "expanding":
      return renderRect(syms, winSet);
    case "variable_reel":
    case "diamond":
    case "pyramid":
      return renderVariableReel(syms, winSet);
    case "cross":
    case "l_shape":
      return renderMaskedRect(syms, winSet);
    case "hexagonal":
      return renderHex(syms, winSet);
    case "radial":
    case "wheel":
      return renderWheel(syms, winSet);
    case "plinko":
      return renderPlinko(syms, winSet);
    case "crash":
      return renderCrash(syms, winSet);
    case "slingo":
      return renderSlingo(syms, winSet);
    case "dual":
      return renderDual(syms, winSet);
    default:
      return renderRect(syms, winSet);
  }
}

function makeCell(text, isWin, extraClass = "") {
  const el = document.createElement("div");
  el.className = "cell" + (isWin ? " win" : "") + (extraClass ? " " + extraClass : "");
  el.textContent = text || "?";
  return el;
}

function renderRect(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-rect";
  host.style.gridTemplateColumns = "repeat(" + REELS + ", 70px)";
  host.style.gridTemplateRows = "repeat(" + ROWS + ", 70px)";
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) {
      host.appendChild(makeCell(syms[idx], winSet.has(idx), SHAPE.kind === "lock_respin" ? "lockable" : ""));
      idx++;
    }
  }
  if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
    const tag = document.createElement("div");
    tag.className = "grow-tag";
    tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
    host.style.position = "relative";
    host.appendChild(tag);
  }
  grid.appendChild(host);
}

function renderVariableReel(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-vrl";
  let idx = 0;
  for (let c = 0; c < SHAPE.columns.length; c++) {
    const colEl = document.createElement("div");
    colEl.className = "col";
    const colRows = SHAPE.columns[c].rows;
    for (let r = 0; r < colRows; r++) {
      colEl.appendChild(makeCell(syms[idx], winSet.has(idx)));
      idx++;
    }
    host.appendChild(colEl);
  }
  grid.appendChild(host);
}

function renderMaskedRect(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-rect";
  host.style.gridTemplateColumns = "repeat(" + REELS + ", 70px)";
  host.style.gridTemplateRows = "repeat(" + ROWS + ", 70px)";
  let idx = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < REELS; c++) {
      const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
      const cellEnabled = colMask ? colMask[r] : true;
      if (cellEnabled) {
        host.appendChild(makeCell(syms[idx], winSet.has(idx)));
        idx++;
      } else {
        const blank = document.createElement("div");
        blank.style.cssText = "width:70px;height:70px;opacity:0.05";
        host.appendChild(blank);
      }
    }
  }
  grid.appendChild(host);
}

function renderHex(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-hex";
  const ring = Math.floor((SHAPE.columns.length - 1) / 2);
  const size = 60, gap = 4;
  const w = size + gap, h = (size + gap) * 0.85;
  host.style.width = ((ring * 2 + 1) * w + 40) + "px";
  host.style.height = ((ring * 2 + 1) * h + 40) + "px";
  SHAPE.cells.forEach((c, i) => {
    const q = c.hex ? c.hex.q : 0;
    const r = c.hex ? c.hex.r : 0;
    const x = (q + ring) * w + (r % 2) * w * 0.5 + 20;
    const y = (r + ring) * h + 20;
    const el = makeCell(syms[i], winSet.has(i), "hex");
    el.style.left = x + "px";
    el.style.top = y + "px";
    host.appendChild(el);
  });
  grid.appendChild(host);
}

function renderWheel(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-wheel";
  const segments = SHAPE.cells.length;
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "wheel-svg");
  svg.setAttribute("viewBox", "-100 -100 200 200");
  const accent = "${accent}";
  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * 2 * Math.PI - Math.PI / 2;
    const a1 = ((i + 1) / segments) * 2 * Math.PI - Math.PI / 2;
    const x0 = Math.cos(a0) * 90, y0 = Math.sin(a0) * 90;
    const x1 = Math.cos(a1) * 90, y1 = Math.sin(a1) * 90;
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "M 0 0 L " + x0.toFixed(2) + " " + y0.toFixed(2) + " A 90 90 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + " Z");
    path.setAttribute("fill", winSet.has(i) ? accent : (i % 2 ? "#1f2833" : "#2a3b4c"));
    path.setAttribute("stroke", accent);
    path.setAttribute("stroke-width", "0.5");
    svg.appendChild(path);
    // segment label
    const mid = (a0 + a1) / 2;
    const tx = Math.cos(mid) * 60, ty = Math.sin(mid) * 60;
    const tEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
    tEl.setAttribute("x", tx.toFixed(2)); tEl.setAttribute("y", ty.toFixed(2));
    tEl.setAttribute("text-anchor", "middle"); tEl.setAttribute("dominant-baseline", "middle");
    tEl.setAttribute("fill", winSet.has(i) ? "#0b0c10" : accent);
    tEl.setAttribute("font-size", "8");
    tEl.setAttribute("font-weight", "700");
    tEl.textContent = String(syms[i] || (i + 1));
    svg.appendChild(tEl);
  }
  host.appendChild(svg);
  grid.appendChild(host);
}

function renderPlinko(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-plinko";
  let idx = 0;
  for (let r = 0; r < SHAPE.columns.length; r++) {
    const rowEl = document.createElement("div");
    rowEl.className = "plinko-row";
    const pegCount = SHAPE.columns[r].rows;
    for (let c = 0; c < pegCount; c++) {
      const peg = document.createElement("div");
      peg.className = "peg" + (winSet.has(idx) ? " win" : "");
      rowEl.appendChild(peg);
      idx++;
    }
    host.appendChild(rowEl);
  }
  grid.appendChild(host);
}

function renderCrash(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-crash";
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("class", "crash-curve");
  svg.setAttribute("viewBox", "0 0 320 180");
  const accent = "${accent}";
  // exponential curve
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  let d = "M 0 180";
  const factor = winSet.has(0) ? 1.0 : 0.7;
  for (let x = 0; x <= 320; x += 6) {
    const y = 180 - Math.pow(x / 320, 2) * 160 * factor;
    d += " L " + x + " " + y.toFixed(1);
  }
  path.setAttribute("d", d);
  path.setAttribute("stroke", accent);
  path.setAttribute("stroke-width", "3");
  path.setAttribute("fill", "none");
  svg.appendChild(path);
  const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
  txt.setAttribute("x", "260"); txt.setAttribute("y", "30");
  txt.setAttribute("fill", accent); txt.setAttribute("font-size", "20"); txt.setAttribute("font-weight", "800");
  txt.textContent = (syms[0] || "1.00") + "x";
  svg.appendChild(txt);
  host.appendChild(svg);
  grid.appendChild(host);
}

function renderSlingo(syms, winSet) {
  const host = document.createElement("div");
  host.className = "grid-slingo";
  // board
  const board = document.createElement("div");
  board.className = "grid-rect";
  board.style.gridTemplateColumns = "repeat(5, 70px)";
  board.style.gridTemplateRows = "repeat(5, 70px)";
  for (let i = 0; i < 25; i++) {
    board.appendChild(makeCell(syms[i], winSet.has(i)));
  }
  host.appendChild(board);
  // strip below
  const strip = document.createElement("div");
  strip.className = "grid-rect";
  strip.style.gridTemplateColumns = "repeat(5, 70px)";
  strip.style.gridTemplateRows = "70px";
  strip.style.borderTop = "2px dashed ${accent}";
  strip.style.paddingTop = "12px";
  for (let i = 25; i < 30; i++) {
    strip.appendChild(makeCell(syms[i], winSet.has(i)));
  }
  host.appendChild(strip);
  grid.appendChild(host);
}

function renderDual(syms, winSet) {
  // primary then secondary side-by-side
  const primary = document.createElement("div");
  primary.className = "grid-rect";
  primary.style.gridTemplateColumns = "repeat(" + REELS + ", 56px)";
  primary.style.gridTemplateRows = "repeat(" + ROWS + ", 56px)";
  primary.style.gap = "4px";
  const primCells = SHAPE.totalCells || REELS * ROWS;
  for (let i = 0; i < primCells; i++) {
    const el = makeCell(syms[i], winSet.has(i));
    el.style.width = "56px"; el.style.height = "56px"; el.style.fontSize = "1.1rem";
    primary.appendChild(el);
  }
  grid.appendChild(primary);
  if (SHAPE.subgrids && SHAPE.subgrids[0]) {
    const sg = SHAPE.subgrids[0];
    const sec = document.createElement("div");
    sec.className = "grid-rect";
    sec.style.gridTemplateColumns = "repeat(" + sg.reels + ", 36px)";
    sec.style.gridTemplateRows = "repeat(" + sg.rows + ", 36px)";
    sec.style.gap = "3px";
    for (let i = 0; i < sg.totalCells; i++) {
      const idx = primCells + i;
      const el = makeCell(syms[idx], winSet.has(idx));
      el.style.width = "36px"; el.style.height = "36px"; el.style.fontSize = "0.8rem";
      sec.appendChild(el);
    }
    grid.appendChild(sec);
  }
}

function initialGrid() {
  const syms = [];
  // generate enough symbols for current layout — include subgrid count
  const total = SHAPE.totalCells + (SHAPE.subgrids ? SHAPE.subgrids.reduce((s, g) => s + g.totalCells, 0) : 0);
  for (let i = 0; i < Math.max(total, REELS * ROWS); i++) syms.push(randSym());
  renderGrid(syms);
}

function evalWin(syms) {
  /* dummy uniform check: if first 3+ symbols match (placeholder) */
  let same = 1;
  for (let i = 1; i < Math.min(syms.length, 6); i++) {
    if (syms[i] === syms[0]) same++; else break;
  }
  if (same >= 3) {
    const payoutMap = { 3: 5, 4: 25, 5: 100, 6: 250 };
    const win = (payoutMap[same] || 0) * BETS[betIdx];
    const winSet = new Set();
    for (let i = 0; i < same; i++) winSet.add(i);
    return { win, winSet };
  }
  return { win: 0, winSet: new Set() };
}

let autoplayActive = false;
let autoplayRemaining = 0;

function spin() {
  const BET = BETS[betIdx];
  if (balance < BET) { stopAutoplay(); return; }
  spinBtn.disabled = true;
  autoBtn.disabled = true;
  betUpBtn.disabled = true;
  betDownBtn.disabled = true;
  betMaxBtn.disabled = true;
  stateBadge.className = "badge " + (autoplayActive ? "auto" : "spinning");
  stateBadge.textContent = autoplayActive ? "AUTO " + autoplayRemaining : "SPINNING";

  balance -= BET;
  totalSpins += 1;
  refreshBalance();
  refreshSpins();
  winEl.textContent = "0.00";

  const cells = grid.querySelectorAll(".cell");
  cells.forEach(c => c.classList.add("spin"));

  const spinMs = turbo ? 120 : 420;
  setTimeout(() => {
    const syms = [];
    const total = SHAPE.totalCells + (SHAPE.subgrids ? SHAPE.subgrids.reduce((s, g) => s + g.totalCells, 0) : 0);
    for (let i = 0; i < Math.max(total, REELS * ROWS); i++) syms.push(randSym());
    const { win, winSet } = evalWin(syms);
    renderGrid(syms, winSet);
    if (win > 0) {
      balance += win;
      refreshBalance();
      winEl.textContent = win.toFixed(2);
    }
    /* re-enable controls (autoplay handles its own state) */
    if (!autoplayActive) {
      spinBtn.disabled = false;
      autoBtn.disabled = false;
      betUpBtn.disabled = false;
      betDownBtn.disabled = false;
      betMaxBtn.disabled = false;
      stateBadge.className = "badge idle";
      stateBadge.textContent = "IDLE";
    } else {
      autoplayRemaining -= 1;
      if (autoplayRemaining <= 0 || balance < BETS[betIdx]) {
        stopAutoplay();
      } else {
        stateBadge.textContent = "AUTO " + autoplayRemaining;
        setTimeout(spin, turbo ? 60 : 200);
      }
    }
  }, spinMs);
}

function startAutoplay() {
  if (autoplayActive) return;
  autoplayActive = true;
  autoplayRemaining = parseInt(autoCountSel.value, 10);
  autoBtn.textContent = "⏹ STOP";
  autoBtn.disabled = false;
  spin();
}
function stopAutoplay() {
  autoplayActive = false;
  autoplayRemaining = 0;
  autoBtn.textContent = "▶ AUTO " + autoCount;
  autoBtn.disabled = false;
  spinBtn.disabled = false;
  betUpBtn.disabled = false;
  betDownBtn.disabled = false;
  betMaxBtn.disabled = false;
  stateBadge.className = "badge idle";
  stateBadge.textContent = "IDLE";
}

spinBtn.addEventListener("click", () => { if (!autoplayActive) spin(); });
autoBtn.addEventListener("click", () => {
  if (autoplayActive) stopAutoplay(); else startAutoplay();
});
betUpBtn.addEventListener("click", () => {
  if (betIdx < BETS.length - 1) { betIdx += 1; refreshBet(); }
});
betDownBtn.addEventListener("click", () => {
  if (betIdx > 0) { betIdx -= 1; refreshBet(); }
});
betMaxBtn.addEventListener("click", () => {
  betIdx = BETS.length - 1; refreshBet();
});
resetBtn.addEventListener("click", () => {
  if (!confirm("Reset balance to 1000 and clear spin count?")) return;
  balance = 1000.00; totalSpins = 0; betIdx = 0;
  refreshBalance(); refreshSpins(); refreshBet();
  winEl.textContent = "0.00";
});
turboTog.addEventListener("change", e => {
  turbo = e.target.checked;
  setSpinMs(turbo ? 120 : 420);
  persist();
});
reduceTog.addEventListener("change", e => {
  reduced = e.target.checked;
  document.body.classList.toggle("reduced", reduced);
  persist();
});
autoCountSel.addEventListener("change", e => {
  autoCount = parseInt(e.target.value, 10);
  autoBtn.textContent = "▶ AUTO " + autoCount;
  persist();
});
/* keyboard — Space spins, A toggles autoplay */
document.addEventListener("keydown", e => {
  if (e.code === "Space") { e.preventDefault(); if (!spinBtn.disabled && !autoplayActive) spin(); }
  if (e.code === "KeyA") { if (autoplayActive) stopAutoplay(); else startAutoplay(); }
});

refreshBet();
refreshBalance();
refreshSpins();
initialGrid();
</script>
</body></html>`;
}
