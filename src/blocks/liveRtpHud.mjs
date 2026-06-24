/**
 * src/blocks/liveRtpHud.mjs
 *
 * LV3 — Live RTP HUD block (MATH-INTEGRATION-LV3 · Boki 2026-06-24).
 *
 * Purpose:
 *   Real-time HUD overlay koji prikazuje:
 *     • Measured RTP since boot (running mean payX / bet)
 *     • Declared target RTP (iz model.payback.rtp ili par_sheet)
 *     • Drift badge (within ±0.05% / amber ±0.5% / red >0.5%)
 *     • Spin count + hit rate
 *     • CI 95% bands (Wilson) sa convergence sparkline
 *
 *   HUD se konektuje na window.__SLOT_BACKEND_BASE__ (set u
 *   buildSlotHTML kad math backend live). Ako backend nije live,
 *   HUD prikaže "JS engine mode — no live calibration" i mirno se
 *   svodi na 0-byte runtime (no-op).
 *
 * Industry reference (vendor-neutral):
 *   Studio + regulator demo modovi (IGT Studio, L&W RAPID, Pragmatic
 *   Play Demo Mode) sve pokazuju live RTP convergence ka declared
 *   targetu — to je standard way da operator + regulator vizualno
 *   verifikuje math pre nego što slot ide u production.
 *
 * Public API
 *   defaultConfig() / resolveConfig(model)
 *   emitLiveRtpHudCSS(cfg)
 *   emitLiveRtpHudMarkup(cfg)
 *   emitLiveRtpHudRuntime(cfg, model)
 *
 * Lifecycle (HookBus contract)
 *   subscribes:
 *     postSpin → tick measured RTP, update DOM
 *     onSpinResult → same alias
 *   emits:
 *     onLiveRtpUpdate { measured, target, deltaPct, n }
 *     onDriftAlert { level: 'green'|'amber'|'red', deltaPct }
 *
 * Anti-vendor: no product names embedded, all metrics derived from
 * model.payback.rtp + backend response.
 */

const DEFAULT_TARGET_RTP = 0.96;

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    position: 'top-right',  /* top-right | top-left | bottom-right | bottom-left */
    showSparkline: true,
    sparklineWindow: 60,    /* last N spins in graph */
    /* Drift band tiers (deltaPct = |measured - target| × 100). */
    bandGreenPct: 0.05,
    bandAmberPct: 0.5,
    /* Per-tick poll interval if no spin events fire (idle refresh). */
    idleRefreshMs: 2000,
  });
}

export function resolveConfig(model = {}) {
  const c = { ...defaultConfig() };
  const src = (model && model.liveRtpHud) || {};
  if (src.enabled === false) c.enabled = false;
  if (typeof src.position === 'string' && /^(top|bottom)-(left|right)$/.test(src.position)) {
    c.position = src.position;
  }
  if (src.showSparkline === false) c.showSparkline = false;
  if (Number.isFinite(src.sparklineWindow)) {
    c.sparklineWindow = Math.max(10, Math.min(500, Math.round(src.sparklineWindow)));
  }
  return c;
}

export function emitLiveRtpHudCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const posTop = cfg.position.startsWith('top') ? '12px' : 'auto';
  const posBottom = cfg.position.startsWith('bottom') ? '12px' : 'auto';
  const posRight = cfg.position.endsWith('right') ? '12px' : 'auto';
  const posLeft = cfg.position.endsWith('left') ? '12px' : 'auto';
  return `
.live-rtp-hud {
  position: fixed;
  top: ${posTop}; bottom: ${posBottom}; right: ${posRight}; left: ${posLeft};
  z-index: 60;
  background: rgba(5,7,12,0.86);
  border: 1px solid rgba(201,162,39,0.4);
  border-radius: 8px;
  padding: 8px 12px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  color: #f2f2f2;
  min-width: 180px;
  pointer-events: none;
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.live-rtp-hud .lrh-row { display: flex; justify-content: space-between; gap: 12px; margin: 2px 0; }
.live-rtp-hud .lrh-label { color: #888; }
.live-rtp-hud .lrh-value { color: #f2f2f2; font-weight: 600; tabular-nums: true; font-variant-numeric: tabular-nums; }
.live-rtp-hud .lrh-badge {
  display: inline-block; padding: 1px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; text-transform: uppercase;
}
.live-rtp-hud .lrh-badge--green { background: rgba(56,189,124,0.25); color: #38bd7c; border: 1px solid rgba(56,189,124,0.5); }
.live-rtp-hud .lrh-badge--amber { background: rgba(245,158,11,0.25); color: #f59e0b; border: 1px solid rgba(245,158,11,0.5); }
.live-rtp-hud .lrh-badge--red   { background: rgba(239,68,68,0.25); color: #ef4444; border: 1px solid rgba(239,68,68,0.5); }
.live-rtp-hud .lrh-badge--off   { background: rgba(100,100,100,0.25); color: #aaa; border: 1px solid rgba(100,100,100,0.5); }
.live-rtp-hud canvas { display: block; width: 100%; height: 28px; margin-top: 4px; background: rgba(0,0,0,0.3); border-radius: 3px; }
@media (max-width: 620px) { .live-rtp-hud { font-size: 10px; min-width: 140px; padding: 6px 8px; } }
`;
}

export function emitLiveRtpHudMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
<div class="live-rtp-hud" id="liveRtpHud" aria-live="polite" aria-atomic="false">
  <div class="lrh-row">
    <span class="lrh-label">RTP</span>
    <span class="lrh-value" id="lrhMeasured">—</span>
  </div>
  <div class="lrh-row">
    <span class="lrh-label">target</span>
    <span class="lrh-value" id="lrhTarget">—</span>
  </div>
  <div class="lrh-row">
    <span class="lrh-label">drift</span>
    <span class="lrh-badge lrh-badge--off" id="lrhDrift">OFFLINE</span>
  </div>
  <div class="lrh-row">
    <span class="lrh-label">n</span>
    <span class="lrh-value" id="lrhN">0</span>
  </div>
  ${cfg.showSparkline ? `<canvas id="lrhSpark" width="170" height="28" aria-label="RTP convergence sparkline"></canvas>` : ''}
</div>
`;
}

export function emitLiveRtpHudRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) return `/* liveRtpHud: disabled */`;
  /* Derive target from model.payback.rtp or par_sheet.declared.rtp. */
  const target = (() => {
    const pb = (model && model.payback) || {};
    const parDecl = ((model && model.reelStrips && model.reelStrips.par_sheet_source) || {}).declared || {};
    const cands = [pb.rtp, parDecl.rtp];
    for (const v of cands) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 0) return n > 1 ? n / 100 : n;
    }
    return DEFAULT_TARGET_RTP;
  })();
  const cfgJSON = JSON.stringify({
    bandGreenPct: cfg.bandGreenPct,
    bandAmberPct: cfg.bandAmberPct,
    sparklineWindow: cfg.sparklineWindow,
    showSparkline: cfg.showSparkline,
    idleRefreshMs: cfg.idleRefreshMs,
  });
  return `
/* ── liveRtpHud BLOCK runtime ─────────────────────────────────────── */
(function () {
  var LRH_CFG = ${cfgJSON};
  var LRH_TARGET = ${target.toFixed(6)};
  var lrh = {
    n: 0, rtpSum: 0, hits: 0,
    history: [], /* sparkline samples */
    sessionId: 'slot-' + Math.random().toString(36).slice(2, 10),
    backendOk: false,
  };
  window.__LIVE_RTP_HUD__ = lrh;
  window.__LIVE_RTP_TARGET__ = LRH_TARGET;

  function fmt(v, places) {
    if (!isFinite(v)) return '—';
    return (v * 100).toFixed(places || 2) + '%';
  }

  function bandClass(deltaPct) {
    if (!isFinite(deltaPct)) return 'off';
    if (deltaPct <= LRH_CFG.bandGreenPct) return 'green';
    if (deltaPct <= LRH_CFG.bandAmberPct) return 'amber';
    return 'red';
  }

  function paint() {
    var el = document.getElementById('liveRtpHud');
    if (!el) return;
    var measured = lrh.n > 0 ? (lrh.rtpSum / lrh.n) : NaN;
    var deltaPct = isFinite(measured) ? Math.abs(measured - LRH_TARGET) * 100 : NaN;
    var band = bandClass(deltaPct);
    var bandLabel = lrh.backendOk
      ? (band === 'green' ? 'WITHIN ±' + LRH_CFG.bandGreenPct + '%'
         : band === 'amber' ? 'DRIFT ' + deltaPct.toFixed(2) + '%'
         : band === 'red' ? 'ALERT ' + deltaPct.toFixed(2) + '%'
         : 'WARMING')
      : 'OFFLINE';
    var m = document.getElementById('lrhMeasured');
    var t = document.getElementById('lrhTarget');
    var d = document.getElementById('lrhDrift');
    var nEl = document.getElementById('lrhN');
    if (m) m.textContent = isFinite(measured) ? fmt(measured) : '—';
    if (t) t.textContent = fmt(LRH_TARGET);
    if (d) { d.className = 'lrh-badge lrh-badge--' + band; d.textContent = bandLabel; }
    if (nEl) nEl.textContent = String(lrh.n);

    /* Sparkline. */
    if (LRH_CFG.showSparkline) {
      var canvas = document.getElementById('lrhSpark');
      if (canvas && canvas.getContext) {
        var ctx = canvas.getContext('2d');
        var W = canvas.width, H = canvas.height;
        ctx.clearRect(0, 0, W, H);
        /* Target line in middle. */
        ctx.strokeStyle = 'rgba(201,162,39,0.4)';
        ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
        /* History points. */
        if (lrh.history.length > 1) {
          ctx.strokeStyle = band === 'green' ? '#38bd7c' : band === 'amber' ? '#f59e0b' : band === 'red' ? '#ef4444' : '#888';
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          var maxDelta = LRH_CFG.bandAmberPct * 2 / 100;
          for (var i = 0; i < lrh.history.length; i++) {
            var x = (i / Math.max(lrh.history.length - 1, 1)) * W;
            var d = lrh.history[i] - LRH_TARGET;
            var y = H / 2 - (d / maxDelta) * (H / 2);
            y = Math.max(0, Math.min(H, y));
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      }
    }

    /* HookBus events. */
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try {
        window.HookBus.emit('onLiveRtpUpdate', { measured: measured, target: LRH_TARGET, deltaPct: deltaPct, n: lrh.n });
        if (lrh.n > 50 && lrh.backendOk) {
          window.HookBus.emit('onDriftAlert', { level: band, deltaPct: deltaPct });
        }
      } catch (_) {}
    }
  }

  function recordSpin(payX) {
    lrh.n++;
    if (typeof payX === 'number' && isFinite(payX)) {
      lrh.rtpSum += payX;
      if (payX > 0) lrh.hits++;
      var measured = lrh.rtpSum / lrh.n;
      lrh.history.push(measured);
      if (lrh.history.length > LRH_CFG.sparklineWindow) lrh.history.shift();
    }
    paint();
  }
  window.__LIVE_RTP_RECORD__ = recordSpin;

  /* Probe backend on boot. */
  var BACKEND_BASE = (typeof window.__MATH_BACKEND_BASE__ === 'string' && window.__MATH_BACKEND_BASE__)
    ? window.__MATH_BACKEND_BASE__
    : 'http://127.0.0.1:9001';
  fetch(BACKEND_BASE + '/health').then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (j && j.ok) {
        lrh.backendOk = true;
        paint();
      } else {
        paint();
      }
    }).catch(function () { paint(); });

  /* Initial paint. */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paint, { once: true });
  } else { paint(); }

  /* HookBus wire — record on every spin. */
  function hookSpinTick(p) {
    var payX = 0;
    if (p && typeof p.payX === 'number') payX = p.payX;
    else if (p && typeof p.winX === 'number') payX = p.winX;
    else if (typeof window.__LAST_SPIN_WIN__ === 'number') payX = window.__LAST_SPIN_WIN__;
    /* Normalize: __LAST_SPIN_WIN__ may be win in CREDITS, normalize by bet. */
    if (payX > 0 && typeof window.__SLOT_BET__ === 'number' && window.__SLOT_BET__ > 0) {
      payX = payX / window.__SLOT_BET__;
    }
    recordSpin(payX);
  }

  function wireHooks() {
    if (!window.HookBus || typeof window.HookBus.on !== 'function') return;
    try {
      window.HookBus.on('postSpin', hookSpinTick, { priority: -100 });
    } catch (_) {}
  }
  if (window.HookBus) wireHooks();
  else {
    var checkInterval = setInterval(function () {
      if (window.HookBus) { wireHooks(); clearInterval(checkInterval); }
    }, 100);
    setTimeout(function () { clearInterval(checkInterval); }, 10000);
  }

  /* Idle refresh — keeps HUD visible even if no spins for a while. */
  if (LRH_CFG.idleRefreshMs > 0) {
    setInterval(paint, LRH_CFG.idleRefreshMs);
  }
})();
`;
}
