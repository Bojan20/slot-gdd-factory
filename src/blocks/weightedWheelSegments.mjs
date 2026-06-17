/**
 * src/blocks/weightedWheelSegments.mjs
 *
 * Wave H15 — Weighted Wheel Segments + Jackpot Tier Mapping extension.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   Modern wheel-bonus mini-games use **non-uniform** segment selection:
 *   small multipliers are common (high weight), grand jackpots are rare
 *   (sub-1% weight). The visual wheel layout still shows N equal-arc
 *   segments — only the SELECTION distribution is biased per GDD. A
 *   subset of segments are "jackpot tier" cells (MINI / MINOR / MAJOR /
 *   GRAND) which, when chosen, pay a flat × bet from the jackpot map
 *   instead of the segment's nominal value. Both behaviors are universal
 *   across the wheel-bonus family (regulator-friendly: explicit weight
 *   table + jackpot map = clear audit trail).
 *
 *   This block EXTENDS `wheelBonus.mjs` without modifying its source.
 *   Composition contract:
 *     • wheelBonus owns the modal overlay, the spinning animation, the
 *       Spin / Collect buttons, the segment DOM, the result display.
 *     • weightedWheelSegments OBSERVES — replaces window.wbSpin with a
 *       weighted-draw variant that still calls into the existing
 *       animation pipeline (it bumps wheel rotation to the same DOM
 *       target). Emits dedicated HookBus events when a segment is
 *       chosen and when a jackpot tier hits. Pushes window.__WIN_AWARD__
 *       on collect so the existing winPresentation → bigWinTier chain
 *       takes over as for any other round payout.
 *
 *   When this block is disabled (default), wheelBonus runs unchanged
 *   with its native uniform-random draw. Purely additive.
 *
 * Lifecycle (HookBus contract):
 *
 *   DOMContentLoaded → install the wbSpin wrapper + listener replacement
 *                      IF wheelBonus runtime is present (window.wbSpin
 *                      defined). If missing, console.warn once + no-op
 *                      so the dist still loads.
 *   user clicks wbSpin button → patched wbSpin runs:
 *                      1) weighted draw via cfg.weights[]
 *                      2) if drawn segment carries a jackpotTier, look up
 *                         the multiplier in cfg.jackpotMap
 *                      3) bind the (already-existing) wheel.style.transform
 *                         rotation to land on the drawn index
 *                      4) on animation-end, write the result + emit
 *                         onWheelSegmentChosen and (if jackpot) onWheelJackpotHit
 *   user clicks wbClose ("COLLECT") → push the resolved award into
 *                      window.__WIN_AWARD__ and emit onWheelAwardCollected.
 *                      winPresentation publishes it; bigWinTier ladder
 *                      fires if the award ratio crosses a tier threshold.
 *   onFsTrigger / onFsEnd → reset internal state so a stale award can't
 *                      cross a round boundary.
 *
 *   Emitted events:
 *     onWheelSegmentChosen { index, label, value, jackpotTier?, jackpotX? }
 *     onWheelJackpotHit    { tier, x }
 *     onWheelAwardCollected { award, isJackpot, tier? }
 *
 * GDD config (consumed from `model.weightedWheelSegments`):
 *
 *   {
 *     enabled:        boolean (default false; auto-enables if any feature
 *                     kind matches /weighted[_-]?wheel/i, OR when GDD
 *                     declares model.weightedWheelSegments.weights AND
 *                     wheelBonus is enabled; manual override always takes
 *                     precedence.)
 *     weights:        number[] of length === model.wheelBonus.segments.length
 *                     (default: all 1.0 — uniform fallback). When the
 *                     length doesn't match, falls back to uniform.
 *     jackpotMap:     Array<{ label, x }> — labels MUST match the
 *                     `jackpotTier` field on the wheelBonus segments. If
 *                     a wheelBonus segment carries `jackpotTier: 'GRAND'`
 *                     and jackpotMap has `{ label: 'GRAND', x: 1000 }`,
 *                     landing on that segment awards 1000× bet (not the
 *                     segment's nominal `value`).
 *     defaultTierColor: 'r,g,b' (default '255,80,80' alert red) — used
 *                     to highlight tier segments in the modal.
 *     allowFallbackToValue: boolean (default true) — if a jackpot tier
 *                     hits but its label isn't in jackpotMap, fall back
 *                     to the segment's `value` instead of awarding 0.
 *   }
 *
 *   NOTE: this block READS `model.wheelBonus.segments` to know how many
 *   weights to expect. It is invalid to enable this block without
 *   wheelBonus also being enabled — resolveConfig will set enabled=false
 *   in that case.
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                          → safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitWeightedWheelSegmentsCSS(cfg)        → jackpot-tier accent CSS
 *   emitWeightedWheelSegmentsMarkup(cfg)     → empty (extension paints into existing wb-seg)
 *   emitWeightedWheelSegmentsRuntime(cfg, wheelCfg)
 *                                            → runtime JS (monkey-patch wbSpin)
 *
 * Performance budget: ≤0.1ms per draw at n≤24; CSS emit ≤2KB; runtime
 * emit ≤4KB.
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.WWS_STATE             { enabled, weights, jackpotMap,
 *                                  lastResult: { index, label, value,
 *                                                jackpotTier, jackpotX } | null,
 *                                  patched: boolean }
 *   window.wwsDraw()             pure weighted-draw helper (test hook)
 *
 * Composition contract:
 *
 *   - REQUIRES `wheelBonus` enabled. The block early-exits at runtime
 *     if `window.wbSpin` is missing.
 *   - DOES NOT modify wheelBonus source. Wraps `window.wbSpin` once
 *     (idempotent). Original is preserved as `window.__origWbSpin`.
 *   - DOES NOT modify the existing wbSpin animation duration / easing —
 *     the only deviation is which segment index lands on the pointer
 *     (driven by weighted draw + jackpot detection). The visual
 *     experience is identical from the player's perspective except for
 *     tier-segment styling and on-collect award amount.
 *
 * Industry references (template-neutral):
 *
 *   • Probabilistic wheel selection: standard regulator pattern (UKGC
 *     RTS 4.05 — RNG output ∝ declared weight table).
 *   • Jackpot tier ladder: 4-tier MINI/MINOR/MAJOR/GRAND (universal
 *     vendor-neutral naming).
 *   • Audit-grade weight table: single source of truth in GDD config;
 *     code never derives weights from other inputs.
 *
 * Performance budget: ≤0.1ms per draw at n≤24; CSS emit ≤2KB;
 * runtime emit ≤4KB.
 */

const HEX_RGB = /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/;
const SAFE_LABEL = /^[A-Z0-9_ -]{1,16}$/;

/* Fable audit (critical): HEX_RGB only checks digit count — "999,300,400"
 * passes syntactic check but is out of the 0..255 channel range and
 * ships broken rgba() to dist. Parse + clamp each channel to a byte;
 * return null when input is malformed so the caller falls back to the
 * default. */
function _normalizeRgb(s) {
  if (typeof s !== 'string' || !HEX_RGB.test(s)) return null;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return null;
  const out = [];
  for (let i = 0; i < 3; i++) {
    const n = Number(parts[i]);
    if (!Number.isFinite(n)) return null;
    out.push(clampInt(n, 0, 255));
  }
  return out.join(',');
}

function clampInt(n, lo, hi) {
  const x = Math.round(Number(n));
  if (!Number.isFinite(x)) return lo;
  return Math.max(lo, Math.min(hi, x));
}

function _esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function _validWeights(arr, expectedLen) {
  if (!Array.isArray(arr)) return false;
  if (expectedLen != null && arr.length !== expectedLen) return false;
  if (arr.length < 3 || arr.length > 24) return false;
  return arr.every(v => Number.isFinite(v) && v > 0 && v <= 1e6);
}

function _validJackpotMap(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 8) return false;
  const seen = new Set();
  for (const e of arr) {
    if (!e || typeof e !== 'object') return false;
    if (typeof e.label !== 'string' || !SAFE_LABEL.test(e.label)) return false;
    if (seen.has(e.label)) return false;
    seen.add(e.label);
    if (!Number.isFinite(e.x) || e.x <= 0 || e.x > 1e9) return false;
  }
  return true;
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    weights: null,          /* null = uniform fallback */
    jackpotMap: [
      { label: 'MINI',  x: 5 },
      { label: 'MINOR', x: 25 },
      { label: 'MAJOR', x: 100 },
      { label: 'GRAND', x: 1000 },
    ],
    defaultTierColor: '255,80,80',
    allowFallbackToValue: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.weightedWheelSegments) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  /* Auto-enable when GDD declares matching feature kind */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string' &&
      /^(weighted[_-]?wheel[_-]?segments?|weighted[_-]?wheel)$/i.test(f.kind),
    );
    if (hit) cfg.enabled = true;
  }

  /* Hard requirement — wheelBonus must be enabled too. If not, force
   * disabled so the extension can't pollute a dist without its base. */
  const wheelEnabled = !!(model.wheelBonus && (
    model.wheelBonus.enabled === true ||
    (Array.isArray(model.features) && model.features.some(f => f && f.kind === 'wheel_bonus'))
  ));

  /* Fable audit (high): docstring promises auto-enable when the GDD
   * declares model.weightedWheelSegments.weights and wheelBonus is on.
   * Honour that contract — otherwise GDDs written against the doc stay
   * silently disabled. */
  if (!cfg.enabled && wheelEnabled && Array.isArray(m.weights) && m.weights.length > 0) {
    cfg.enabled = true;
  }

  if (!wheelEnabled) cfg.enabled = false;

  const expectedLen = (model.wheelBonus && Array.isArray(model.wheelBonus.segments))
    ? model.wheelBonus.segments.length
    : null;
  if (_validWeights(m.weights, expectedLen)) {
    cfg.weights = m.weights.map(Number);
  }

  if (_validJackpotMap(m.jackpotMap)) {
    cfg.jackpotMap = m.jackpotMap.map(j => ({ label: j.label, x: Number(j.x) }));
  }

  if (typeof m.defaultTierColor === 'string') {
    const rgb = _normalizeRgb(m.defaultTierColor);
    if (rgb) cfg.defaultTierColor = rgb;
  }

  if (m.allowFallbackToValue != null) cfg.allowFallbackToValue = !!m.allowFallbackToValue;

  return cfg;
}

export function emitWeightedWheelSegmentsCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = cfg.defaultTierColor;
  return `
  /* ── weightedWheelSegments BLOCK — emitted by src/blocks/weightedWheelSegments.mjs ─
     Highlights jackpot-tier wheel segments with a stronger glow + label
     pill so the player can read the prize ladder at a glance. The block
     does NOT mount its own DOM — these rules apply to wb-seg children
     that the wheelBonus block already renders, scoped by data-tier. */
  .wb-seg[data-tier] {
    box-shadow: inset 0 0 0 2px rgba(${c}, 0.85), inset 0 0 16px rgba(${c}, 0.4);
  }
  .wb-seg[data-tier]::after {
    content: attr(data-tier);
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%) rotate(0deg);
    font-size: 0.7rem;  /* Wave UQ — ≥11px floor */
    font-weight: 900;
    letter-spacing: 0.08em;
    color: rgba(${c}, 1);
    text-shadow: 0 0 4px rgba(${c}, 0.7);
    text-transform: uppercase;
    pointer-events: none;
  }
  .wb-result[data-jackpot="true"] {
    color: rgba(${c}, 1);
    text-shadow: 0 0 18px rgba(${c}, 0.9);
    animation: wwsJackpotPulse 700ms ease-in-out 2;
  }
  @keyframes wwsJackpotPulse {
    0%, 100% { transform: scale(1); }
    50%      { transform: scale(1.12); }
  }
  @media (prefers-reduced-motion: reduce) {
    .wb-result[data-jackpot="true"] { animation: none; }
  }
`;
}

export function emitWeightedWheelSegmentsMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return '';
}

export function emitWeightedWheelSegmentsRuntime(cfg = defaultConfig(), wheelCfg = null) {
  if (!cfg.enabled) {
    return `
  /* ── weightedWheelSegments BLOCK (disabled) — stubs so probes don't crash ── */
  window.WWS_STATE = { enabled: false, weights: null, jackpotMap: [], lastResult: null, patched: false };
  window.wwsDraw   = function () { return -1; };
`;
  }

  /* Bake the (optionally GDD-overridden) weights array. When weights is
   * null at build time, the runtime computes uniform weights = [1,1,...,1]
   * based on the live segment count at patch time. */
  const wheelSegments = (wheelCfg && Array.isArray(wheelCfg.segments)) ? wheelCfg.segments : [];
  const segmentsJson = JSON.stringify(wheelSegments);
  const weightsJson  = JSON.stringify(cfg.weights || null);
  const jackpotMapJson = JSON.stringify(cfg.jackpotMap.map(j => ({
    label: _esc(j.label), x: j.x,
  })));
  const allowFallback = cfg.allowFallbackToValue ? 'true' : 'false';

  return `
  /* ── weightedWheelSegments BLOCK — emitted by src/blocks/weightedWheelSegments.mjs ──
     Owns emit of: onWheelSegmentChosen, onWheelJackpotHit, onWheelAwardCollected.
     Observes: window.wbSpin (monkey-patches once on DOMContentLoaded).
     Hard requirement: wheelBonus block must be enabled (window.wbSpin present).
     If missing at patch time we no-op + console.warn once. */
  (function () {
    var BAKED_SEGMENTS = ${segmentsJson};
    var BAKED_WEIGHTS  = ${weightsJson};
    var JACKPOT_MAP    = ${jackpotMapJson};
    var ALLOW_FALLBACK = ${allowFallback};

    var STATE = {
      enabled: true,
      weights: BAKED_WEIGHTS,
      jackpotMap: JACKPOT_MAP,
      lastResult: null,
      patched: false,
    };
    if (typeof window !== 'undefined') {
      window.WWS_STATE = STATE;
    }

    /* _weightedDrawIndex — returns an index into the segments array,
     * biased by weights. Defensive fallback to uniform if weights[] is
     * malformed at runtime. */
    function _weightedDrawIndex(segCount) {
      var w = STATE.weights;
      if (!Array.isArray(w) || w.length !== segCount) {
        w = new Array(segCount);
        for (var k = 0; k < segCount; k++) w[k] = 1;
      }
      var total = 0;
      for (var i = 0; i < w.length; i++) total += Math.max(0, Number(w[i]) || 0);
      if (!(total > 0)) return 0;
      var r = Math.random() * total;
      var acc = 0;
      for (var j = 0; j < w.length; j++) {
        acc += Math.max(0, Number(w[j]) || 0);
        if (r < acc) return j;
      }
      return w.length - 1;
    }

    function wwsDraw() {
      var segs = (typeof window !== 'undefined' && window.WB_SEGMENTS_LIVE) || BAKED_SEGMENTS;
      return _weightedDrawIndex(segs.length || 1);
    }

    if (typeof window !== 'undefined') {
      window.wwsDraw = wwsDraw;
    }

    function _findJackpot(label) {
      for (var i = 0; i < JACKPOT_MAP.length; i++) {
        if (JACKPOT_MAP[i].label === label) return JACKPOT_MAP[i];
      }
      return null;
    }

    function _paintTierBadges() {
      /* Mark each wb-seg whose data-tier matches one of the live segments'
       * jackpotTier strings. wheelBonus doesn't set data-tier itself —
       * we do it here so the CSS picks them up. Use WB_SEGMENTS_LIVE as
       * the single source of truth for both draw and paint. */
      var nodes = document.querySelectorAll('#wbWheel .wb-seg');
      if (!nodes || nodes.length === 0) return;
      var segs = window.WB_SEGMENTS_LIVE || BAKED_SEGMENTS;
      for (var i = 0; i < nodes.length && i < segs.length; i++) {
        var seg = segs[i];
        if (seg && typeof seg.jackpotTier === 'string' && seg.jackpotTier.length > 0) {
          nodes[i].setAttribute('data-tier', seg.jackpotTier);
        } else {
          nodes[i].removeAttribute('data-tier');
        }
      }
    }

    /* _patch — replace window.wbSpin with weighted variant. Idempotent:
     * a second call is a no-op (STATE.patched gates re-entry). Original
     * is preserved as window.__origWbSpin for diagnostic dumps. */
    function _patch() {
      if (STATE.patched) return;
      if (typeof window === 'undefined') return;
      if (typeof window.wbSpin !== 'function') {
        if (typeof console !== 'undefined' && console.warn) {
          console.warn('[weightedWheelSegments] wheelBonus not active — extension inert');
        }
        return;
      }
      var origWbSpin = window.wbSpin;
      window.__origWbSpin = origWbSpin;
      window.WB_SEGMENTS_LIVE = (typeof window.WB_SEGMENTS !== 'undefined') ? window.WB_SEGMENTS : BAKED_SEGMENTS;

      window.wbSpin = function () {
        var WB = window.WB_STATE;
        if (!WB || !WB.active || WB.spinning) return;
        WB.spinning = true;
        var segs = window.WB_SEGMENTS_LIVE || BAKED_SEGMENTS;
        var winIdx = _weightedDrawIndex(segs.length);
        var seg = segs[winIdx] || { label: '', value: 0 };
        WB.result = seg;

        /* Drive the same rotation animation wheelBonus already uses. */
        var segDeg = 360 / segs.length;
        var revs = (typeof window.WB_REVS !== 'undefined') ? window.WB_REVS : 6;
        var targetDeg = -(winIdx * segDeg) - (segDeg / 2) + (360 * revs);
        var wheel = document.getElementById('wbWheel');
        if (wheel) wheel.style.transform = 'rotate(' + targetDeg + 'deg)';
        var spinBtn = document.getElementById('wbSpin');
        if (spinBtn) spinBtn.disabled = true;

        /* Resolve award + tier on completion. */
        var dur = (typeof window.WB_DUR !== 'undefined') ? window.WB_DUR : 3800;
        var settleBuf = (typeof window.WB_SETTLE_MS !== 'undefined') ? window.WB_SETTLE_MS : 80;
        setTimeout(function () {
          WB.spinning = false;
          var tier = (seg && typeof seg.jackpotTier === 'string' && seg.jackpotTier.length > 0)
            ? seg.jackpotTier : '';
          var jackpotHit = tier ? _findJackpot(tier) : null;
          var jackpotX = jackpotHit ? jackpotHit.x : 0;

          STATE.lastResult = {
            index: winIdx,
            label: seg.label,
            value: Number.isFinite(seg.value) ? seg.value : 0,
            jackpotTier: tier,
            jackpotX: jackpotX,
          };

          var resultEl = document.getElementById('wbResult');
          if (resultEl) {
            resultEl.textContent = 'YOU WON ' + (tier ? tier + '!' : (seg.label || '') + '!');
            if (tier) resultEl.setAttribute('data-jackpot', 'true');
            else      resultEl.removeAttribute('data-jackpot');
          }
          var closeBtn = document.getElementById('wbClose');
          if (closeBtn) closeBtn.setAttribute('data-show', 'true');
          if (spinBtn) spinBtn.style.display = 'none';

          if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
            try {
              window.HookBus.emit('onWheelSegmentChosen', {
                index: winIdx,
                label: seg.label,
                value: STATE.lastResult.value,
                jackpotTier: tier || undefined,
                jackpotX: tier ? jackpotX : undefined,
              });
              if (tier) {
                window.HookBus.emit('onWheelJackpotHit', { tier: tier, x: jackpotX });
              }
            } catch (e) {
              if (console && console.error) console.error('[wws] emit chosen failed:', e);
            }
          }
        }, dur + settleBuf);
      };

      /* Replace click listener: wheelBonus bound to local ref, not window.wbSpin,
       * so monkey-patch doesn't affect initial clicks. Remove old binding, add new. */
      var spinBtn = document.getElementById('wbSpin');
      if (spinBtn) {
        spinBtn.removeEventListener('click', origWbSpin);
        spinBtn.addEventListener('click', window.wbSpin);
      }

      /* Wrap wbClose so we publish __WIN_AWARD__ on collect. */
      if (typeof window.wbClose === 'function') {
        var origClose = window.wbClose;
        window.__origWbClose = origClose;
        window.wbClose = function () {
          /* Guard against phantom collect: if no spin happened, defer to
           * original close without emitting award event. */
          if (!STATE.lastResult) {
            return origClose.call(this);
          }
          /* Resolve the award now — favor jackpot multiplier if it hit,
           * otherwise the segment's nominal value (with fallback to
           * value if the jackpot tier wasn't in the map). */
          var award = 0;
          var isJackpot = false;
          var tierLabel = '';
          var lr = STATE.lastResult;
          if (lr.jackpotTier && lr.jackpotX > 0) {
            award = lr.jackpotX;
            isJackpot = true;
            tierLabel = lr.jackpotTier;
          } else if (lr.jackpotTier && ALLOW_FALLBACK) {
            award = lr.value;
            tierLabel = lr.jackpotTier;
          } else {
            award = lr.value;
          }
          var bet = (typeof window.__SLOT_BET__ === 'number' && window.__SLOT_BET__ > 0)
            ? window.__SLOT_BET__ : 1;
          if (award > 0) {
            window.__WIN_AWARD__ = award * bet;
          }
          if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
            try {
              window.HookBus.emit('onWheelAwardCollected', {
                award: award, isJackpot: isJackpot,
                tier: tierLabel || undefined,
              });
            } catch (e) {
              if (console && console.error) console.error('[wws] emit collected failed:', e);
            }
          }
          /* Reset lastResult AFTER emit so listeners see the value. */
          STATE.lastResult = null;
          /* Defer to original close (hides overlay). */
          return origClose.call(this);
        };
      }

      /* Wrap wbOpen to repaint tier badges on modal (re)open and fix click
       * listener. wheelBonus binds its DOM listeners to local references,
       * so we need to replace the element to unbind and rebind to our
       * weighted draw function. */
      if (typeof window.wbOpen === 'function') {
        var origOpen = window.wbOpen;
        window.__origWbOpen = origOpen;
        window.wbOpen = function () {
          var result = origOpen.call(this);
          /* Replace spin button to remove old listener and add ours. */
          var spinBtn = document.getElementById('wbSpin');
          if (spinBtn && spinBtn.parentNode) {
            var newSpinBtn = spinBtn.cloneNode(true);
            spinBtn.parentNode.replaceChild(newSpinBtn, spinBtn);
            newSpinBtn.addEventListener('click', window.wbSpin);
          }
          /* Repaint tier badges on modal open. */
          _paintTierBadges();
          return result;
        };
      }

      /* Paint tier badges once the wheel DOM exists. */
      _paintTierBadges();
      STATE.patched = true;
    }

    /* Patch at DOMContentLoaded if the document is still loading; else
     * patch immediately. If wheelBonus is emitted after us in bundle,
     * subscribe to its ready event or watch for #wbWheel DOM. */
    function _safePatchSchedule() {
      _patch();

      if (!STATE.patched) {
        /* Try HookBus event if available. */
        if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.on === 'function') {
          try {
            window.HookBus.on('onWheelBonusReady', _patch);
          } catch (e) {
            /* Event not available, fall back to observer. */
          }
        }

        /* Fallback: watch for #wbWheel element appearance. */
        if (!STATE.patched && typeof window !== 'undefined' && typeof MutationObserver !== 'undefined' && typeof document !== 'undefined') {
          var observer = new MutationObserver(function () {
            _patch();
            if (STATE.patched) observer.disconnect();
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
          /* Safety: disconnect after 10 seconds. */
          setTimeout(function () { observer.disconnect(); }, 10000);
        }
      }
    }
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _safePatchSchedule, { once: true });
      } else {
        _safePatchSchedule();
      }
    }

    /* FS boundaries → reset internal state so a stale lastResult can't
     * cross a round. wheelBonus already closes the modal on these. */
    if (typeof window !== 'undefined' && window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onFsTrigger', function () { STATE.lastResult = null; });
      window.HookBus.on('onFsEnd',     function () { STATE.lastResult = null; });
    }
  })();
`;
}
