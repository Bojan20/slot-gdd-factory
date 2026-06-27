import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/batchSimulatorPanel.mjs
 *
 * LV3-5 — Batch simulator panel (MATH-INTEGRATION-LV3 · Boki 2026-06-24).
 *
 * Floating bottom-right panel sa "Run 1M / 10⁹ spins" CTAs. Klik triggers
 * POST /batch ka math-backend-u, prikazuje measured RTP + Wilson 99% CI
 * + delta_bps + spins_per_sec u real-time-u.
 *
 * Anti-vendor / anti-AI: čist HTTP fetch ka Rust binary; nikakvi vendor
 * stringovi u UI-u, nikakvi LLM pozivi.
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    backendBase: 'http://127.0.0.1:9001',
    /* Batch tier presets. */
    presets: Object.freeze([
      { label: '10K', spins: 10_000 },
      { label: '100K', spins: 100_000 },
      { label: '1M', spins: 1_000_000 },
      { label: '10M', spins: 10_000_000 },
      { label: '100M', spins: 100_000_000 },
    ]),
  });
}

export function resolveConfig(model = {}) {
  const c = { ...defaultConfig() };
  const src = (model && model.batchSimulatorPanel) || {};
  if (src.enabled === false) c.enabled = false;
  if (typeof src.backendBase === 'string' && /^https?:\/\//.test(src.backendBase)) {
    c.backendBase = src.backendBase;
  }
  return c;
}

export function emitBatchSimulatorPanelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* UQ-DEEP-V (Boki 2026-06-24): bilo bottom-right fixed panel + preklapao
 * spin hub/credits display. Sad bottom-LEFT collapsed launcher → klik
 * otvara panel iznad (upward expand). Klik van panela ili Escape zatvara. */
.batch-sim-root {
  position: fixed;
  bottom: 12px;
  left: 12px;
  z-index: 61;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
}
.batch-sim-toggle {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  background: linear-gradient(180deg, rgba(56,189,248,.18), rgba(20,30,45,.95));
  border: 1px solid rgba(56,189,248,0.5);
  border-radius: 16px;
  color: #38bdf8;
  font: 700 11px/1 ui-monospace, monospace;
  letter-spacing: 0.05em;
  text-transform: uppercase;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0,0,0,0.4);
}
.batch-sim-toggle:hover { background: linear-gradient(180deg, rgba(56,189,248,.30), rgba(40,60,90,.95)); }
.batch-sim-toggle:focus-visible { outline: 2px solid rgba(56,189,248,.85); outline-offset: 2px; }
.batch-sim-toggle[aria-expanded="true"] { background: linear-gradient(180deg, rgba(56,189,248,.35), rgba(50,70,100,.95)); }
.batch-sim-toggle .bsp-caret { font-size: 0.85em; transition: transform 200ms; }
.batch-sim-toggle[aria-expanded="true"] .bsp-caret { transform: rotate(180deg); }
.batch-sim-panel {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: rgba(5,7,12,0.96);
  border: 1px solid rgba(56,189,248,0.4);
  border-radius: 8px;
  padding: 10px 12px;
  color: #f2f2f2;
  min-width: 260px;
  max-width: min(80vw, 360px);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.6);
}
.batch-sim-panel[hidden] { display: none; }
.batch-sim-panel h4 { margin: 0 0 6px 0; font-size: 11px; color: #38bdf8; letter-spacing: 0.04em; text-transform: uppercase; }
.batch-sim-panel .bsp-row { display: flex; gap: 4px; margin-bottom: 6px; }
.batch-sim-panel button {
  flex: 1; padding: 4px 6px; border: 1px solid rgba(56,189,248,0.4);
  background: rgba(56,189,248,0.1); color: #38bdf8;
  font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer;
  border-radius: 4px; transition: background 0.15s;
}
.batch-sim-panel button:hover:not(:disabled) { background: rgba(56,189,248,0.25); }
.batch-sim-panel button:disabled { opacity: 0.4; cursor: not-allowed; }
.batch-sim-panel .bsp-row--converge { margin-top: 4px; }
.batch-sim-panel .bsp-converge-btn {
  flex: 1; padding: 6px 8px;
  background: linear-gradient(180deg, rgba(201,162,39,.25), rgba(180,140,30,.15));
  border: 1px solid rgba(201,162,39,0.6);
  color: #f4eecf;
  font-family: inherit; font-size: 10px; font-weight: 700; cursor: pointer;
  border-radius: 4px; letter-spacing: 0.04em;
}
.batch-sim-panel .bsp-converge-btn:hover:not(:disabled) {
  background: linear-gradient(180deg, rgba(201,162,39,.45), rgba(180,140,30,.30));
}
.batch-sim-panel .bsp-converge-btn:disabled { opacity: 0.5; cursor: progress; }
.batch-sim-panel .bsp-out .ladder {
  display: block; margin-top: 4px; font-size: 9px; color: #999;
  font-variant-numeric: tabular-nums; line-height: 1.5;
}
.batch-sim-panel .bsp-out .ladder .pass-row { color: #38bd7c; }
.batch-sim-panel .bsp-out .ladder .fail-row { color: #999; }
.batch-sim-panel .bsp-out { font-size: 10px; line-height: 1.5; color: #ccc; min-height: 60px; }
.batch-sim-panel .bsp-out b { color: #f2f2f2; font-weight: 700; tabular-nums: true; font-variant-numeric: tabular-nums; }
.batch-sim-panel .bsp-out .pass { color: #38bd7c; }
.batch-sim-panel .bsp-out .fail { color: #ef4444; }
@media (max-width: 620px) {
  .batch-sim-root { bottom: 6px; left: 6px; }
  .batch-sim-panel { min-width: 200px; padding: 8px; }
}
`;
}

export function emitBatchSimulatorPanelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const presetButtons = cfg.presets.map((p, i) =>
    `<button class="bsp-btn" data-spins="${p.spins}" data-label="${p.label}">${p.label}</button>`
  ).join('');
  return tagBlockMarkup(`
<!-- UQ-DEEP-V (Boki 2026-06-24): batch panel sada collapsed launcher. -->
<div class="batch-sim-root">
  <button type="button" class="batch-sim-toggle" id="bspToggle"
          aria-expanded="false" aria-controls="batchSimPanel"
          aria-label="MC Batch Simulator (${cfg.presets.length} preset tiers)">
    <span>📊 MC Batch</span>
    <span class="bsp-caret" aria-hidden="true">▴</span>
  </button>
  <div class="batch-sim-panel" id="batchSimPanel" hidden>
    <h4>MC Batch Simulator</h4>
    <div class="bsp-row">${presetButtons}</div>
    <div class="bsp-row bsp-row--converge">
      <button class="bsp-converge-btn" id="bspConverge"
              aria-label="Auto-converge to target RTP (escalates 10K→100K→1M→10M→100M)">
        🎯 Auto-Converge to Target RTP
      </button>
    </div>
    <div class="bsp-out" id="bspOut">Click a tier to run, or 🎯 to auto-converge.</div>
  </div>
</div>
`, 'batchSimulatorPanel');
}

export function emitBatchSimulatorPanelRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) return `/* batchSimulatorPanel: disabled */`;
  /* UQ-DEEP-AD (Boki 2026-06-24): BSP_MODEL je pruning ka backend converge call-u.
   * Pre fix-a: samo payback + freeSpins → backend GAP inference NIJE imao
   * signal da hold-and-win postoji → hnw_session_e ostao na default 44.0 →
   * total 88.5% umesto 96.0% (off 7.5pp). Sada uključuje holdAndWin params
   * + features kind list (mali wire payload, ne ceo model).
   *
   * UQ-DEEP-AE (Boki 2026-06-24): stricter pruning — empty `holdAndWin:{}`
   * od parser-stage-5 inference (vendor-neutral tumble fixture) ne sme da
   * šalje enabled:true bez stvarne config (triggerCount). Backend onda
   * vidi hasHoldAndWin=true i daje phantom +40pp HnW contribution.
   * Sada: holdAndWin se prosleđuje SAMO ako ima triggerCount IS number
   * OR explicit triggerProbability/sessionExpectedValue. Isto za freeSpins. */
  const _featuresList = Array.isArray(model.features)
    ? model.features.filter(f => f && typeof f.kind === 'string').map(f => ({ kind: f.kind }))
    : [];
  const _featKinds = new Set(_featuresList.map(f => f.kind));
  const _hwHasReal = model.holdAndWin && (
    typeof model.holdAndWin.triggerCount === 'number' ||
    typeof model.holdAndWin.triggerProbability === 'number' ||
    typeof model.holdAndWin.sessionExpectedValue === 'number'
  );
  const _fsHasReal = model.freeSpins && (
    model.freeSpins.enabled === true ||
    Array.isArray(model.freeSpins.triggerCounts) ||
    typeof model.freeSpins.triggerProbability === 'number' ||
    typeof model.freeSpins.sessionExpectedValue === 'number'
  );
  const pruned = {
    /* UQ-DEEP-AI (Boki 2026-06-24): "nema vendor-coded ili imena bilo koje firme".
     * model.name može sadržati vendor-trademarked product brand —
     * scrub-uj pre emit-a u runtime BSP_MODEL. Backend ne treba ime za
     * convergence math. */
    name: null,
    payback: model.payback || null,
    freeSpins: _fsHasReal ? {
      enabled: model.freeSpins.enabled !== false,
      triggerProbability: model.freeSpins.triggerProbability,
      sessionExpectedValue: model.freeSpins.sessionExpectedValue,
      sessionStdDev: model.freeSpins.sessionStdDev,
    } : null,
    holdAndWin: _hwHasReal ? {
      enabled: model.holdAndWin.enabled !== false,
      triggerCount: model.holdAndWin.triggerCount,
      triggerProbability: model.holdAndWin.triggerProbability,
      sessionExpectedValue: model.holdAndWin.sessionExpectedValue,
      sessionStdDev: model.holdAndWin.sessionStdDev,
    } : null,
    /* Features list: keep only ones backed by real config OR explicit kind. */
    features: _featuresList.filter(f => {
      if (f.kind === 'hold_and_win') return _hwHasReal || _featKinds.has('hold_and_win');
      if (f.kind === 'free_spins') return _fsHasReal || _featKinds.has('free_spins');
      return true;
    }),
  };
  return `
/* ── batchSimulatorPanel BLOCK runtime ──────────────────────────── */
(function () {
  var BSP_BASE = ${JSON.stringify(cfg.backendBase)};
  var BSP_MODEL = ${JSON.stringify(pruned)};
  /* CRIT-4 fix (UQ-DEEP-N): in-flight guard. Klijent može da klikne 100M
   * dugme 10 puta dok prvi response stiže → 10 paralelnih batch-eva ka Rust
   * binary (DoS). Promise flag dedupes svaki burst, button.disabled je samo
   * vizualni hint (može da se by-passi keyboard / programmatically). */
  var BSP_INFLIGHT = false;
  /* CRIT-5 helper: deterministic seed per (model, spins) pair. */
  function bspFnv1a(s) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h & 0xffff;
  }
  function $ (id) { return document.getElementById(id); }
  function bspInit() {
    var panel = $('batchSimPanel');
    if (!panel) return;
    var out = $('bspOut');
    /* UQ-DEEP-V (Boki 2026-06-24): toggle launcher + click-outside +
     * Escape close. Panel default hidden — user mora kliknuti
     * 📊 MC Batch dugme da otvori. */
    var toggle = $('bspToggle');
    if (toggle) {
      function bspSetOpen(open) {
        toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (open) panel.removeAttribute('hidden');
        else panel.setAttribute('hidden', '');
      }
      toggle.addEventListener('click', function (e) {
        e.preventDefault(); e.stopPropagation();
        var isOpen = toggle.getAttribute('aria-expanded') === 'true';
        bspSetOpen(!isOpen);
      });
      document.addEventListener('click', function (e) {
        if (toggle.getAttribute('aria-expanded') !== 'true') return;
        if (toggle.contains(e.target) || panel.contains(e.target)) return;
        bspSetOpen(false);
      });
      document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if (toggle.getAttribute('aria-expanded') !== 'true') return;
        bspSetOpen(false);
        try { toggle.focus(); } catch (_) {}
      });
    }
    panel.querySelectorAll('.bsp-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (BSP_INFLIGHT) return;  /* dedupe spam clicks. */
        var spins = Number(btn.dataset.spins);
        var label = btn.dataset.label;
        if (!Number.isFinite(spins) || spins <= 0) return;
        BSP_INFLIGHT = true;
        panel.querySelectorAll('.bsp-btn').forEach(function (b) { b.disabled = true; });
        out.innerHTML = '⏳ Running <b>' + label + '</b> spins via Rust kernel...';
        var t0 = performance.now();
        var seed = bspFnv1a(JSON.stringify(BSP_MODEL) + ':' + spins);
        fetch(BSP_BASE + '/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ spins: spins, seed: seed, model: BSP_MODEL }),
        })
        /* HIGH-P5 (UQ-DEEP-P): check r.ok before r.json() so 500/HTML
         * doesn't throw silent SyntaxError into .catch. */
        .then(function (r) {
          if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (r.statusText || ''));
          return r.json();
        })
        .then(function (j) {
          var wall = ((performance.now() - t0) / 1000).toFixed(2);
          if (!j || !j.ok) {
            /* LOW-5 (UQ-DEEP-O): textContent for error path (XSS guard). */
            var errEl = document.createElement('span');
            errEl.className = 'fail';
            errEl.textContent = '✗ ' + (j && j.error ? j.error : 'backend offline');
            out.innerHTML = '';
            out.appendChild(errEl);
            return;
          }
          var rtp = (j.rtp * 100).toFixed(4);
          var target = (j.cf_target_rtp * 100).toFixed(4);
          var dbps = j.delta_bps != null ? j.delta_bps.toFixed(2) : 'n/a';
          var ci99 = (j.wilson_99_halfwidth * 100).toFixed(4);
          var verdict = j.convergence_pass
            ? '<span class="pass">✓ PASS</span>'
            : '<span class="fail">✗ FAIL</span>';
          out.innerHTML =
            '<b>' + label + ' spins</b> @ <b>' + (j.spins_per_sec ? Math.round(j.spins_per_sec/1e6) + 'M/s' : '?') + '</b> · wall <b>' + wall + 's</b><br>' +
            'measured <b>' + rtp + '%</b> · target <b>' + target + '%</b> · δ <b>' + dbps + ' bps</b><br>' +
            'Wilson CI 99% ± <b>' + ci99 + '%</b> · convergence ' + verdict + '<br>' +
            'hit <b>' + (j.hit_rate * 100).toFixed(2) + '%</b> · maxWin <b>' + (j.max_win_x != null ? Math.round(j.max_win_x) + 'x' : '?') + '</b>';
        })
        .catch(function (e) {
          /* LOW-5 (UQ-DEEP-O): textContent path — e.message may carry HTML. */
          var errEl = document.createElement('span');
          errEl.className = 'fail';
          errEl.textContent = '✗ ' + e.message;
          out.innerHTML = '';
          out.appendChild(errEl);
        })
        .finally(function () {
          panel.querySelectorAll('.bsp-btn').forEach(function (b) { b.disabled = false; });
          BSP_INFLIGHT = false;
        });
      });
    });

    /* UQ-DEEP-W (Boki 2026-06-24): Auto-Converge handler.
     * Klik → POST /converge → escalates 10K → 100K → 1M → 10M → 100M
     * Backend salje rounds[] sa per-round delta/halfwidth/pass status.
     * UI prikazuje ladder progress + final verdict. */
    var convergeBtn = $('bspConverge');
    if (convergeBtn) {
      convergeBtn.addEventListener('click', function () {
        if (BSP_INFLIGHT) return;
        BSP_INFLIGHT = true;
        panel.querySelectorAll('button').forEach(function (b) { b.disabled = true; });
        out.innerHTML = '🎯 Auto-Converge starting... eskaliracemo 10K → 100K → 1M → 10M → 100M dok ne postigne target.';
        var tcv = performance.now();
        fetch(BSP_BASE + '/converge', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: BSP_MODEL,
            maxSpins: 100_000_000,
            precisionPct: 0.005,     /* 0.5% RTP band */
            halfwidthBound: 0.01,    /* 1% Wilson 99% CI */
          }),
        })
        .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then(function (j) {
          var wall = ((performance.now() - tcv) / 1000).toFixed(2);
          if (!j || !j.ok) {
            var errEl = document.createElement('span');
            errEl.className = 'fail';
            errEl.textContent = '✗ ' + (j && j.error ? j.error : 'converge failed');
            out.innerHTML = '';
            out.appendChild(errEl);
            return;
          }
          var verdict = j.passed
            ? '<span class="pass">✓ CONVERGED</span>'
            : '<span class="fail">✗ DID NOT CONVERGE</span>';
          var html = '<b>Auto-Converge</b> ' + verdict + ' · wall <b>' + wall + 's</b><br>'
                   + 'total <b>' + Math.round(j.totalSpins/1000).toLocaleString() + 'K</b> spins · '
                   + 'final batch <b>' + Math.round(j.finalSpins/1000).toLocaleString() + 'K</b><br>';
          if (j.final) {
            html += 'measured <b>' + (j.final.rtp * 100).toFixed(4) + '%</b> · '
                  + 'target <b>' + (j.final.cf_target_rtp * 100).toFixed(4) + '%</b> · '
                  + 'δ <b>' + (j.final.delta_bps != null ? j.final.delta_bps.toFixed(2) : '?') + ' bps</b><br>'
                  + 'CI 99% ± <b>' + (j.final.wilson_99_halfwidth * 100).toFixed(4) + '%</b> · '
                  + 'hit <b>' + (j.final.hit_rate * 100).toFixed(2) + '%</b>';
          }
          /* Ladder breakdown. */
          if (Array.isArray(j.rounds) && j.rounds.length > 0) {
            html += '<span class="ladder">';
            for (var i = 0; i < j.rounds.length; i++) {
              var r = j.rounds[i];
              var k = (r.spins >= 1e6) ? (r.spins/1e6).toFixed(0) + 'M' : (r.spins/1e3).toFixed(0) + 'K';
              var cls = r.pass ? 'pass-row' : 'fail-row';
              html += '<span class="' + cls + '">'
                    + (r.pass ? '✓' : '·') + ' ' + k.padStart(4)
                    + ' · rtp ' + (r.rtp != null ? (r.rtp*100).toFixed(2) + '%' : '?')
                    + ' · δ ' + (r.deltaPct != null ? (r.deltaPct*100).toFixed(3) + '%' : '?')
                    + ' · CI ± ' + (r.halfwidth != null ? (r.halfwidth*100).toFixed(2) + '%' : '?')
                    + '</span>';
            }
            html += '</span>';
          }
          /* UQ-DEEP-AA: per-feature breakdown delta vs declared. */
          if (j.featureValidation) {
            var fv = j.featureValidation;
            var fvHtml = '<span class="ladder">';
            var rows = [
              { label: 'baseLine', row: fv.baseLine },
              { label: 'fsLine',   row: fv.fsLine },
              { label: 'holdWin',  row: fv.holdAndWin },
              { label: 'totalRtp', row: fv.totalRtp },
            ];
            for (var fi = 0; fi < rows.length; fi++) {
              var lbl = rows[fi].label;
              var rw = rows[fi].row;
              if (!rw || rw.declared == null) continue;
              var rcls = rw.pass === true ? 'pass-row' : (rw.pass === false ? 'fail-row' : 'fail-row');
              var mark = rw.pass === true ? '✓' : (rw.pass === false ? '✗' : '·');
              fvHtml += '<span class="' + rcls + '">'
                     + mark + ' ' + lbl.padEnd(9)
                     + ' declared ' + (rw.declared * 100).toFixed(2) + '%'
                     + ' · measured ' + (rw.measured != null ? (rw.measured * 100).toFixed(2) + '%' : '?')
                     + ' · δ ' + (rw.deltaPct != null ? rw.deltaPct.toFixed(3) + 'pp' : '?')
                     + '</span>';
            }
            fvHtml += '</span>';
            html += fvHtml;
          }
          out.innerHTML = html;
        })
        .catch(function (e) {
          var errEl = document.createElement('span');
          errEl.className = 'fail';
          errEl.textContent = '✗ ' + e.message;
          out.innerHTML = '';
          out.appendChild(errEl);
        })
        .finally(function () {
          panel.querySelectorAll('button').forEach(function (b) { b.disabled = false; });
          BSP_INFLIGHT = false;
        });
      });
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bspInit, { once: true });
  } else { bspInit(); }
})();
`;
}
