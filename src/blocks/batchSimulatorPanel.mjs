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
.batch-sim-panel {
  position: fixed; bottom: 12px; right: 12px; z-index: 60;
  background: rgba(5,7,12,0.92);
  border: 1px solid rgba(56,189,248,0.4);
  border-radius: 8px;
  padding: 10px 12px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  color: #f2f2f2;
  min-width: 240px;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
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
.batch-sim-panel .bsp-out { font-size: 10px; line-height: 1.5; color: #ccc; min-height: 60px; }
.batch-sim-panel .bsp-out b { color: #f2f2f2; font-weight: 700; tabular-nums: true; font-variant-numeric: tabular-nums; }
.batch-sim-panel .bsp-out .pass { color: #38bd7c; }
.batch-sim-panel .bsp-out .fail { color: #ef4444; }
@media (max-width: 620px) { .batch-sim-panel { min-width: 180px; padding: 8px; } }
`;
}

export function emitBatchSimulatorPanelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const presetButtons = cfg.presets.map((p, i) =>
    `<button class="bsp-btn" data-spins="${p.spins}" data-label="${p.label}">${p.label}</button>`
  ).join('');
  return `
<div class="batch-sim-panel" id="batchSimPanel">
  <h4>MC Batch Simulator</h4>
  <div class="bsp-row">${presetButtons}</div>
  <div class="bsp-out" id="bspOut">Click a tier to run.</div>
</div>
`;
}

export function emitBatchSimulatorPanelRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) return `/* batchSimulatorPanel: disabled */`;
  const pruned = {
    payback: model.payback || null,
    freeSpins: model.freeSpins ? {
      triggerProbability: model.freeSpins.triggerProbability,
      sessionExpectedValue: model.freeSpins.sessionExpectedValue,
    } : null,
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
        .then(function (r) { return r.json(); })
        .then(function (j) {
          var wall = ((performance.now() - t0) / 1000).toFixed(2);
          if (!j || !j.ok) {
            out.innerHTML = '<span class="fail">✗ ' + (j && j.error ? j.error : 'backend offline') + '</span>';
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
          out.innerHTML = '<span class="fail">✗ ' + e.message + '</span>';
        })
        .finally(function () {
          panel.querySelectorAll('.bsp-btn').forEach(function (b) { b.disabled = false; });
          BSP_INFLIGHT = false;
        });
      });
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bspInit, { once: true });
  } else { bspInit(); }
})();
`;
}
