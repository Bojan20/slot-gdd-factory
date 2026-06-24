/**
 * src/blocks/backendSpinEngine.mjs
 *
 * LV3-3 — Backend spin engine adapter (MATH-INTEGRATION-LV3 · Boki
 * 2026-06-24).
 *
 * Purpose
 *   Wraps the in-browser spin pipeline tako da svaki postSpin tick
 *   takođe poziva math-backend HTTP server `POST /spin` da povuče
 *   per-spin outcome (payX) iz cached Rust batch distribucije. Result
 *   se postavi u window.__BACKEND_LAST_SPIN__ i feed-uje liveRtpHud
 *   preko HookBus emit-a 'onBackendSpinSampled'.
 *
 *   ENGINE NE ZAMENJUJE JS RNG za reel-draw — to bi bio veći refaktor
 *   (W244+). Umesto toga, blok shadow-uje JS spin sa backend-sampled
 *   payX, tako da measured RTP na HUD-u dolazi iz Rust kernela, ne iz
 *   browser RNG. Side-channel: dva sample-a koegzistiraju, HUD bira
 *   backend kao source-of-truth.
 *
 *   Anti-AI guardrail: SAMO HTTP fetch ka deterministic Rust binary,
 *   nikakav LLM poziv.
 *
 * Public API
 *   defaultConfig() / resolveConfig(model)
 *   emitBackendSpinEngineRuntime(cfg, model)
 *
 * Lifecycle
 *   subscribes:
 *     postSpin → fetch /spin sa sessionId, store outcome
 *   emits:
 *     onBackendSpinSampled { sessionId, payX, measuredRtp, n, fsTrigger, hnwTrigger }
 *
 * Window globals (read-only):
 *   __BACKEND_LAST_SPIN__   {payX, measuredRtp, n, ...}
 *   __BACKEND_SESSION_ID__  string
 *   __BACKEND_STATUS__      'online' | 'offline' | 'pending'
 */

export function defaultConfig() {
  return Object.freeze({
    enabled: true,
    backendBase: 'http://127.0.0.1:9001',
    /* Initial probe timeout (ms) — if backend doesn't respond in N ms,
     * fall back to JS-only mode without retry. */
    probeTimeoutMs: 1500,
    /* Per-spin fetch timeout (ms). Backend should respond < 10ms. */
    spinTimeoutMs: 3000,
    /* Max consecutive fetch failures before declaring backend offline. */
    maxConsecutiveErrors: 3,
  });
}

export function resolveConfig(model = {}) {
  const c = { ...defaultConfig() };
  const src = (model && model.backendSpinEngine) || {};
  if (src.enabled === false) c.enabled = false;
  if (typeof src.backendBase === 'string' && /^https?:\/\//.test(src.backendBase)) {
    c.backendBase = src.backendBase;
  }
  return c;
}

export function emitBackendSpinEngineRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) return `/* backendSpinEngine: disabled */`;
  const cfgJSON = JSON.stringify({
    backendBase: cfg.backendBase,
    probeTimeoutMs: cfg.probeTimeoutMs,
    spinTimeoutMs: cfg.spinTimeoutMs,
    maxConsecutiveErrors: cfg.maxConsecutiveErrors,
  });
  /* Embed pruned model — only fields backend needs (payback, freeSpins,
   * holdAndWin). Anti-XSS: safeJSONInScript handled by callers wrapping. */
  const pruned = {
    payback: model.payback || null,
    freeSpins: model.freeSpins ? {
      triggerProbability: model.freeSpins.triggerProbability,
      sessionExpectedValue: model.freeSpins.sessionExpectedValue,
      sessionStdDev: model.freeSpins.sessionStdDev,
    } : null,
    holdAndWin: model.holdAndWin ? {
      triggerProbability: model.holdAndWin.triggerProbability,
      sessionExpectedValue: model.holdAndWin.sessionExpectedValue,
      sessionStdDev: model.holdAndWin.sessionStdDev,
    } : null,
  };
  const modelJSON = JSON.stringify(pruned);
  return `
/* ── backendSpinEngine BLOCK runtime ─────────────────────────────── */
(function () {
  var BSE_CFG = ${cfgJSON};
  var BSE_MODEL = ${modelJSON};
  var BSE_SESSION = 'slot-' + Math.random().toString(36).slice(2, 10);
  var BSE_STATUS = 'pending';
  var BSE_ERRORS = 0;

  window.__BACKEND_SESSION_ID__ = BSE_SESSION;
  window.__BACKEND_STATUS__ = BSE_STATUS;
  window.__BACKEND_LAST_SPIN__ = null;

  function setStatus(s) {
    BSE_STATUS = s;
    window.__BACKEND_STATUS__ = s;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onBackendStatusChanged', { status: s }); } catch (_) {}
    }
  }

  /* Probe backend health on boot. */
  function probe() {
    var ctrl = new AbortController();
    var timeoutId = setTimeout(function () { ctrl.abort(); }, BSE_CFG.probeTimeoutMs);
    fetch(BSE_CFG.backendBase + '/health', { signal: ctrl.signal })
      .then(function (r) { clearTimeout(timeoutId); return r.ok ? r.json() : null; })
      .then(function (j) { setStatus(j && j.ok ? 'online' : 'offline'); })
      .catch(function () { clearTimeout(timeoutId); setStatus('offline'); });
  }

  function fetchSpin() {
    if (BSE_STATUS === 'offline') return Promise.resolve(null);
    var ctrl = new AbortController();
    var timeoutId = setTimeout(function () { ctrl.abort(); }, BSE_CFG.spinTimeoutMs);
    return fetch(BSE_CFG.backendBase + '/spin', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId: BSE_SESSION, model: BSE_MODEL }),
      signal: ctrl.signal,
    })
    .then(function (r) { clearTimeout(timeoutId); return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.ok) {
        BSE_ERRORS++;
        if (BSE_ERRORS >= BSE_CFG.maxConsecutiveErrors) setStatus('offline');
        return null;
      }
      BSE_ERRORS = 0;
      if (BSE_STATUS !== 'online') setStatus('online');
      window.__BACKEND_LAST_SPIN__ = j;
      if (window.HookBus && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onBackendSpinSampled', {
            sessionId: j.sessionId,
            payX: j.payX,
            measuredRtp: j.measuredRtp,
            n: j.sessionN,
            fsTrigger: j.fsTrigger,
            hnwTrigger: j.hnwTrigger,
          });
        } catch (_) {}
      }
      /* Auto-update liveRtpHud sa backend-sampled payX rather than browser estimate. */
      if (typeof window.__LIVE_RTP_RECORD__ === 'function' && typeof j.payX === 'number') {
        try { window.__LIVE_RTP_RECORD__(j.payX); } catch (_) {}
      }
      return j;
    })
    .catch(function (_e) {
      clearTimeout(timeoutId);
      BSE_ERRORS++;
      if (BSE_ERRORS >= BSE_CFG.maxConsecutiveErrors) setStatus('offline');
      return null;
    });
  }

  window.__BACKEND_FETCH_SPIN__ = fetchSpin;

  /* HookBus wire — sample backend spin on every postSpin. Priority -200
   * so we run AFTER everything else (including liveRtpHud which is -100).
   * The backend payX OVERWRITES the JS estimate via __LIVE_RTP_RECORD__. */
  function wireHooks() {
    if (!window.HookBus || typeof window.HookBus.on !== 'function') return;
    try {
      window.HookBus.on('postSpin', function () { fetchSpin(); }, { priority: -200 });
    } catch (_) {}
  }

  /* Boot sequence. */
  probe();
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
