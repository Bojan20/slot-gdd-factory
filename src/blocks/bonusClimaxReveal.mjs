/**
 * src/blocks/bonusClimaxReveal.mjs
 *
 * Wave H6 — Bonus Climax Reveal (presenter for any bonus-entry event).
 *
 * Industry baseline (vendor-neutral):
 *   When a bonus path is entered (free spins, hold-and-win, wheel bonus,
 *   pick bonus, scatter bonus, jackpot ladder), modern slots fire a brief
 *   FULL-SCREEN reveal placard ("BONUS!" / "JACKPOT!" / "WHEEL!" / "PICK!")
 *   with a camera-pulse + concentric burst so the player has a clear UX
 *   boundary between BASE game and BONUS game. This block owns that placard.
 *
 *   It is a pure PRESENTATION layer:
 *     • Listens to canonical bonus-entry events (FS / wheel / pick / H&W /
 *       weighted wheel / credit bucket / bonus-buy tier / dailyJackpot)
 *     • Renders one overlay div with a per-event-kind label
 *     • Auto-dismisses after `durationMs` (default 1400 ms)
 *     • Honours player skip via onSkipRequested (kills overlay early)
 *     • Sole owner of `onBonusClimaxStart` + `onBonusClimaxEnd` emits
 *
 *   Composition: stacks BELOW big-win banner (z 24 vs bigWinTier 30) and
 *   ABOVE the grid (z 14 grid frame). Fixed positioning, blocks pointer
 *   events while visible so player can't double-tap the underlying grid.
 *
 * Public API (server-side, ES module):
 *   defaultConfig()
 *   resolveConfig(model)
 *   emitBonusClimaxRevealCSS(cfg)
 *   emitBonusClimaxRevealMarkup(cfg)
 *   emitBonusClimaxRevealRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     onFsTrigger          → fire 'FREE SPINS!' (label override)
 *     onWheelSegmentChosen → fire 'WHEEL!'      (kind: wheel)
 *     onBonusBuyTierSelected → fire 'BONUS!'    (kind: bonus_buy)
 *     onCreditBucketRespinStart → fire 'HOLD & SPIN!' (kind: hold_and_win)
 *     onDailyJackpotAward  → fire 'JACKPOT!'    (kind: jackpot)
 *     onSkipRequested      → kill any in-flight overlay (phase: bonusClimax)
 *   emits:
 *     onBonusClimaxStart   { kind, label, durationMs }
 *     onBonusClimaxEnd     { kind, reason: 'natural' | 'skipped' }
 *
 * a11y:
 *   - role="alert" on the placard (announces to AT immediately).
 *   - aria-live="assertive" so reveal is read interruptive-style.
 *   - prefers-reduced-motion kills the burst keyframe (placard still shows).
 *   - 11px font floor for sub-label (Apple HIG).
 *
 * Vendor-neutral. No game / studio strings in source or output.
 *
 * @module bonusClimaxReveal
 */

const KIND_LABELS = Object.freeze({
  free_spins:    'FREE SPINS!',
  wheel:         'WHEEL!',
  bonus_buy:     'BONUS!',
  hold_and_win:  'HOLD & SPIN!',
  jackpot:       'JACKPOT!',
  pick:          'PICK BONUS!',
  generic:       'BONUS!',
});
const VALID_KINDS = new Set(Object.keys(KIND_LABELS));

const BOUNDS = Object.freeze({
  durationMs:    [400, 4000],
  fontSizePx:    [24, 96],
  subFontSizePx: [11, 24],
  zIndex:        [10, 99],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safeStr(v, max = 32) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : null;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:       true,
    durationMs:    1400,
    fontSizePx:    56,
    subFontSizePx: 12,
    bgColor:       'rgba(2, 4, 10, 0.78)',
    fgColor:       '#ffd84d',
    subColor:      '#f2f2f2',
    burstColor:    '#ffd84d',
    zIndex:        24,                /* between bigWinTier (30) and grid (14) */
    labelMap:      KIND_LABELS,
    autoEmitOnFsTrigger:           true,
    autoEmitOnWheelChosen:         true,
    autoEmitOnBonusBuyTier:        true,
    autoEmitOnCreditBucketStart:   true,
    autoEmitOnDailyJackpotAward:   true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.bonusClimaxReveal) || {};

  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;

  cfg.durationMs    = _clamp(m.durationMs,    BOUNDS.durationMs,    cfg.durationMs);
  cfg.fontSizePx    = _clamp(m.fontSizePx,    BOUNDS.fontSizePx,    cfg.fontSizePx);
  cfg.subFontSizePx = _clamp(m.subFontSizePx, BOUNDS.subFontSizePx, cfg.subFontSizePx);
  cfg.zIndex        = _clamp(m.zIndex,        BOUNDS.zIndex,        cfg.zIndex);

  if (typeof m.bgColor === 'string')    cfg.bgColor    = m.bgColor;
  if (typeof m.fgColor === 'string')    cfg.fgColor    = m.fgColor;
  if (typeof m.subColor === 'string')   cfg.subColor   = m.subColor;
  if (typeof m.burstColor === 'string') cfg.burstColor = m.burstColor;

  if (m.labelMap && typeof m.labelMap === 'object') {
    const merged = { ...cfg.labelMap };
    for (const [k, v] of Object.entries(m.labelMap)) {
      if (!VALID_KINDS.has(k)) continue;
      const s = _safeStr(v, 32);
      if (s) merged[k] = s;
    }
    cfg.labelMap = Object.freeze(merged);
  }

  if (typeof m.autoEmitOnFsTrigger         === 'boolean') cfg.autoEmitOnFsTrigger         = m.autoEmitOnFsTrigger;
  if (typeof m.autoEmitOnWheelChosen       === 'boolean') cfg.autoEmitOnWheelChosen       = m.autoEmitOnWheelChosen;
  if (typeof m.autoEmitOnBonusBuyTier      === 'boolean') cfg.autoEmitOnBonusBuyTier      = m.autoEmitOnBonusBuyTier;
  if (typeof m.autoEmitOnCreditBucketStart === 'boolean') cfg.autoEmitOnCreditBucketStart = m.autoEmitOnCreditBucketStart;
  if (typeof m.autoEmitOnDailyJackpotAward === 'boolean') cfg.autoEmitOnDailyJackpotAward = m.autoEmitOnDailyJackpotAward;

  return cfg;
}

export function emitBonusClimaxRevealCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* bonusClimaxReveal — Wave H6 */
  .bonus-climax {
    position: fixed;
    inset: 0;
    display: none;
    align-items: center;
    justify-content: center;
    background: ${cfg.bgColor};
    color: ${cfg.fgColor};
    z-index: ${cfg.zIndex};
    text-align: center;
    pointer-events: none;
    font-weight: 900;
    letter-spacing: 0.08em;
    opacity: 0;
    transition: opacity 220ms ease-out;
  }
  .bonus-climax[data-visible="true"] {
    display: flex;
    opacity: 1;
    pointer-events: auto;
  }
  .bonus-climax-label {
    font-size: ${cfg.fontSizePx}px;
    text-shadow: 0 4px 32px ${cfg.burstColor}, 0 0 18px rgba(0, 0, 0, 0.6);
    line-height: 1.05;
  }
  .bonus-climax-sub {
    display: block;
    margin-top: 8px;
    font-size: ${cfg.subFontSizePx}px;
    font-weight: 600;
    letter-spacing: 0.18em;
    color: ${cfg.subColor};
    text-transform: uppercase;
  }
  .bonus-climax-burst {
    position: absolute;
    inset: 0;
    pointer-events: none;
    background: radial-gradient(closest-side, ${cfg.burstColor}33 0%, transparent 70%);
    animation: bonus-climax-pulse 900ms ease-out;
  }
  @keyframes bonus-climax-pulse {
    0%   { transform: scale(0.6); opacity: 0.0; }
    35%  { transform: scale(1.0); opacity: 0.9; }
    100% { transform: scale(1.4); opacity: 0.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .bonus-climax { transition: none; }
    .bonus-climax-burst { animation: none; opacity: 0; }
  }
  `;
}

export function emitBonusClimaxRevealMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="bonusClimaxOverlay" class="bonus-climax" role="alert" aria-live="assertive" aria-hidden="true" data-visible="false">
    <div class="bonus-climax-burst" aria-hidden="true"></div>
    <div>
      <span class="bonus-climax-label" id="bonusClimaxLabel">BONUS!</span>
      <span class="bonus-climax-sub"   id="bonusClimaxSub">REVEAL</span>
    </div>
  </div>`;
}

export function emitBonusClimaxRevealRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── bonusClimaxReveal BLOCK — Wave H6 ───────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var DURATION = ${cfg.durationMs};
    var LABELS = ${JSON.stringify(cfg.labelMap)};
    var AUTO = ${JSON.stringify({
      free_spins:   cfg.autoEmitOnFsTrigger,
      wheel:        cfg.autoEmitOnWheelChosen,
      bonus_buy:    cfg.autoEmitOnBonusBuyTier,
      hold_and_win: cfg.autoEmitOnCreditBucketStart,
      jackpot:      cfg.autoEmitOnDailyJackpotAward,
    })};
    var overlay = (typeof document !== 'undefined') ? document.getElementById('bonusClimaxOverlay') : null;
    var labelEl = (typeof document !== 'undefined') ? document.getElementById('bonusClimaxLabel')   : null;
    var subEl   = (typeof document !== 'undefined') ? document.getElementById('bonusClimaxSub')     : null;
    var hideTimer = null;
    var active = false;
    var activeKind = null;

    function fire(kind, customLabel) {
      var k = (typeof kind === 'string' && LABELS[kind]) ? kind : 'generic';
      var label = (typeof customLabel === 'string' && customLabel.length) ? customLabel : LABELS[k];
      activeKind = k;
      active = true;
      if (overlay) {
        overlay.setAttribute('data-visible', 'true');
        overlay.setAttribute('aria-hidden', 'false');
      }
      if (labelEl) labelEl.textContent = label;
      if (subEl)   subEl.textContent   = 'BONUS REVEAL';
      try { window.HookBus.emit('onBonusClimaxStart', { kind: k, label: label, durationMs: DURATION }); } catch (_) {}
      if (hideTimer) clearTimeout(hideTimer);
      hideTimer = setTimeout(function () { hide('natural'); }, DURATION);
    }
    function hide(reason) {
      if (!active) return;
      var k = activeKind || 'generic';
      active = false;
      activeKind = null;
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (overlay) {
        overlay.setAttribute('data-visible', 'false');
        overlay.setAttribute('aria-hidden', 'true');
      }
      try { window.HookBus.emit('onBonusClimaxEnd', { kind: k, reason: reason || 'natural' }); } catch (_) {}
    }

    /* Explicit API — caller can fire arbitrary kind/label. */
    window.bonusClimaxFire = function (kind, label) { fire(kind, label); };
    window.bonusClimaxHide = function ()            { hide('manual'); };

    /* Auto-wire canonical bonus-entry events. */
    if (AUTO.free_spins)   window.HookBus.on('onFsTrigger',              function () { fire('free_spins'); });
    if (AUTO.wheel)        window.HookBus.on('onWheelSegmentChosen',     function () { fire('wheel'); });
    if (AUTO.bonus_buy)    window.HookBus.on('onBonusBuyTierSelected',   function () { fire('bonus_buy'); });
    if (AUTO.hold_and_win) window.HookBus.on('onCreditBucketRespinStart',function () { fire('hold_and_win'); });
    if (AUTO.jackpot)      window.HookBus.on('onDailyJackpotAward',      function () { fire('jackpot'); });

    /* Player-driven skip kills the placard early. */
    window.HookBus.on('onSkipRequested', function (p) {
      if (!active) return;
      /* If a phase is specified, only react to bonusClimax or generic skip. */
      if (p && typeof p === 'object' && typeof p.phase === 'string') {
        if (p.phase !== 'bonusClimax' && p.phase !== 'any') return;
      }
      hide('skipped');
    });
  })();
  `;
}
