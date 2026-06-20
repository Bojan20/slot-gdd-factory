/**
 * src/blocks/grandInterruptionLock.mjs
 *
 * Wave D-17.6 (Foundry-family gap closure) — GRAND interruption-lock +
 * handpay route. Detects when a hold-and-win session has reached the
 * GRAND threshold (default 1,000,000 credits), suppresses all spin /
 * autoplay / slam-stop / quick-spin controls during the celebration,
 * runs the locked celebration to completion, then routes the award to
 * an attendant handpay path on configured jurisdictions before
 * crediting balance.
 *
 * @module grandInterruptionLock
 *
 * Purpose:
 *   Provides a vendor-neutral, opt-in lock layer that enforces the
 *   GRAND celebration contract published by the Foundry-family GDD
 *   §10.5 / §10.6:
 *     "GRAND celebration is interruption-locked: it plays to completion,
 *      presents the 1,000,000-credit win, and on the cabinet routes to
 *      attendant/jackpot handpay per jurisdiction before crediting."
 *   The block intercepts the standard interrupt sources (slam-stop,
 *   skip, autoplay-stop, quick-spin, MAX-BET) while the celebration is
 *   active, then re-enables them when the locked window expires.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   Locked-jackpot celebration is the industry-standard gating mechanism
 *   for high-cap (≥ 1,000-credit) awards across regulated land-based
 *   markets and most jurisdictionally-fenced online RGS deployments.
 *   Cabinet-side it is wired to the SAS / G2S protocol; online it is a
 *   client-side window-flag contract the back-office hub consumes. The
 *   block is the structural generalization of that contract.
 *
 * Handpay route
 *   When the active jurisdiction matches cfg.handpayJurisdictions, the
 *   block emits `onHandpayRequested` BEFORE the credit-meter delta is
 *   applied. Downstream wallet / hub bindings observe that event and
 *   route the award through the attendant flow; on idle, the block
 *   emits `onGrandReleased` and the wallet completes the credit.
 *
 * Math gate
 *   This block does NOT pay anything. The award value comes from
 *   `payload.totalPotCredits` (D-17.5 onPotSymbolCollected) or
 *   `payload.awardCredits` (engine-supplied) and is passed THROUGH the
 *   block — never re-computed.
 *
 * Public API
 *   export function defaultConfig(): GrandInterruptionLockConfig
 *   export function resolveConfig(model?: object): GrandInterruptionLockConfig
 *   export function emitGrandInterruptionLockCSS(cfg): string
 *   export function emitGrandInterruptionLockRuntime(cfg): string
 *   export function shouldLock(amount, cfg): boolean         (test-exposed)
 *   export function requiresHandpay(jurisdiction, cfg): boolean
 *
 * Lifecycle (when enabled)
 *   • onHoldAndWinEnd / onPotSymbolCollected → read amount → check
 *     threshold → if locked, set lockActive=true + emit onGrandLock
 *   • Intercept window: __SLOT_GRAND_LOCK_ACTIVE__ flag set; controls
 *     receive ARIA disabled hint via body[data-grand-lock] attribute.
 *   • celebrationDurationMs timer → emit onGrandReleased → clear flag.
 *   • If handpay route enabled, emit onHandpayRequested at lock start;
 *     observable wallets stage the credit until release.
 *
 * HookBus events (sole emitter contract)
 *   • onGrandLock           payload: { award, threshold, jurisdiction }
 *   • onGrandReleased       payload: { award, durationMs }
 *   • onHandpayRequested    payload: { award, jurisdiction, attendantHint }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.grandInterruptionLockForce(award)
 *     → sets window.__FORCE_GRAND_AWARD__ = award
 *     → triggers runOneBaseSpin() (real engine path)
 *     → engine bakes a synthetic full-board hold-and-win outcome whose
 *       total ≥ cfg.grandThresholdCredits; the block detects + locks
 *       organically. Force-chip falls back to direct emit when engine
 *       does not honor the flag.
 *
 * Accessibility
 *   • Locked-celebration banner is role=alert + aria-live=assertive
 *     (announced immediately because award is interruption-locked).
 *   • body[data-grand-lock="true"] hints downstream control blocks to
 *     mark SPIN / AUTOPLAY / SLAM-STOP / QUICK-SPIN / MAX-BET as
 *     aria-disabled while lock is held.
 *   • prefers-reduced-motion: reduce → static flash, no zoom/shake.
 *
 * Perf budget
 *   • 0 JS per frame; pure event-driven state machine (4 transitions).
 *   • Single DOM overlay (lazy-mounted) + body attribute tag.
 *
 * Honest scope
 *   This block does NOT compute the award. It does NOT enforce wallet
 *   crediting (downstream hub binding does that). It ONLY runs the
 *   interruption-lock window + emits handpay route events.
 *
 * GDD knobs (under `model.grandInterruptionLock`)
 *   • enabled                  bool                       (default false)
 *   • grandThresholdCredits    int 1000..1e10             (default 1000000)
 *   • celebrationDurationMs    int 1500..30000            (default 6000)
 *   • handpayJurisdictions     string[]                   (default ['US','CA'])
 *   • jurisdiction             string                     (default '' — auto)
 *   • interceptControls        string[]                   (default ['spin','autoplay','slam','quickspin','maxbet'])
 *   • themeClass               string                     (default '')
 *   • role                     string                     (default 'alert')
 *   • ariaLabelPrefix          string                     (default 'Grand jackpot')
 *   • bannerLabel              string                     (default 'GRAND')
 */

const DEFAULT_CONTROLS = Object.freeze(['spin','autoplay','slam','quickspin','maxbet']);
const DEFAULT_HANDPAY  = Object.freeze(['US','CA']);

const DEFAULTS = Object.freeze({
  enabled:                false,
  grandThresholdCredits:  1000000,
  celebrationDurationMs:  6000,
  handpayJurisdictions:   DEFAULT_HANDPAY,
  jurisdiction:           '',
  interceptControls:      DEFAULT_CONTROLS,
  themeClass:             '',
  role:                   'alert',
  ariaLabelPrefix:        'Grand jackpot',
  bannerLabel:            'GRAND',
});

const BOUNDS = Object.freeze({
  grandThresholdCredits: [1000, 1e10],
  celebrationDurationMs: [1500, 30000],
});

const KNOWN_CONTROLS = Object.freeze(new Set([
  'spin','autoplay','slam','quickspin','maxbet','skip','bet','bet+','bet-',
]));

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    handpayJurisdictions: [...DEFAULT_HANDPAY],
    interceptControls:    [...DEFAULT_CONTROLS],
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

function sanitizeStringArray(arr, maxLen, whitelist) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    const clean = sanitizeStringKnob(v, maxLen);
    if (!clean) continue;
    if (whitelist && !whitelist.has(clean.toLowerCase())) continue;
    const norm = whitelist ? clean.toLowerCase() : clean;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.grandInterruptionLock) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  if ('grandThresholdCredits' in src) {
    const v = clampInt(src.grandThresholdCredits, BOUNDS.grandThresholdCredits[0], BOUNDS.grandThresholdCredits[1]);
    if (v !== null) cfg.grandThresholdCredits = v;
  }
  if ('celebrationDurationMs' in src) {
    const v = clampInt(src.celebrationDurationMs, BOUNDS.celebrationDurationMs[0], BOUNDS.celebrationDurationMs[1]);
    if (v !== null) cfg.celebrationDurationMs = v;
  }

  if (Array.isArray(src.handpayJurisdictions)) {
    const hj = [];
    const seen = new Set();
    for (const v of src.handpayJurisdictions) {
      const clean = sanitizeStringKnob(v, 8);
      if (!clean) continue;
      const upper = clean.toUpperCase();
      if (seen.has(upper)) continue;
      seen.add(upper);
      hj.push(upper);
    }
    cfg.handpayJurisdictions = hj;
  }

  const ic = sanitizeStringArray(src.interceptControls, 16, KNOWN_CONTROLS);
  if (ic && ic.length > 0) cfg.interceptControls = ic;

  const jur = sanitizeStringKnob(src.jurisdiction, 8);
  if (jur !== null) cfg.jurisdiction = jur.toUpperCase();

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  const banner = sanitizeStringKnob(src.bannerLabel, 64);
  if (banner !== null) cfg.bannerLabel = banner;

  return cfg;
}

/* ─── Pure helpers (test-exposed) ──────────────────────────────────────── */

/**
 * Should the block lock at the given award amount?
 * Returns true when amount ≥ cfg.grandThresholdCredits.
 */
export function shouldLock(amount, cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return false;
  if (typeof amount !== 'number' || !isFinite(amount)) return false;
  if (amount < c.grandThresholdCredits) return false;
  return true;
}

/**
 * Does the supplied jurisdiction require an attendant handpay route?
 */
export function requiresHandpay(jurisdiction, cfg) {
  const c = cfg || defaultConfig();
  if (!c.handpayJurisdictions || c.handpayJurisdictions.length === 0) return false;
  if (typeof jurisdiction !== 'string') return false;
  const j = jurisdiction.trim().toUpperCase();
  if (!j) return false;
  return c.handpayJurisdictions.indexOf(j) >= 0;
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitGrandInterruptionLockCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* grandInterruptionLock — locked celebration overlay */
.gil-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: auto; /* intercept clicks; cannot dismiss */
  z-index: 10000;
  background: radial-gradient(circle, rgba(40,20,5,0.92) 0%,
              rgba(0,0,0,0.82) 60%, rgba(0,0,0,0.95) 100%);
  opacity: 0;
  transition: opacity 320ms ease-out;
}
.gil-overlay.is-active {
  display: flex;
  opacity: 1;
}
.gil-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
  padding: 40px 80px;
  border-radius: 22px;
  background: linear-gradient(180deg, rgba(220,160,50,0.96), rgba(160,80,15,0.96));
  box-shadow: 0 24px 64px rgba(0,0,0,0.7),
              0 0 0 3px rgba(255,235,170,0.55) inset;
  transform: scale(0.85);
  animation: gilBannerIn 560ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.gil-label {
  font-size: 52px;
  font-weight: 900;
  letter-spacing: 0.16em;
  color: #fff8d0;
  text-shadow: 0 6px 20px rgba(0,0,0,0.6);
}
.gil-award {
  font-size: 72px;
  font-weight: 900;
  color: #ffe28a;
  text-shadow: 0 8px 28px rgba(255,180,60,0.7);
}
.gil-handpay-note {
  font-size: 18px;
  color: rgba(255,250,210,0.9);
  margin-top: 6px;
}
[data-grand-lock="true"] [data-control] { aria-disabled: true; }
[data-grand-lock="true"] button[data-control] { pointer-events: none; }
@keyframes gilBannerIn {
  0%   { transform: scale(0.85); opacity: 0; }
  60%  { transform: scale(1.04); opacity: 1; }
  100% { transform: scale(1.0);  opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .gil-overlay.is-active { transition: none; opacity: 1; }
  .gil-banner             { animation: none; transform: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitGrandInterruptionLockRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    grandThresholdCredits: c.grandThresholdCredits,
    celebrationDurationMs: c.celebrationDurationMs,
    handpayJurisdictions:  c.handpayJurisdictions,
    jurisdiction:          c.jurisdiction,
    interceptControls:     c.interceptControls,
    themeClass:            c.themeClass,
    role:                  c.role,
    ariaLabelPrefix:       c.ariaLabelPrefix,
    bannerLabel:           c.bannerLabel,
  });

  return `
/* grandInterruptionLock runtime — interruption-locked GRAND celebration */
(function grandInterruptionLockInit() {
  const CFG = ${cfgJSON};

  let overlay = null;
  let bannerEl = null;
  let awardEl = null;
  let handpayNote = null;
  let lockTimer = null;
  let lockActive = false;

  function getJurisdiction() {
    if (CFG.jurisdiction) return CFG.jurisdiction;
    /* Allow downstream presentation blocks (jurisdictionGate, etc.) to
       publish the active jurisdiction via a window flag. */
    if (typeof window !== 'undefined' && typeof window.__SLOT_JURISDICTION__ === 'string') {
      return window.__SLOT_JURISDICTION__.trim().toUpperCase();
    }
    return '';
  }

  function requiresHandpay() {
    const j = getJurisdiction();
    if (!j) return false;
    if (!CFG.handpayJurisdictions || CFG.handpayJurisdictions.length === 0) return false;
    return CFG.handpayJurisdictions.indexOf(j) >= 0;
  }

  function ensureMount() {
    if (overlay) return overlay;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="gil-overlay" role="alert" aria-live="assertive"></div>';
    overlay = wrap.firstChild;
    if (CFG.themeClass) overlay.classList.add(CFG.themeClass);
    overlay.setAttribute('role', CFG.role);
    overlay.setAttribute('aria-label', CFG.ariaLabelPrefix + ': idle');

    bannerEl = document.createElement('div');
    bannerEl.className = 'gil-banner';
    const labelEl = document.createElement('div');
    labelEl.className = 'gil-label';
    labelEl.textContent = CFG.bannerLabel;
    awardEl = document.createElement('div');
    awardEl.className = 'gil-award';
    awardEl.textContent = '';
    handpayNote = document.createElement('div');
    handpayNote.className = 'gil-handpay-note';
    handpayNote.textContent = '';
    bannerEl.appendChild(labelEl);
    bannerEl.appendChild(awardEl);
    bannerEl.appendChild(handpayNote);
    overlay.appendChild(bannerEl);
    document.body.appendChild(overlay);
    return overlay;
  }

  function setControlsLocked(state) {
    try {
      if (state) document.body.setAttribute('data-grand-lock', 'true');
      else       document.body.removeAttribute('data-grand-lock');
    } catch (_) {}
    if (typeof window !== 'undefined') {
      window.__SLOT_GRAND_LOCK_ACTIVE__ = !!state;
    }
  }

  function startLock(award, source) {
    if (lockActive) return;
    lockActive = true;
    ensureMount();
    awardEl.textContent = String(award);
    overlay.setAttribute('aria-label',
      CFG.ariaLabelPrefix + ': locked, ' + award + ' credits');
    const j = getJurisdiction();
    const handpay = requiresHandpay();
    handpayNote.textContent = handpay
      ? ('Attendant handpay required for ' + j)
      : '';
    overlay.classList.add('is-active');
    setControlsLocked(true);
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onGrandLock', {
          award:        award,
          threshold:    CFG.grandThresholdCredits,
          jurisdiction: j,
        });
        if (handpay) {
          window.HookBus.emit('onHandpayRequested', {
            award:         award,
            jurisdiction:  j,
            attendantHint: source || 'grand-fill',
          });
        }
      } catch (_) {}
    }
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    lockTimer = setTimeout(function () { releaseLock(award); }, CFG.celebrationDurationMs);
  }

  function releaseLock(award) {
    if (!lockActive) return;
    lockActive = false;
    if (overlay) {
      overlay.classList.remove('is-active');
      overlay.setAttribute('aria-label', CFG.ariaLabelPrefix + ': released');
    }
    setControlsLocked(false);
    if (lockTimer) { clearTimeout(lockTimer); lockTimer = null; }
    if (typeof window.HookBus !== 'undefined') {
      try {
        window.HookBus.emit('onGrandReleased', {
          award:      award,
          durationMs: CFG.celebrationDurationMs,
        });
      } catch (_) {}
    }
  }

  function maybeLockFromPayload(payload, source) {
    if (!payload) return;
    let amount = 0;
    if (typeof payload.totalPotCredits === 'number')   amount = payload.totalPotCredits;
    else if (typeof payload.awardCredits === 'number') amount = payload.awardCredits;
    else if (typeof payload.award === 'number')        amount = payload.award;
    if (typeof window !== 'undefined' && typeof window.__FORCE_GRAND_AWARD__ === 'number') {
      amount = window.__FORCE_GRAND_AWARD__;
      window.__FORCE_GRAND_AWARD__ = undefined;
    }
    if (amount < CFG.grandThresholdCredits) return;
    startLock(amount, source || 'collect');
  }

  /* Force chip — per rule_force_buttons_real_spin */
  if (typeof window !== 'undefined') {
    window.grandInterruptionLockForce = function (award) {
      window.__FORCE_GRAND_AWARD__ = (typeof award === 'number' && isFinite(award))
        ? award : CFG.grandThresholdCredits;
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
    window.grandInterruptionLockIsActive = function () { return lockActive; };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('onPotSymbolCollected', function (p) {
      maybeLockFromPayload(p, 'pot-collected');
    });
    window.HookBus.on('onHoldAndWinEnd', function (p) {
      maybeLockFromPayload(p, 'hold-and-win-end');
    });
    /* Generic feature payout event (engine may emit). */
    window.HookBus.on('onFeaturePayout', function (p) {
      maybeLockFromPayload(p, 'feature-payout');
    });
  }
})();
`;
}
