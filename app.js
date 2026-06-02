/* =============================================================
   Slot GDD Factory · app.js
   One-button GDD upload → parsed model → playable slot in new tab.
   ESM module. Parser logic lives in src/parser.mjs (Node-testable).
   ============================================================= */

import { parseGDD, normalizeFromJSON } from "./src/parser.mjs";
import { buildGridShape } from "./src/gridShape.mjs";
import { buildSlotHTML } from "./src/buildSlotHTML.mjs";

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

  /* buildSlotHTML is now in src/buildSlotHTML.mjs (DRY between app.js + tests) */

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
