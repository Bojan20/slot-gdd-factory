/* =============================================================
   Slot GDD Factory · app.js
   One-button GDD upload → parsed model → playable slot in new tab.
   ESM module. Parser logic lives in src/parser.mjs (Node-testable).
   ============================================================= */

import { parseGDD, normalizeFromJSON } from "./src/parser.mjs";
import { buildGridShape } from "./src/gridShape.mjs";
import { buildSlotHTML } from "./src/buildSlotHTML.mjs";
import * as pdfjsLib from "./node_modules/pdfjs-dist/build/pdf.mjs";
import { pdfTextToMarkdown } from "./src/pdfToMarkdown.mjs";

/* PDF.js 6.x MORA imati workerSrc set pre prvog getDocument() poziva, inače
   throws "No GlobalWorkerOptions.workerSrc specified". Worker bundle živi
   uz pdf.mjs u istom direktorijumu. */
pdfjsLib.GlobalWorkerOptions.workerSrc = "./node_modules/pdfjs-dist/build/pdf.worker.mjs";

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

  /* ─── extractors for binary formats ──────────────────── */
  async function extractTextFromPDF(arrayBuffer) {
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    let text = '';
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      text += content.items.map(item => item.str).join(' ') + '\n\n';
    }
    return text;
  }

  async function extractTextFromDOCX(arrayBuffer) {
    if (!window.mammoth) {
      throw new Error('Mammoth library not loaded — proveri da li je <script src> tag prisutan u index.html');
    }
    const result = await window.mammoth.extractRawText({ arrayBuffer });
    return result.value;
  }

  /* ─── ingest ─────────────────────────────────────────── */
  async function handleFile(file) {
    const ext = file.name.split(".").pop().toLowerCase();
    resultEl.innerHTML = `<div class="card"><h3>📖 Extracting text from ${escapeHtml(file.name)}…</h3></div>`;
    try {
      let text;
      let isBinary = false;
      if (ext === 'pdf') {
        text = await extractTextFromPDF(await file.arrayBuffer());
        isBinary = true;
      } else if (ext === 'docx' || ext === 'doc') {
        text = await extractTextFromDOCX(await file.arrayBuffer());
        isBinary = true;
      } else {
        text = await file.text();
      }
      /* CRITICAL: PDF.js / mammoth flatten markdown structure into a single
         text stream — naslovi, tabele, formatting su izgubljeni. Parser.mjs
         očekuje markdown sintaksu (`#`, `|`, `###`). Ako je izvor binarni
         (PDF/DOCX), pre prosleđivanja parser-u prvo prolazi kroz heuristički
         markdown adapter koji rekonstruiše H1/H2/H3 naslove + bucket
         paytable tabele iz prepoznatih GDD obrazaca.

         2026-06-10 — Boki bug "029 prevuko — crveni X, nema simbola,
         nema feature-a". Sintetic PDFs (generated from rich MD via
         pandoc) retain enough structure that PDF.js extracts a text
         which ALREADY contains `## Topology`, `## Symbols`, `### High-pay`
         markers and pipe tables. Sending such input through
         `pdfTextToMarkdown` re-builds a generic skeleton that DISCARDS
         sintetic-specific symbols + features. Detect that case (text
         already has ≥3 `## `-prefixed headers) and forward the raw
         text straight to parser.mjs. */
      if (isBinary) {
        const headerCount = (text.match(/##\s+\S/g) || []).length;
        const looksLikeMd = headerCount >= 3 && text.length > 500;
        if (looksLikeMd) {
          /* PDF retained Markdown structure — skip the adapter so we
             don't lose sintetic-specific symbols/features. */
        } else {
          const mdShape = pdfTextToMarkdown(text);
          if (mdShape && mdShape.length > 80) {
            text = mdShape;
          }
        }
      }
      const model = parseGDD(text, ext === 'json' ? 'json' : 'md');
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

    /* Wave UQ2 — segment-based games (wheel/plinko/slingo) carry their
       playable content in wheelBonus.segments, plinko buckets, etc. — not
       in HP/MP/LP rosters. Show a Wheel Segments card so a wheel GDD doesn't
       look like a broken upload (Boki 029-bug: "nema simbola crveni se X"). */
    const _evalKind = model.topology && (model.topology.evaluation || model.topology.kind);
    const _isWheel = _evalKind === 'wheel';
    const _wheelSegs = (model.wheelBonus && Array.isArray(model.wheelBonus.segments)) ? model.wheelBonus.segments : [];
    const _wheelWeights = (model.weightedWheelSegments && Array.isArray(model.weightedWheelSegments.weights)) ? model.weightedWheelSegments.weights : null;
    const _segChips = _isWheel && _wheelSegs.length ? _wheelSegs.map((s, i) => {
      const w = _wheelWeights && Number.isFinite(_wheelWeights[i]) ? ` · w=${_wheelWeights[i]}` : '';
      const tier = s.jackpotTier ? ' 🏆' : '';
      const swatch = `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color || '#c0a850'};margin-right:6px;vertical-align:middle"></span>`;
      return `<span class="chip">${swatch}<strong>${escapeHtml(String(s.label || ''))}</strong>${tier}${w}</span>`;
    }).join('') : '';

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
        <h3>🎯 Symbols (${symTotal})${_isWheel ? ' <span style="font-size:0.7rem;color:#9aa;font-weight:400">· auto-fill (wheel mode)</span>' : ''}</h3>
        <div class="row">${symChips || `<span class="chip">no symbols detected</span>`}</div>
      </div>

      ${_isWheel && _segChips ? `
      <div class="card">
        <h3>🎡 Wheel segments (${_wheelSegs.length})</h3>
        <div class="row">${_segChips}</div>
      </div>` : ''}

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

    /* AUTO-OPEN preview — Boki direktiva: "ja prevucem GDD a ništa se ne
       desi". Dropzone uploadovan → preview iframe se ODMAH renderuje, bez
       potrebe za klikom. Pop-out button i dalje radi za pun tab. */
    try { openPlayableSlot(model); } catch (e) { console.error("auto-preview failed:", e); }
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
      /* Wave UQ2 — wheel/plinko/slingo: re-label the row + re-summarize.
         Coverage Report previously read "❌ Symbols not found" for a clean
         wheel GDD even though the wheel block was fully populated. */
      (() => {
        const evalKind = model.topology && (model.topology.evaluation || model.topology.kind);
        if (evalKind === 'wheel') {
          const segs = (model.wheelBonus && Array.isArray(model.wheelBonus.segments)) ? model.wheelBonus.segments : [];
          return {
            label: "Wheel segments",
            conf: model.confidence.symbols,
            found: segs.length > 0 ? `${segs.length} segment(s) · ${segs.filter(s => s.jackpotTier).length} jackpot tier(s)` : null,
          };
        }
        return {
          label: "Symbols",
          conf: model.confidence.symbols,
          found: symTotal > 0 ? `${symTotal} (HP=${model.symbols.high.length} MP=${model.symbols.mid.length} LP=${model.symbols.low.length} ★=${model.symbols.specials.length})` : null,
        };
      })(),
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

  /* ─── render standalone slot — INLINE preview + popout fallback ────────
     Razlog: window.open(blob:URL, "_blank") tiho blokira Safari/Chrome
     popup-blocker u ~90% slučajeva čak i kad je trigger user click.
     Inline iframe + same-origin doc.write daje Boki-ju instant playable
     preview bez ijednog browser warning-a. Popout dugme i dalje postoji
     za pun tab; ako popup pada, fallback na download .html. */
  function openPlayableSlot(model) {
    const html = buildSlotHTML(model);

    let previewWrap = document.getElementById("previewWrap");
    if (!previewWrap) {
      previewWrap = document.createElement("div");
      previewWrap.id = "previewWrap";
      previewWrap.style.cssText = "width:100%;max-width:1280px;margin:1.5rem auto 0;padding:1rem;background:#0b0c10;border:1px solid #45a29e;border-radius:12px";
      resultEl.parentNode.appendChild(previewWrap);
    }
    previewWrap.innerHTML = `
      <div style="display:flex;gap:0.8rem;align-items:center;justify-content:space-between;margin-bottom:0.75rem;flex-wrap:wrap">
        <strong style="color:#66fcf1;font-size:0.95rem">🎰 Playable preview · ${escapeHtml(model.name)}</strong>
        <div style="display:flex;gap:0.5rem">
          <button class="btn btn-ghost" id="reloadPreviewBtn" style="font-size:0.72rem;padding:0.35rem 0.75rem">↻ Reload</button>
          <button class="btn btn-ghost" id="popoutBtn" style="font-size:0.72rem;padding:0.35rem 0.75rem">↗ Open in new tab</button>
        </div>
      </div>
      <iframe id="previewFrame" style="width:100%;height:80vh;min-height:640px;border:1px solid #243442;border-radius:10px;background:#05070c;display:block"></iframe>
    `;
    const iframe = document.getElementById("previewFrame");
    const doc = iframe.contentDocument || iframe.contentWindow.document;
    doc.open();
    doc.write(html);
    doc.close();

    document.getElementById("reloadPreviewBtn").addEventListener("click", () => openPlayableSlot(model));
    document.getElementById("popoutBtn").addEventListener("click", () => {
      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const tab = window.open(url, "_blank");
      if (!tab) {
        /* Fallback: download as .html so Boki može direktno da dvoklikne */
        const a = document.createElement("a");
        a.href = url;
        a.download = (model.name || "slot").replace(/[^a-z0-9-]/gi, "-").toLowerCase() + ".html";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
      }
    });

    previewWrap.scrollIntoView({ behavior: "smooth", block: "start" });
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
