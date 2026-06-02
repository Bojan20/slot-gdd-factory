/* =============================================================
   Slot GDD Factory · app.js
   One-button GDD upload → parsed model → playable slot in new tab.
   Zero deps. file:// safe.
   ============================================================= */

(() => {
  "use strict";

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const resultEl = document.getElementById("result");

  /* ─── wire dropzone ───────────────────────────────────── */
  dropzone.addEventListener("click", () => fileInput.click());
  dropzone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropzone.classList.add("dragover");
  });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("dragover"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("dragover");
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  });
  fileInput.addEventListener("change", (e) => {
    const f = e.target.files[0];
    if (f) handleFile(f);
  });

  /* ─── ingest ─────────────────────────────────────────── */
  async function handleFile(file) {
    resultEl.innerHTML = `<div class="card"><h3>Reading ${escapeHtml(file.name)}…</h3></div>`;
    try {
      const text = await file.text();
      const ext = file.name.split(".").pop().toLowerCase();
      const model = parseGDD(text, ext);
      renderResult(model, file.name);
    } catch (err) {
      resultEl.innerHTML = `<div class="error">❌ ${escapeHtml(err.message)}</div>`;
      console.error(err);
    }
  }

  /* ─── parser dispatch ────────────────────────────────── */
  function parseGDD(text, ext) {
    if (ext === "json") {
      const obj = JSON.parse(text);
      return normalizeFromJSON(obj);
    }
    // md / txt / markdown → regex/table parser
    return parseMarkdownGDD(text);
  }

  /* ─── Markdown GDD parser ────────────────────────────── */
  function parseMarkdownGDD(text) {
    const model = {
      name: "Untitled Slot",
      theme: { tags: [], palette: [], mood: "" },
      topology: { reels: 5, rows: 3, paylines: 10 },
      symbols: { high: [], mid: [], low: [], specials: [] },
      features: [],
      confidence: { name: 0, topology: 0, symbols: 0, features: 0 },
    };

    /* name — first H1 or "Internal name" cell */
    const h1 = text.match(/^#\s+(.+?)(?:\s+—|\s+-|\s+:|\s+\(|$)/m);
    if (h1) { model.name = h1[1].trim(); model.confidence.name += 0.5; }
    const internalName = text.match(/\|\s*Internal name\s*\|\s*([^|]+?)\s*\|/i);
    if (internalName) { model.name = internalName[1].trim(); model.confidence.name = 1.0; }

    /* theme tags */
    const themeTags = text.match(/\|\s*Theme tags\s*\|\s*([^|]+?)\s*\|/i);
    if (themeTags) {
      model.theme.tags = themeTags[1].split(/[·•,\/]/).map(s => s.trim()).filter(Boolean);
    }

    /* mood */
    const mood = text.match(/\|\s*Mood\s*\|\s*([^|]+?)\s*\|/i);
    if (mood) model.theme.mood = mood[1].trim();

    /* color palette — hex codes */
    const hexes = text.match(/#[0-9a-fA-F]{6}/g);
    if (hexes) model.theme.palette = [...new Set(hexes)].slice(0, 6);

    /* topology */
    const reels = text.match(/\|\s*Reels\s*\|\s*(\d+)\s*\|/i);
    const rows = text.match(/\|\s*Rows\s*\|\s*(\d+)\s*\|/i);
    const lines = text.match(/\|\s*Paylines\s*\|\s*(\d+)/i);
    if (reels) { model.topology.reels = parseInt(reels[1], 10); model.confidence.topology += 0.4; }
    if (rows)  { model.topology.rows  = parseInt(rows[1], 10);  model.confidence.topology += 0.4; }
    if (lines) { model.topology.paylines = parseInt(lines[1], 10); model.confidence.topology += 0.2; }

    /* symbols — pull table blocks under headers */
    extractSymbolBlock(text, /High[\s-]?pay/i, model.symbols.high);
    extractSymbolBlock(text, /Mid[\s-]?pay/i,  model.symbols.mid);
    extractSymbolBlock(text, /Low[\s-]?pay/i,  model.symbols.low);
    extractSymbolBlock(text, /Specials?/i,     model.symbols.specials);
    const totalSyms = model.symbols.high.length + model.symbols.mid.length +
                      model.symbols.low.length + model.symbols.specials.length;
    if (totalSyms > 0) model.confidence.symbols = Math.min(1, totalSyms / 8);

    /* features — scan headers and prose */
    model.features = extractFeatures(text);
    if (model.features.length > 0) model.confidence.features = Math.min(1, model.features.length / 3);

    return model;
  }

  /* ─── helper: pull symbol rows under a heading ───────── */
  function extractSymbolBlock(text, headingRegex, sink) {
    const headingMatch = text.match(new RegExp(`###[^\n]*${headingRegex.source}[^\n]*`, "i"));
    if (!headingMatch) return;
    const start = headingMatch.index + headingMatch[0].length;
    /* find next ###/## boundary or 4000 chars max */
    const rest = text.slice(start, start + 4000);
    const end = rest.search(/\n##\s|\n###\s/);
    const chunk = end >= 0 ? rest.slice(0, end) : rest;
    /* match table rows like: | `D` | Diamond | ...| */
    const rowRe = /\|\s*`?([A-Za-z0-9_]{1,4})`?\s*\|\s*([^|]+?)\s*\|/g;
    let m;
    while ((m = rowRe.exec(chunk)) !== null) {
      const id = m[1].trim();
      const name = m[2].trim();
      if (id.toLowerCase() === "id" || name.toLowerCase() === "name") continue;
      if (id.length > 4) continue;
      sink.push({ id, name });
    }
  }

  /* ─── helper: detect feature kinds from prose ────────── */
  function extractFeatures(text) {
    const patterns = [
      { kind: "free_spins",      re: /\bfree[\s-]?spins?\b/i,                label: "Free Spins" },
      { kind: "hold_and_win",    re: /\bhold[\s_-]?and[\s_-]?win\b|\bH&W\b/i, label: "Hold & Win" },
      { kind: "cascade",         re: /\bcascad(e|ing)|tumble|tumbling\b/i,   label: "Cascade / Tumble" },
      { kind: "multiplier",      re: /\bmultiplier(s)?\b/i,                  label: "Multiplier" },
      { kind: "expanding_wild",  re: /\bexpanding[\s_-]?wild/i,              label: "Expanding Wild" },
      { kind: "walking_wild",    re: /\bwalking[\s_-]?wild/i,                label: "Walking Wild" },
      { kind: "sticky_wild",     re: /\bsticky[\s_-]?wild/i,                 label: "Sticky Wild" },
      { kind: "mystery_symbol",  re: /\bmystery[\s_-]?symbol/i,              label: "Mystery Symbol" },
      { kind: "buy_feature",     re: /\bbuy[\s_-]?(feature|bonus)\b/i,       label: "Buy Feature" },
      { kind: "bonus_pick",      re: /\bpick[\s_-]?(bonus|me|and|n)?/i,      label: "Bonus Pick" },
      { kind: "wheel_bonus",     re: /\bwheel\s+bonus|bonus\s+wheel/i,       label: "Wheel Bonus" },
      { kind: "cluster_pays",    re: /\bcluster[\s_-]?pays?\b/i,             label: "Cluster Pays" },
      { kind: "ways",            re: /\b(?:243|576|1024|3125|117649)\s*ways?\b|\bways?\s+to\s+win\b/i, label: "Ways" },
      { kind: "scatter_pay",     re: /\bscatter\s+pays?\b/i,                 label: "Scatter Pay" },
      { kind: "lightning",       re: /\blightning[\s_-]?(multiplier|spark|strike)?/i, label: "Lightning" },
      { kind: "respin",          re: /\brespin/i,                            label: "Respin" },
      { kind: "wild_reel",       re: /\bwild[\s_-]?reel/i,                   label: "Wild Reel" },
    ];
    const out = [];
    const seen = new Set();
    for (const p of patterns) {
      if (p.re.test(text) && !seen.has(p.kind)) {
        out.push({ kind: p.kind, label: p.label });
        seen.add(p.kind);
      }
    }
    return out;
  }

  /* ─── JSON GDD passthrough (IR shape) ────────────────── */
  function normalizeFromJSON(obj) {
    const model = {
      name: obj.name || obj.gameId || obj.title || "Untitled (JSON)",
      theme: obj.theme || { tags: [], palette: [], mood: "" },
      topology: obj.topology || obj.layout || { reels: 5, rows: 3, paylines: 10 },
      symbols: obj.symbols || { high: [], mid: [], low: [], specials: [] },
      features: (obj.features || []).map(f => ({
        kind: f.kind || f.type || "unknown",
        label: f.label || f.name || f.kind || "Feature"
      })),
      confidence: { name: 1, topology: 1, symbols: 1, features: 1 },
    };
    return model;
  }

  /* ─── render parsed model + Open Slot button ─────────── */
  function renderResult(model, fileName) {
    const symTotal = model.symbols.high.length + model.symbols.mid.length +
                     model.symbols.low.length + model.symbols.specials.length;

    const palette = model.theme.palette.map(c =>
      `<span class="chip" style="background:${c};color:#0b0c10"><strong>${c}</strong></span>`
    ).join("");

    const symChips = [
      ...model.symbols.high.map(s => `HP <strong>${s.id}</strong> ${s.name}`),
      ...model.symbols.mid.map(s => `MP <strong>${s.id}</strong> ${s.name}`),
      ...model.symbols.low.map(s => `LP <strong>${s.id}</strong> ${s.name}`),
      ...model.symbols.specials.map(s => `★ <strong>${s.id}</strong> ${s.name}`),
    ].map(t => `<span class="chip">${t}</span>`).join("");

    const featChips = model.features.map(f =>
      `<span class="chip"><strong>${escapeHtml(f.label)}</strong></span>`
    ).join("") || `<span class="chip" style="color:#ff6b6b">no features detected</span>`;

    resultEl.innerHTML = `
      <div class="card">
        <h3>🧬 Parsed model · ${escapeHtml(fileName)}</h3>
        <div style="font-size:1.3rem;color:#66fcf1;font-weight:700;margin-bottom:0.75rem">${escapeHtml(model.name)}</div>
        <table>
          <tr><th>Layout</th><td>${model.topology.reels}×${model.topology.rows} · ${model.topology.paylines} lines</td></tr>
          <tr><th>Theme</th><td>${escapeHtml(model.theme.tags.join(" · ") || "—")}</td></tr>
          <tr><th>Mood</th><td>${escapeHtml(model.theme.mood || "—")}</td></tr>
        </table>
      </div>

      ${palette ? `<div class="card"><h3>🎨 Color palette</h3><div class="row">${palette}</div></div>` : ""}

      <div class="card">
        <h3>🎯 Symbols (${symTotal})</h3>
        <div class="row">${symChips || `<span class="chip">no symbols detected</span>`}</div>
      </div>

      <div class="card">
        <h3>⚡ Features (${model.features.length})</h3>
        <div class="row">${featChips}</div>
      </div>

      <div class="actions">
        <button class="btn" id="openSlotBtn">🎰 Open playable slot →</button>
        <button class="btn btn-ghost" id="downloadIrBtn">⬇ Download IR JSON</button>
      </div>
    `;

    document.getElementById("openSlotBtn").addEventListener("click", () => openPlayableSlot(model));
    document.getElementById("downloadIrBtn").addEventListener("click", () => downloadIR(model, fileName));
  }

  /* ─── open standalone slot in new tab ────────────────── */
  function openPlayableSlot(model) {
    const html = buildSlotHTML(model);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const tab = window.open(url, "_blank");
    if (!tab) {
      alert("Popup blokiran. Dozvoli popup za localhost da bi se otvorila igra.");
    }
  }

  /* ─── build self-contained slot HTML (dummy math) ────── */
  function buildSlotHTML(model) {
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
    const reels = model.topology.reels || 5;
    const rows = model.topology.rows || 3;
    const accent = (model.theme.palette[0]) || "#66fcf1";
    const bg = (model.theme.palette[1]) || "#0b0c10";

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
  .grid { display: grid;
          grid-template-columns: repeat(${reels}, 88px);
          grid-template-rows: repeat(${rows}, 88px);
          gap: 6px; background: rgba(255,255,255,0.04);
          padding: 12px; border-radius: 16px;
          box-shadow: 0 8px 40px rgba(0,0,0,0.4); }
  .cell { background: #1f2833; border: 1px solid #2a3b4c;
          border-radius: 10px; display: flex; align-items: center; justify-content: center;
          font-size: 1.6rem; font-weight: 800; color: ${accent};
          transition: transform 0.15s, border-color 0.15s; }
  .cell.spin { animation: blur 0.4s linear; }
  .cell.win { border-color: ${accent}; box-shadow: 0 0 12px ${accent}; transform: scale(1.05); }
  @keyframes blur { 0% { filter: blur(0px); } 50% { filter: blur(6px); } 100% { filter: blur(0px); } }
  .controls { margin-top: 1.5rem; display: flex; gap: 1rem; align-items: center; }
  button { background: ${accent}; color: ${bg}; border: 0; border-radius: 10px;
           padding: 0.9rem 1.6rem; font-size: 1rem; font-weight: 800; cursor: pointer;
           transition: transform 0.15s, box-shadow 0.15s; }
  button:hover { transform: translateY(-1px); box-shadow: 0 4px 16px ${accent}55; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  .info { font-size: 0.8rem; color: #45a29e; }
  .footer { margin-top: 1.5rem; font-size: 0.65rem; color: #45a29e; opacity: 0.6; text-align: center; max-width: 600px; }
</style></head><body>

<h1>${escapeHtml(model.name)}</h1>
<div class="sub">${reels}×${rows} · ${model.topology.paylines} lines · ${escapeHtml(model.theme.tags.join(" · ") || "")}</div>

<div class="features-strip">
  ${model.features.map(f => `<span class="feat">${escapeHtml(f.label)}</span>`).join("") || `<span class="feat" style="opacity:0.4">no features</span>`}
</div>

<div class="grid" id="grid"></div>

<div class="controls">
  <button id="spinBtn">🎰 SPIN</button>
  <span class="info">Balance: <span id="bal">1000.00</span> · Last win: <span id="win">0.00</span></span>
</div>

<div class="footer">
  Math is <strong>placeholder dummy</strong> — uniform reels, linear paytable.<br>
  Real math (PAR sheet) hot-swap not yet implemented. Generated by Slot GDD Factory.
</div>

<script>
  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const REELS = ${reels};
  const ROWS = ${rows};
  const grid = document.getElementById("grid");
  const spinBtn = document.getElementById("spinBtn");
  const balEl = document.getElementById("bal");
  const winEl = document.getElementById("win");
  let balance = 1000.00;
  const BET = 1.00;

  function randSym() { return POOL[Math.floor(Math.random() * POOL.length)]; }

  function renderGrid(syms, winSet = new Set()) {
    grid.innerHTML = "";
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        const idx = c * ROWS + r;
        const el = document.createElement("div");
        el.className = "cell" + (winSet.has(idx) ? " win" : "");
        el.textContent = syms[idx] || "?";
        grid.appendChild(el);
      }
    }
  }

  function initialGrid() {
    const syms = [];
    for (let i = 0; i < REELS * ROWS; i++) syms.push(randSym());
    renderGrid(syms);
  }

  function evalWin(syms) {
    /* dummy line check: middle row left-to-right same symbol */
    const mid = [];
    for (let c = 0; c < REELS; c++) mid.push(syms[c * ROWS + Math.floor(ROWS/2)]);
    let same = 1;
    for (let i = 1; i < mid.length; i++) {
      if (mid[i] === mid[0]) same++; else break;
    }
    if (same >= 3) {
      const payoutMap = { 3: 5, 4: 25, 5: 100 };
      const win = (payoutMap[same] || 0) * BET;
      const winSet = new Set();
      for (let i = 0; i < same; i++) winSet.add(i * ROWS + Math.floor(ROWS/2));
      return { win, winSet };
    }
    return { win: 0, winSet: new Set() };
  }

  function spin() {
    if (balance < BET) return;
    spinBtn.disabled = true;
    balance -= BET;
    balEl.textContent = balance.toFixed(2);
    winEl.textContent = "0.00";

    const cells = grid.querySelectorAll(".cell");
    cells.forEach(c => c.classList.add("spin"));

    setTimeout(() => {
      const syms = [];
      for (let i = 0; i < REELS * ROWS; i++) syms.push(randSym());
      const { win, winSet } = evalWin(syms);
      renderGrid(syms, winSet);
      if (win > 0) {
        balance += win;
        balEl.textContent = balance.toFixed(2);
        winEl.textContent = win.toFixed(2);
      }
      spinBtn.disabled = false;
    }, 420);
  }

  spinBtn.addEventListener("click", spin);
  initialGrid();
</script>
</body></html>`;
  }

  /* ─── download IR JSON ───────────────────────────────── */
  function downloadIR(model, fileName) {
    const blob = new Blob([JSON.stringify(model, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.replace(/\.[^.]+$/, "") + ".ir.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  /* ─── util ───────────────────────────────────────────── */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[c]);
  }
})();
