/**
 * src/blocks/hapticFeedback.mjs
 *
 * Wave A10 — Haptic feedback gating (Web Vibration API).
 *
 * Industry pattern: short, contextual vibration bursts on high-impact
 * player events. Mobile browsers expose `navigator.vibrate`, but misuse
 * (autoplay vibration, long patterns, ignoring reduced-motion) is a
 * player-protection / accessibility risk. This block is a single gate:
 *   • opt-in only (default OFF)
 *   • respects prefers-reduced-motion
 *   • blocked during autoplay (no unsolicited vibration)
 *   • triggered only by big-win tiers ≥ configurable floor and FS trigger
 *   • caps total vibration duration per event (≤ 500 ms default)
 *
 * The block emits NO CSS and NO markup — it is a pure runtime utility.
 *
 * GDD config (consumed from `model.hapticFeedback`):
 *   {
 *     enabled:        boolean (default false)
 *     bigWinMinTier:  number 1..5 (default 3) — fire on tier ≥ N
 *     fsTrigger:      boolean (default true) — fire on free-spins trigger
 *     maxDurationMs:  number (default 500) — per-event ceiling
 *     patterns:       { bigWin: number[], fsTrigger: number[] } ms patterns
 *   }
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitHapticFeedbackRuntime(cfg) → runtime JS string
 *
 * Runtime contract:
 *   window.hapticFeedback(patternName | number[]) → boolean (did fire)
 *   window.HAPTIC_FEEDBACK_STATE on window
 */

const DEFAULT_PATTERNS = Object.freeze({
  bigWin: Object.freeze([40, 60, 40]),
  fsTrigger: Object.freeze([30, 40, 30, 40, 30]),
});

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    bigWinMinTier: 3,
    fsTrigger: true,
    maxDurationMs: 500,
    /* Deep-clone arrays — DEFAULT_PATTERNS is frozen, but config consumers
     * must be free to mutate (e.g. test sandboxes, GDD overrides). */
    patterns: {
      bigWin: DEFAULT_PATTERNS.bigWin.slice(),
      fsTrigger: DEFAULT_PATTERNS.fsTrigger.slice(),
    },
  });
}

function _clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, Number(n) || lo));
}

function _validPattern(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const out = arr
    .map(v => Number(v))
    .filter(v => Number.isFinite(v) && v >= 0 && v <= 1000);
  return out.length > 0 ? out : null;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.hapticFeedback) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.bigWinMinTier)) {
    cfg.bigWinMinTier = _clamp(Math.floor(m.bigWinMinTier), 1, 5);
  }
  if (m.fsTrigger != null) cfg.fsTrigger = !!m.fsTrigger;
  if (Number.isFinite(m.maxDurationMs)) {
    cfg.maxDurationMs = _clamp(m.maxDurationMs, 50, 2000);
  }

  if (m.patterns && typeof m.patterns === 'object') {
    const bw = _validPattern(m.patterns.bigWin);
    if (bw) cfg.patterns.bigWin = bw;
    const fs = _validPattern(m.patterns.fsTrigger);
    if (fs) cfg.patterns.fsTrigger = fs;
  }

  return cfg;
}

export function emitHapticFeedbackRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ hapticFeedback: cfg });
  if (!c.enabled) {
    return `
  /* ── hapticFeedback BLOCK (disabled) ──────────────────────────────── */
  window.hapticFeedback = function () { return false; };
  window.HAPTIC_FEEDBACK_STATE = { enabled: false, lastFiredAt: 0, lastReason: '' };
`;
  }

  return `
  /* ── hapticFeedback BLOCK — emitted by src/blocks/hapticFeedback.mjs
     Web Vibration API gate. Opt-in, reduced-motion aware, autoplay blocked. */
  (function () {
    var ENABLED = ${c.enabled};
    var BIG_WIN_MIN_TIER = ${c.bigWinMinTier};
    var MAX_DURATION_MS = ${c.maxDurationMs};
    var PATTERNS = {
      bigWin: ${JSON.stringify(c.patterns.bigWin)},
      fsTrigger: ${JSON.stringify(c.patterns.fsTrigger)},
    };

    var STATE = {
      enabled: ENABLED,
      lastFiredAt: 0,
      lastReason: '',
    };
    window.HAPTIC_FEEDBACK_STATE = STATE;

    function _capPattern(pattern) {
      var total = 0;
      var out = [];
      for (var i = 0; i < pattern.length; i++) {
        var ms = Math.max(0, Math.min(pattern[i], MAX_DURATION_MS - total));
        if (ms <= 0) break;
        out.push(ms);
        total += ms;
        if (total >= MAX_DURATION_MS) break;
      }
      return out;
    }

    function _reduceMotion() {
      return (typeof window !== 'undefined' &&
              typeof window.matchMedia === 'function' &&
              window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    }

    function _autoplayActive() {
      return !!(typeof window !== 'undefined' && window.__SLOT_AUTOSPIN_ACTIVE__);
    }

    /* W50 — Defense-in-depth LDW gate. winPresentation already prevents
     * onBigWinTierEntered from firing during a Losses-Disguised-as-Wins
     * round (suppresses onWinPresentationStart upstream), so the canonical
     * hapticFeedback call site is silent. This guard catches any FUTURE
     * direct caller (window.hapticFeedback(...) from a custom hook) that
     * tries to vibrate during an LDW-flagged round. Dixon 2010 + UKGC
     * RTS 7C + AGCO 4.07: tactile cues belong to the win-presentation
     * suppression bundle, not just visual + audio. */
    function _ldwActive() {
      return !!(typeof window !== 'undefined' && window.__LDW_SUPPRESSED__ === true);
    }

    window.hapticFeedback = function hapticFeedback(input, reason) {
      if (!ENABLED) return false;
      if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return false;
      if (_reduceMotion()) return false;
      if (_autoplayActive()) return false;
      if (_ldwActive()) return false;

      var pattern;
      if (Array.isArray(input)) {
        pattern = input;
      } else if (typeof input === 'string' && PATTERNS[input]) {
        pattern = PATTERNS[input];
      } else {
        return false;
      }

      pattern = _capPattern(pattern);
      if (pattern.length === 0) return false;

      try {
        var ok = navigator.vibrate(pattern);
        if (ok) {
          STATE.lastFiredAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
          STATE.lastReason = String(reason || input);
        }
        return !!ok;
      } catch (_) {
        return false;
      }
    };

    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onBigWinTierEntered', function (p) {
        if (!p) return;
        var tier = Number(p.tier);
        if (Number.isFinite(tier) && tier >= BIG_WIN_MIN_TIER) {
          window.hapticFeedback('bigWin', 'bigWinTier:' + tier);
        }
      });${c.fsTrigger ? `
      window.HookBus.on('onFsTrigger', function () {
        window.hapticFeedback('fsTrigger', 'fsTrigger');
      });` : ''}
    }
  })();
`;
}
