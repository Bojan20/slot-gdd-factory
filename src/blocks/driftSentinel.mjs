/**
 * src/blocks/driftSentinel.mjs
 *
 * LV3-6 — Drift sentinel (MATH-INTEGRATION-LV3 · Boki 2026-06-24).
 *
 * Listens for onDriftAlert / onLiveRtpUpdate events i prikazuje toast
 * notifikaciju kada measured RTP devijaa van zelene zone preko određeno
 * vreme. NE prikazuje toast za prvi N spinova (warming) — samo posle
 * stable threshold-a.
 *
 * Anti-vendor: zero vendor names, samo numeric thresholds.
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    /* Min spins before sentinel emits alerts (avoids noise during cold start). */
    warmupSpins: 100,
    /* Alert cooldown — same level alerts suppressed within N ms. */
    cooldownMs: 30_000,
    /* Auto-dismiss toast after N ms. */
    autoDismissMs: 8000,
  });
}

export function resolveConfig(model = {}) {
  const c = { ...defaultConfig() };
  const src = (model && model.driftSentinel) || {};
  if (src.enabled === false) c.enabled = false;
  if (Number.isFinite(src.warmupSpins)) c.warmupSpins = Math.max(0, Math.round(src.warmupSpins));
  return c;
}

export function emitDriftSentinelCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
.drift-toast {
  position: fixed; top: 80px; right: 12px; z-index: 70;
  background: rgba(5,7,12,0.95);
  border-left: 3px solid #f59e0b;
  padding: 8px 12px;
  font-family: ui-monospace, "SF Mono", Consolas, monospace;
  font-size: 11px;
  color: #f2f2f2;
  border-radius: 4px;
  min-width: 220px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  opacity: 0; transform: translateY(-8px);
  transition: opacity 0.25s, transform 0.25s;
  pointer-events: none;
}
.drift-toast.visible { opacity: 1; transform: translateY(0); }
.drift-toast.amber { border-left-color: #f59e0b; }
.drift-toast.red { border-left-color: #ef4444; }
.drift-toast .dt-head { font-weight: 700; margin-bottom: 2px; }
.drift-toast.amber .dt-head { color: #f59e0b; }
.drift-toast.red .dt-head { color: #ef4444; }
.drift-toast .dt-body { color: #ccc; font-size: 10px; }
`;
}

export function emitDriftSentinelMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div class="drift-toast" id="driftToast" role="status" aria-live="polite"><div class="dt-head" id="dtHead"></div><div class="dt-body" id="dtBody"></div></div>`;
}

export function emitDriftSentinelRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* driftSentinel: disabled */`;
  const cfgJSON = JSON.stringify({
    warmupSpins: cfg.warmupSpins,
    cooldownMs: cfg.cooldownMs,
    autoDismissMs: cfg.autoDismissMs,
  });
  return `
/* ── driftSentinel BLOCK runtime ────────────────────────────────── */
(function () {
  var DS_CFG = ${cfgJSON};
  var DS_STATE = { lastLevel: null, lastAlertTs: 0 };

  function showToast(level, deltaPct, n) {
    var el = document.getElementById('driftToast');
    if (!el) return;
    el.classList.remove('amber', 'red', 'visible');
    el.classList.add(level);
    var head = document.getElementById('dtHead');
    var body = document.getElementById('dtBody');
    if (head) head.textContent = level === 'red'
      ? '⚠ RTP DRIFT ALERT — ' + deltaPct.toFixed(2) + '%'
      : '⚠ RTP DRIFT — ' + deltaPct.toFixed(2) + '%';
    if (body) body.textContent = 'After ' + n + ' spins, measured vs target drift exceeds threshold.';
    /* Trigger paint then add visible class. */
    requestAnimationFrame(function () { el.classList.add('visible'); });
    setTimeout(function () { el.classList.remove('visible'); }, DS_CFG.autoDismissMs);
  }

  function onAlert(p) {
    if (!p || (p.level !== 'amber' && p.level !== 'red')) return;
    var hud = window.__LIVE_RTP_HUD__;
    if (!hud || hud.n < DS_CFG.warmupSpins) return;  /* warmup */
    var now = Date.now();
    /* Same level cooldown. */
    if (DS_STATE.lastLevel === p.level && (now - DS_STATE.lastAlertTs) < DS_CFG.cooldownMs) return;
    DS_STATE.lastLevel = p.level;
    DS_STATE.lastAlertTs = now;
    showToast(p.level, p.deltaPct || 0, hud.n);
  }

  function wireHooks() {
    if (!window.HookBus || typeof window.HookBus.on !== 'function') return;
    try { window.HookBus.on('onDriftAlert', onAlert); } catch (_) {}
  }
  if (window.HookBus) wireHooks();
  else {
    var ck = setInterval(function () {
      if (window.HookBus) { wireHooks(); clearInterval(ck); }
    }, 100);
    setTimeout(function () { clearInterval(ck); }, 10000);
  }
})();
`;
}
