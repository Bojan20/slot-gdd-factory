/* =============================================================
   Slot GDD Factory · app.js
   One-button GDD upload → parsed model → playable slot in new tab.
   ESM module. Parser logic lives in src/parser.mjs (Node-testable).
   ============================================================= */

import { parseGDD, normalizeFromJSON } from "./src/parser.mjs";

(() => {
  "use strict";

  const dropzone = document.getElementById("dropzone");
  const fileInput = document.getElementById("fileInput");
  const resultEl = document.getElementById("result");

  const LAST_GDD_KEY = "slotgdd.factory.lastGDD";

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
      /* persist last GDD so refresh restores it (text only — small) */
      try {
        localStorage.setItem(LAST_GDD_KEY, JSON.stringify({
          name: file.name, ext, text, at: Date.now(),
        }));
      } catch {}
      renderResult(model, file.name);
    } catch (err) {
      resultEl.innerHTML = `<div class="error">❌ ${escapeHtml(err.message)}</div>`;
      console.error(err);
    }
  }

  /* ─── auto-restore last GDD on page load ─────────────── */
  function tryRestoreLastGDD() {
    try {
      const raw = localStorage.getItem(LAST_GDD_KEY);
      if (!raw) return;
      const last = JSON.parse(raw);
      if (!last?.text) return;
      /* small banner letting user one-click reload */
      const banner = document.createElement("div");
      banner.style.cssText = "position:fixed;top:10px;right:10px;background:#1f2833;border:1px solid #45a29e;border-radius:10px;padding:0.6rem 0.9rem;font-size:0.8rem;color:#c5c6c7;z-index:10;display:flex;gap:0.6rem;align-items:center;box-shadow:0 4px 16px rgba(0,0,0,0.4)";
      banner.innerHTML = `
        <span style="color:#66fcf1">⤺ Last GDD:</span>
        <strong style="color:#c5c6c7">${escapeHtml(last.name)}</strong>
        <button id="restoreBtn" style="background:#66fcf1;color:#0b0c10;border:0;border-radius:6px;padding:0.3rem 0.7rem;font-size:0.75rem;font-weight:800;cursor:pointer">RELOAD</button>
        <button id="restoreClose" style="background:transparent;color:#45a29e;border:0;cursor:pointer;font-size:1rem;padding:0 0.2rem">×</button>
      `;
      document.body.appendChild(banner);
      banner.querySelector("#restoreBtn").addEventListener("click", () => {
        const model = parseGDD(last.text, last.ext);
        renderResult(model, last.name);
        banner.remove();
      });
      banner.querySelector("#restoreClose").addEventListener("click", () => banner.remove());
    } catch {}
  }
  tryRestoreLastGDD();

  /* parser dispatch + helpers moved to src/parser.mjs (pure ESM, Node-testable) */

  /* parser, symbol/feature/math helpers ALL live in src/parser.mjs now —
     this file used to inline them; kept in module so the browser flow + the
     Node `npm test` suite share one source. */

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

    const coverageCard = buildCoverageCard(model);

    resultEl.innerHTML = `
      <div class="card">
        <h3>🧬 Parsed model · ${escapeHtml(fileName)}</h3>
        <div style="font-size:1.3rem;color:#66fcf1;font-weight:700;margin-bottom:0.75rem">${escapeHtml(model.name)}</div>
        <table>
          <tr><th>Layout</th><td>${model.topology.reels}×${model.topology.rows}${model.topology.evaluation === 'cluster' ? ' · cluster pays' : (model.topology.paylines ? ` · ${model.topology.paylines} lines` : '')}</td></tr>
          <tr><th>Evaluation</th><td>${escapeHtml(model.topology.evaluation || "lines")}</td></tr>
          <tr><th>Genre</th><td>${escapeHtml(model.theme.genre || "—")}</td></tr>
          <tr><th>Theme tags</th><td>${escapeHtml(model.theme.tags.join(" · ") || "—")}</td></tr>
          <tr><th>Mood</th><td>${escapeHtml(model.theme.mood || "—")}</td></tr>
          ${model.theme.setting ? `<tr><th>Setting</th><td>${escapeHtml(model.theme.setting)}</td></tr>` : ""}
          ${model.theme.typography ? `<tr><th>Typography</th><td>${escapeHtml(model.theme.typography)}</td></tr>` : ""}
          ${model.theme.vibe_refs ? `<tr><th>Vibe refs</th><td>${escapeHtml(model.theme.vibe_refs)}</td></tr>` : ""}
          ${model.theme.target_market ? `<tr><th>Market</th><td>${escapeHtml(model.theme.target_market)}</td></tr>` : ""}
        </table>
      </div>

      ${coverageCard}

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

  /* ─── build GDD Coverage Report card ──────────────────── */
  function buildCoverageCard(model) {
    const symTotal = model.symbols.high.length + model.symbols.mid.length +
                     model.symbols.low.length + model.symbols.specials.length;
    /* per-field rows: label, confidence (0..1), found-summary, status */
    const rows = [
      {
        label: "Name",
        conf: model.confidence.name,
        found: model.name && model.name !== "Untitled Slot" ? model.name : null,
      },
      {
        label: "Topology",
        conf: model.confidence.topology,
        found: `${model.topology.reels}×${model.topology.rows}${model.topology.evaluation === 'cluster' ? ' · cluster' : (model.topology.paylines ? ` · ${model.topology.paylines} lines` : '')} (${model.topology.evaluation || 'lines'})`,
      },
      {
        label: "Genre",
        conf: model.theme.genre ? 1.0 : 0,
        found: model.theme.genre || null,
      },
      {
        label: "Theme tags",
        conf: model.theme.tags.length > 0 ? 1.0 : 0,
        found: model.theme.tags.length ? `${model.theme.tags.length} tag(s)` : null,
      },
      {
        label: "Mood",
        conf: model.theme.mood ? 1.0 : 0,
        found: model.theme.mood ? model.theme.mood.slice(0, 40) + (model.theme.mood.length > 40 ? "…" : "") : null,
      },
      {
        label: "Setting",
        conf: model.theme.setting ? 1.0 : 0,
        found: model.theme.setting ? model.theme.setting.slice(0, 40) + (model.theme.setting.length > 40 ? "…" : "") : null,
      },
      {
        label: "Typography",
        conf: model.theme.typography ? 1.0 : 0,
        found: model.theme.typography ? model.theme.typography.slice(0, 40) + (model.theme.typography.length > 40 ? "…" : "") : null,
      },
      {
        label: "Vibe refs",
        conf: model.theme.vibe_refs ? 1.0 : 0,
        found: model.theme.vibe_refs ? model.theme.vibe_refs.slice(0, 40) + (model.theme.vibe_refs.length > 40 ? "…" : "") : null,
      },
      {
        label: "Palette",
        conf: model.theme.palette.length > 0 ? Math.min(1, model.theme.palette.length / 3) : 0,
        found: model.theme.palette.length ? `${model.theme.palette.length} hex color(s)` : null,
      },
      {
        label: "Symbols",
        conf: model.confidence.symbols,
        found: symTotal > 0 ? `${symTotal} (HP=${model.symbols.high.length} MP=${model.symbols.mid.length} LP=${model.symbols.low.length} ★=${model.symbols.specials.length})` : null,
      },
      {
        label: "Features",
        conf: model.confidence.features,
        found: model.features.length ? model.features.map(f => f.kind).join(", ") : null,
      },
    ];

    /* aggregate score = mean confidence */
    const totalConf = rows.reduce((sum, r) => sum + r.conf, 0) / rows.length;
    const pct = Math.round(totalConf * 100);
    const scoreColor = pct >= 80 ? "#66fcf1" : pct >= 50 ? "#ffd166" : "#ff6b6b";

    const rowsHtml = rows.map(r => {
      const cPct = Math.round(r.conf * 100);
      const status = r.conf >= 0.8 ? "✅" : r.conf >= 0.5 ? "⚠️" : "❌";
      const barColor = r.conf >= 0.8 ? "#66fcf1" : r.conf >= 0.5 ? "#ffd166" : "#ff6b6b";
      const summary = r.found || `<span style="color:#ff6b6b">not found</span>`;
      return `
        <tr>
          <td style="font-weight:600;color:#c5c6c7">${status} ${r.label}</td>
          <td style="font-size:0.78rem;color:#9aa">${summary}</td>
          <td style="width:130px">
            <div style="background:#0b0c10;border:1px solid #2a3b4c;border-radius:6px;height:8px;overflow:hidden">
              <div style="background:${barColor};height:100%;width:${cPct}%;transition:width 0.4s"></div>
            </div>
            <div style="font-size:0.7rem;color:#45a29e;text-align:right;margin-top:2px">${cPct}%</div>
          </td>
        </tr>`;
    }).join("");

    return `
      <div class="card">
        <h3>📊 GDD Coverage Report
          <span style="float:right;color:${scoreColor};font-weight:800">${pct}%</span>
        </h3>
        <table style="margin-top:0.5rem">${rowsHtml}</table>
      </div>`;
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

    const layoutSub = model.topology.evaluation === 'cluster'
      ? `${reels}×${rows} · cluster pays`
      : `${reels}×${rows} · ${model.topology.paylines || ''} lines`;

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

<div class="grid" id="grid"></div>

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
  const BETS = [1, 2, 5, 10, 25, 50];
  const STORE_KEY = "slotgdd.template." + ${JSON.stringify(model.name)}.replace(/\\W+/g, "_");

  const grid = document.getElementById("grid");
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
      const win = (payoutMap[same] || 0) * BETS[betIdx];
      const winSet = new Set();
      for (let i = 0; i < same; i++) winSet.add(i * ROWS + Math.floor(ROWS/2));
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
      for (let i = 0; i < REELS * ROWS; i++) syms.push(randSym());
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
