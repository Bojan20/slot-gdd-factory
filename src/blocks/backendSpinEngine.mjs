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

/* UQ-DEEP-AV N-P1-4 (Auditor N — SSRF guard):
 * GDD-supplied backendBase is attacker-controlled if MD/JSON ingest reads
 * untrusted file. Without host allowlist, attacker can exfiltrate /spin
 * payload (session id, model fingerprint) via http://attacker.example/x.
 * Allowlist: localhost variants + same-origin only. Operator can opt
 * into custom hosts via window.__BACKEND_ALLOWLIST__ (cert-time decision). */
function _isAllowedBackendHost(urlStr) {
  try {
    const u = new URL(urlStr);
    /* UQ-DEEP-AW O-P1-3 (Auditor O): unicode-confusable + punycode guard.
       URL().hostname returns ASCII (xn--…) form for IDN. Operator could
       put a unicode-rendered "localhost" in allowlist; attacker registers
       punycode that decodes to visually-identical string. Reject any
       xn-- prefix by default; normalize NFKC + lowercase for compare. */
    const host = String(u.hostname || '').normalize('NFKC').toLowerCase();
    /* UQ-DEEP-AX P-P1-3 (Auditor P): punycode reject moved AFTER allowlist
       match so legitimate IDN deployment (Asian/Cyrillic operator) opt-in
       via __BACKEND_ALLOWLIST__ works. Default still rejects unknown xn--. */
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1' || host === '[::1]') return true;
    if (typeof globalThis !== 'undefined' && globalThis.window
        && Array.isArray(globalThis.window.__BACKEND_ALLOWLIST__)) {
      const allow = globalThis.window.__BACKEND_ALLOWLIST__.map((h) => String(h).normalize('NFKC').toLowerCase());
      if (allow.includes(host)) return true;
    }
    /* Punycode reject moved here — after allowlist gives explicit opt-in. */
    if (host.startsWith('xn--') && !(typeof globalThis !== 'undefined' && globalThis.window && globalThis.window.__ALLOW_PUNYCODE_BACKEND__ === true)) return false;
    if (typeof globalThis !== 'undefined' && globalThis.location
        && String(globalThis.location.hostname || '').normalize('NFKC').toLowerCase() === host) return true;
    return false;
  } catch (_) { return false; }
}

export function resolveConfig(model = {}) {
  const c = { ...defaultConfig() };
  const src = (model && model.backendSpinEngine) || {};
  if (src.enabled === false) c.enabled = false;
  if (typeof src.backendBase === 'string' && /^https?:\/\//.test(src.backendBase)) {
    /* UQ-DEEP-AV N-P1-4: gate via allowlist. */
    if (_isAllowedBackendHost(src.backendBase)) {
      c.backendBase = src.backendBase;
    }
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
  /* HIGH-5 (UQ-DEEP-O) / MED-P7 (UQ-DEEP-P): mirror per-game maxWinX in
   * the client validator. Industry hard-cap (100000x) is OK as ceiling
   * but per-game cap × 1.5 is the right reject threshold for honest payX. */
  const perGameMaxX = (model.payback && Number.isFinite(model.payback.maxWinX))
    ? Math.min(model.payback.maxWinX * 1.5, 1_000_000)
    : 100_000;
  const modelJSON = JSON.stringify(pruned);
  const perGameMaxXJSON = JSON.stringify(perGameMaxX);
  return `
/* ── backendSpinEngine BLOCK runtime ─────────────────────────────── */
(function () {
  var BSE_CFG = ${cfgJSON};
  var BSE_MODEL = ${modelJSON};
  /* CRIT-5 fix (UQ-DEEP-N): deterministic sessionId. Compute FNV-1a hash
   * of pruned model JSON so two identical models always reuse same
   * backend session → reproducible. Random sessionId is regression vs
   * idempotency contract (Pass 1 = Pass 2 byte-identical). */
  function bseFnv1a(s) {
    var h = 0x811c9dc5 >>> 0;
    for (var i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(36);
  }
  /* UQ-DEEP-AB ATOM 6 (2026-06-24) — Per-player session salt.
   *
   * Without salt: BSE_SESSION = FNV1a(model) → 2 playera istom igrom
   * DELE ISTI session na backend-u. SESSION_CACHE akumulira spinSum/
   * rtpSum preko playera → measured-RTP reported za playera B
   * uključuje spinove playera A. Cross-player RTP contamination.
   *
   * Sad: ako window.__PLAYER_ID__ set (operator/RGS može da set-uje),
   * salt session ID sa tim. Inače: generate per-tab unique token koji
   * persistuje u sessionStorage (browsing session lifetime) — različiti
   * tabovi dobijaju različite sessione čak i bez RGS-supplied player ID.
   *
   * Idempotency preserved: pasivni replay (same browser tab, same model)
   * vraća isti session jer sessionStorage token is sticky. */
  var BSE_PLAYER_SALT = '';
  try {
    if (typeof window !== 'undefined' && window.__PLAYER_ID__) {
      BSE_PLAYER_SALT = String(window.__PLAYER_ID__);
    } else if (typeof sessionStorage !== 'undefined') {
      var KEY = '__SLOT_TAB_SALT__';
      BSE_PLAYER_SALT = sessionStorage.getItem(KEY) || '';
      if (!BSE_PLAYER_SALT) {
        BSE_PLAYER_SALT = (typeof crypto !== 'undefined' && crypto.randomUUID)
          ? crypto.randomUUID()
          : ('tab-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10));
        sessionStorage.setItem(KEY, BSE_PLAYER_SALT);
      }
    }
  } catch (_) { /* sessionStorage may be blocked in private mode */ }
  var BSE_SESSION = 'slot-' + bseFnv1a(JSON.stringify(BSE_MODEL) + ':' + BSE_PLAYER_SALT);
  var BSE_STATUS = 'pending';
  var BSE_ERRORS = 0;
  var BSE_INFLIGHT = false;  /* CRIT-3 helper: dedupe concurrent /spin fetches. */

  window.__BACKEND_SESSION_ID__ = BSE_SESSION;
  window.__BACKEND_STATUS__ = BSE_STATUS;
  window.__BACKEND_LAST_SPIN__ = null;

  /* UQ-LV3-QA-5-A #7 + QA-5-B #2 (Boki 2026-06-26): fallback audit.
   * Pre-fix: status flipped to offline silently — cert-pack couldn't
   * tell HOW MANY spins were Rust-served vs JS-fallback. Now we emit
   * onBackendFallback on every offline transition AND keep a cumulative
   * counter (window.__BACKEND_FALLBACK_COUNT__) plus a single-string
   * banner (window.__BACKEND_FALLBACK_LAST__) that cert-pack-export
   * reads when building the audit chain. No backticks in this comment
   * — it lives inside an outer template literal. */
  window.__BACKEND_FALLBACK_COUNT__ = 0;
  window.__BACKEND_FALLBACK_LAST__ = null;

  function setStatus(s) {
    var prev = BSE_STATUS;
    BSE_STATUS = s;
    window.__BACKEND_STATUS__ = s;
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      try { window.HookBus.emit('onBackendStatusChanged', { status: s }); } catch (_) {}
      if (s === 'offline' && prev !== 'offline') {
        window.__BACKEND_FALLBACK_COUNT__ += 1;
        window.__BACKEND_FALLBACK_LAST__ = {
          at: (typeof Date !== 'undefined') ? new Date().toISOString() : null,
          fromStatus: prev,
          totalTransitions: window.__BACKEND_FALLBACK_COUNT__,
        };
        try {
          window.HookBus.emit('onBackendFallback', window.__BACKEND_FALLBACK_LAST__);
        } catch (_) { /* swallow */ }
      }
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

  /* CRIT-3 fix (UQ-DEEP-N): validate payX bounds before trusting HUD.
   * Backend may return NaN / Infinity / negative / absurdly large value if
   * Rust binary crashes mid-batch or session metrics corrupt.
   * HIGH-5 (UQ-DEEP-O) / MED-P7 (UQ-DEEP-P): cap mirrors per-game maxWinX
   * (×1.5 honest tail), not flat industry hard-cap. */
  var BSE_MAX_PAYX = ${perGameMaxXJSON};
  function validPayX(v) {
    return typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= BSE_MAX_PAYX;
  }

  function fetchSpin() {
    if (BSE_STATUS === 'offline') return Promise.resolve(null);
    if (BSE_INFLIGHT) return Promise.resolve(null);  /* dedupe burst. */
    BSE_INFLIGHT = true;
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
      /* CRIT-3: bounds check. Reject malformed payX silently (HUD shows last
       * good value), increment error counter, but don't go offline on single
       * bad sample — could be transient kernel hiccup. */
      if (!validPayX(j.payX)) {
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
      if (typeof window.__LIVE_RTP_RECORD__ === 'function') {
        try { window.__LIVE_RTP_RECORD__(j.payX); } catch (_) {}
      }
      return j;
    })
    .catch(function (_e) {
      clearTimeout(timeoutId);
      BSE_ERRORS++;
      if (BSE_ERRORS >= BSE_CFG.maxConsecutiveErrors) setStatus('offline');
      return null;
    })
    .then(function (j) { BSE_INFLIGHT = false; return j; });
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
