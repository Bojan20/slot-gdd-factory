/**
 * Slot GDD Factory · anticipation BLOCK
 *
 * Dynamic anticipation arming — when the scatter ladder is one short of the
 * GDD's smallest trigger threshold (or already meets it with bigger awards
 * still possible), every still-spinning reel gets a gold pulse and an
 * extended sequential hold so the player reads "come on…". Each anticipating
 * reel glows for the same visible duration (HOLD_BASE), arrives one-by-one
 * (cabinet cadence), and the wave persists until the trigger is settled or
 * impossible.
 *
 * GDD-driven configuration (consumed from `model.anticipation`):
 *   enabled       boolean                                        (default true)
 *   holdMs        number ms — each reel's visible glow + hold    (default 600)
 *   pulseMs       number ms — glow keyframe cycle                (default 700)
 *   gold          "r,g,b" string — accent color                  (default "255,214,110")
 *   skipDuringFs  boolean — skip arming during FS lifecycle      (default true)
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitAnticipationCSS(cfg)        — pulse keyframes + classes
 *   emitAnticipationRuntime(cfg)    — maybeArmAnticipation() + HOLD_BASE
 *
 * Runtime contract:
 *   HOLD_BASE                       module-local int (used by reel engine)
 *   maybeArmAnticipation()          callback after every reel stop
 *
 * Runtime dependencies: FREESPINS, RECT_REELS, FSM, ROWS, performance.
 *
 * Performance: maybeArmAnticipation() — O(reels × rows) scan, 0 allocations,
 * budget < 200µs per reel-stop.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  holdMs: 600,
  pulseMs: 700,
  gold: '255,214,110',
  /* Boki rule: anticipation must fire EVERYWHERE — BASE and FS_ACTIVE alike.
     Pre-rule this was `true` (skip during FS lifecycle) as a QA-budget
     trade-off; that made retrigger reads feel flat. Explicit GDD knob can
     still flip it back to `true` via `skip-during-fs: true`. */
  skipDuringFs: false,
});

const HOLD_MS_MIN  = 100, HOLD_MS_MAX  = 5000;
const PULSE_MS_MIN = 200, PULSE_MS_MAX = 5000;

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map(p => p.trim());
  if (parts.length !== 3) return false;
  return parts.every(p => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.anticipation) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.holdMs === 'number' && src.holdMs >= HOLD_MS_MIN && src.holdMs <= HOLD_MS_MAX) {
    cfg.holdMs = Math.floor(src.holdMs);
  }
  if (typeof src.pulseMs === 'number' && src.pulseMs >= PULSE_MS_MIN && src.pulseMs <= PULSE_MS_MAX) {
    cfg.pulseMs = Math.floor(src.pulseMs);
  }
  if (isValidRGB(src.gold)) cfg.gold = src.gold;
  /* Tri-state: explicit true → skip during FS; explicit false → run during FS
     (matches new default); undefined → defaults wins (false = "run everywhere"). */
  if (src.skipDuringFs === true) cfg.skipDuringFs = true;
  if (src.skipDuringFs === false) cfg.skipDuringFs = false;
  /* 2026-06-18 — derive emit-time seed triggers from model.features so
   * the runtime IIFE pre-populates __ANT_TRIGGERS__ for every GDD-declared
   * trigger BEFORE the first reel even spins. Eliminates the race where
   * a feature block initialised AFTER anticipation's first call had a
   * silent gap. */
  cfg.seedTriggers = _extractSeedTriggers(model);
  return cfg;
}

function _extractSeedTriggers(model) {
  if (!model || typeof model !== 'object') return [];
  const out = [];
  const seen = new Set();
  function _push(id, sym, threshold, topRung, countMode) {
    if (!sym || !Number.isFinite(threshold)) return;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({
      id,
      symbol: String(sym).toUpperCase(),
      threshold: Math.max(1, Math.floor(threshold)),
      topRung: Math.max(threshold, Math.floor(topRung || threshold)),
      countMode: (countMode === 'any') ? 'any' : 'perReel',
    });
  }
  const features = Array.isArray(model.features) ? model.features : [];
  const hasFS  = features.some(f => f && (f.kind === 'free_spins' || f.kind === 'freespins'));
  const hasHW  = features.some(f => f && f.kind === 'hold_and_win');
  const hasPick = features.some(f => f && (f.kind === 'bonus_pick' || f.kind === 'pick_bonus'));
  const hasDual = features.some(f => f && f.kind === 'dual_role_scatter');
  const hasJkpt = features.some(f => f && (f.kind === 'daily_jackpot' || f.kind === 'jackpot'));
  const hasScatterPay = features.some(f => f && f.kind === 'scatter_pay');

  if (hasFS) {
    const fs = (model.freeSpins && typeof model.freeSpins === 'object') ? model.freeSpins : {};
    const sym = fs.triggerSymbol ||
                (model.symbols && model.symbols.specials || []).find(s => /^S(?:CATTER)?$/i.test(s.id))?.id ||
                'S';
    const thr = (Array.isArray(fs.triggerCounts) && fs.triggerCounts[0]) ||
                (Array.isArray(fs.awards) && fs.awards[0] && fs.awards[0].count) ||
                fs.triggerCount || 3;
    const top = (Array.isArray(fs.awards) ? fs.awards : []).reduce(
      (m, a) => Math.max(m, (a && a.count) || 0), thr);
    _push('fs-seed', sym, thr, top, fs.countMode);
  }
  if (hasHW) {
    const hw = (model.holdAndWin && typeof model.holdAndWin === 'object') ? model.holdAndWin : {};
    _push('hw-seed', hw.bonusSymbolId || 'B', hw.triggerCount || 6,
      hw.triggerCount || 6, 'any');
  }
  if (hasPick) {
    const f = features.find(x => x && (x.kind === 'bonus_pick' || x.kind === 'pick_bonus')) || {};
    _push('pick-seed', f.symbol || 'P', f.triggerCount || 3, f.triggerCount || 5, 'perReel');
  }
  if (hasDual) {
    const f = features.find(x => x && x.kind === 'dual_role_scatter') || {};
    _push('dual-seed', f.symbol || 'S', f.triggerCount || 3, f.triggerCount || 5, 'perReel');
  }
  if (hasJkpt) {
    const f = features.find(x => x && (x.kind === 'daily_jackpot' || x.kind === 'jackpot')) || {};
    _push('jackpot-seed', f.symbol || 'J', f.triggerCount || 3, f.triggerCount || 6, 'any');
  }
  if (hasScatterPay && !hasFS) {
    const f = features.find(x => x && x.kind === 'scatter_pay') || {};
    const sym = f.symbol ||
                (model.symbols && model.symbols.specials || []).find(s => /^S(?:CATTER)?$/i.test(s.id))?.id ||
                'S';
    _push('scatter-seed', sym, f.triggerCount || 3, f.triggerCount || 5, 'perReel');
  }
  return out;
}

export function emitAnticipationCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipation: cfg });
  if (!c.enabled) return `\n/* anticipation BLOCK (disabled by GDD) — no CSS emitted */\n`;

  /* ── private CSS magic-number constants ────────────────────────────────
     Every opacity / blur / accent literal that previously lived inline in
     the template now has exactly one named declaration. Opacities are kept
     as STRINGS (not Number) so the emitted CSS text is byte-identical to
     the prior hand-tuned values — e.g. "0.30" must not collapse to "0.3"
     via Number.prototype.toString(), which would break visual diffs and
     any snapshot tests in tests/visual-regression. */

  // Gold inset-border alpha at steady state. Shared by: reelCol static rule,
  // reel keyframe 0%/100%, cell keyframe 0%/100% border.
  const OPACITY_BORDER_STEADY      = '0.55';
  // Gold inset-glow alpha at cell keyframe 50% — same numeric value as
  // OPACITY_BORDER_STEADY but decoupled so tuning one role does not drift the other.
  const OPACITY_GLOW_CELL_KF_PEAK  = '0.55';
  // Gold inset-glow alpha on the .reelCol--anticipating static (non-keyframe) rule.
  const OPACITY_GLOW_REEL_STATIC   = '0.25';
  // Gold inset-glow alpha at reel keyframe 0%/100% — the resting low end of the pulse.
  const OPACITY_GLOW_REEL_KF_BASE  = '0.22';
  // Gold inset-glow alpha at reel keyframe 50% — peak of the mid-pulse swell.
  const OPACITY_GLOW_REEL_KF_PEAK  = '0.42';
  // Lighter-accent inset-border alpha at the 50% mid-pulse highlight (both reel + cell variants).
  const OPACITY_HIGHLIGHT_MIDPULSE = '0.85';
  // Gold inset-border alpha on the .cell--anticipating static rule — slightly hotter than reel.
  const OPACITY_BORDER_CELL_STATIC = '0.6';
  // Gold inset-glow alpha on the .cell--anticipating static rule.
  const OPACITY_GLOW_CELL_STATIC   = '0.32';
  // Gold inset-glow alpha at cell keyframe 0%/100% — the resting low end of the cell pulse.
  const OPACITY_GLOW_CELL_KF_BASE  = '0.30';

  // Inset-glow blur radius on the reel column — used by static rule AND kf 0%/100%.
  const BLUR_REEL_BASE    = '35px';
  // Inset-glow blur radius on the reel column at kf 50% — wider mid-pulse spread.
  const BLUR_REEL_PEAK    = '55px';
  // Inset-glow blur radius on .cell--anticipating static rule.
  const BLUR_CELL_STATIC  = '16px';
  // Inset-glow blur radius on cell at kf 0%/100% — slightly tighter than the static rule.
  const BLUR_CELL_KF_BASE = '14px';
  // Inset-glow blur radius on cell at kf 50% — wider mid-pulse spread.
  const BLUR_CELL_PEAK    = '22px';

  // Inset-border width — single source of truth for every `inset 0 0 0 …` box-shadow site.
  const BORDER_WIDTH      = '2px';

  // Lighter accent RGB triplet (no alpha). Used ONLY at the 50% mid-pulse
  // keyframe of both reel + cell variants to lift the border above the
  // steady GDD-knob `gold` color for a perceptible highlight pop.
  const GOLD_HIGHLIGHT_RGB = '255, 230, 168';

  return `
/* ── anticipation BLOCK — emitted by src/blocks/anticipation.mjs ──────────
   GDD knobs (baked at build time):
     enabled = ${c.enabled}
     holdMs  = ${c.holdMs}
     pulseMs = ${c.pulseMs}
     gold    = ${c.gold}
   Soft golden inset glow on the reel column / cell while the scatter ladder
   is one short of trigger. Two keyframe sets — reel-antic-pulse (column
   variant) and cell-antic-pulse (per-cell variant for non-rectangular). */
.reelCol--anticipating {
  box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
              inset 0 0 ${BLUR_REEL_BASE} rgba(${c.gold}, ${OPACITY_GLOW_REEL_STATIC});
  animation: reel-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes reel-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
                         inset 0 0 ${BLUR_REEL_BASE} rgba(${c.gold}, ${OPACITY_GLOW_REEL_KF_BASE}); }
  50%      { box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${GOLD_HIGHLIGHT_RGB}, ${OPACITY_HIGHLIGHT_MIDPULSE}),
                         inset 0 0 ${BLUR_REEL_PEAK} rgba(${c.gold}, ${OPACITY_GLOW_REEL_KF_PEAK}); }
}
.cell--anticipating {
  box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${c.gold}, ${OPACITY_BORDER_CELL_STATIC}),
              inset 0 0 ${BLUR_CELL_STATIC} rgba(${c.gold}, ${OPACITY_GLOW_CELL_STATIC});
  animation: cell-antic-pulse ${c.pulseMs}ms ease-in-out infinite;
}
@keyframes cell-antic-pulse {
  0%, 100% { box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${c.gold}, ${OPACITY_BORDER_STEADY}),
                         inset 0 0 ${BLUR_CELL_KF_BASE} rgba(${c.gold}, ${OPACITY_GLOW_CELL_KF_BASE}); }
  50%      { box-shadow: inset 0 0 0 ${BORDER_WIDTH} rgba(${GOLD_HIGHLIGHT_RGB}, ${OPACITY_HIGHLIGHT_MIDPULSE}),
                         inset 0 0 ${BLUR_CELL_PEAK} rgba(${c.gold}, ${OPACITY_GLOW_CELL_KF_PEAK}); }
}
@media (prefers-reduced-motion: reduce) {
  .reelCol--anticipating,
  .cell--anticipating { animation: none; }
}
`;
}

export function emitAnticipationRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ anticipation: cfg });
  if (!c.enabled) {
    return `
  /* ── anticipation BLOCK (disabled by GDD) ───────────────────────────── */
  const HOLD_BASE = ${c.holdMs};
  function maybeArmAnticipation() { /* no-op */ }
`;
  }
  return `
  /* ── anticipation BLOCK — emitted by src/blocks/anticipation.mjs ─────
     GDD knobs:
       holdMs       = ${c.holdMs}
       pulseMs      = ${c.pulseMs}
       gold         = ${c.gold}
       skipDuringFs = ${c.skipDuringFs}

     Dynamic anticipation arming. Called after every reel STOP transition
     in onTickAll(). Counts visible trigger symbols across the already-
     stopped reels and, if the count is one short of the GDD's smallest
     trigger threshold (or already meets it — bigger awards still on the
     line), pushes back the stop time on every still-spinning reel so the
     player sees the classic "come on…" slowdown.

     Why this works dynamically rather than pre-computed:
       1. Real spins (no FORCE_TRIGGER) can land scatters anywhere — we can
          only tell after each reel settles.
       2. Even with FORCE_TRIGGER, the random POOL can drop bonus scatters
          past the planted N, raising the award. The slowdown must hold
          until the LAST reel that could affect the award has stopped. */
  const HOLD_BASE = ${c.holdMs};

  /* Shared registry — anticipation.mjs is the single owner of the rect-reel
     kind list. Companion blocks (e.g. anticipationUniversal.mjs) read from
     window.__ANT_RECT_KINDS__ so adding/renaming a reel shape touches one
     file, not two. Idempotent: only seeded if not already present. */
  if (typeof window !== 'undefined' && !(window.__ANT_RECT_KINDS__ instanceof Set)) {
    window.__ANT_RECT_KINDS__ = new Set([
      'rectangular','cluster','megaclusters','lock_respin',
      'expanding','infinity','variable_reel',
      'diamond','pyramid','cross','l_shape'
    ]);
  }

  /* Wave S LEGO conformance — anticipation registers preSpin to clear any
     leftover glow timers / anticipating flags from the previous spin. Without
     this, a fast click after a near-miss can carry the gold pulse into the
     fresh spin (visible as ghost glow on reels 4-5 the moment they spawn). */
  function _anticipationPreSpinReset() {
    if (!Array.isArray(RECT_REELS)) return;
    for (const reel of RECT_REELS) {
      if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
      if (reel.stopTimerId) { /* leave engine to re-set */ }
      reel.anticipating = false;
      if (reel.col && reel.col.classList) {
        reel.col.classList.remove('reelCol--anticipating');
      }
    }
    /* Per-cell variant for non-rectangular grids. */
    if (typeof document !== 'undefined') {
      document.querySelectorAll('.cell--anticipating').forEach(c =>
        c.classList.remove('cell--anticipating'));
    }
  }
  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin', _anticipationPreSpinReset, { priority: 10 });
    /* Also reset on FS boundary — entering or leaving FS clears state. */
    HookBus.on('onFsTrigger', _anticipationPreSpinReset, { priority: 10 });
    HookBus.on('onFsEnd',     _anticipationPreSpinReset, { priority: 10 });
  }

  /* ── Universal trigger registry ──────────────────────────────────────
   * 2026-06-18 — Boki rule (HNP backlog "nema aniticipacije kada je
   * sketer ili bilo koji bonus sim bol"): anticipation MUST arm for
   * ANY trigger-counting symbol on the grid, not just the FS scatter.
   * Other blocks (hold & win, bonus pick, dual-role scatter, daily
   * jackpot) register their own (symbolId, triggerCount, topRung)
   * tuple here at runtime startup; maybeArmAnticipation aggregates the
   * suspense over all of them and lights the reel for the FIRST trigger
   * that becomes mathematically alive. Each entry is idempotent (keyed
   * by symbolId — re-registration overwrites). */
  if (typeof window !== 'undefined' && !Array.isArray(window.__ANT_TRIGGERS__)) {
    window.__ANT_TRIGGERS__ = [];
  }

  /* 2026-06-18 — emit-time seed (cfg.seedTriggers from resolveConfig).
   * Pre-seeds __ANT_TRIGGERS__ at runtime IIFE startup so anticipation
   * KNOWS about every GDD-declared trigger (FS scatter, H&W bonus,
   * bonus_pick, dual_role_scatter, jackpot) BEFORE the first reel even
   * spins. Previously _antTriggers() only saw triggers seeded via
   * window.HW_STATE.enabled / window.FREESPINS.enabled, which were
   * race-fragile: any block whose runtime IIFE initialised AFTER
   * anticipation's first call had a silent gap. Emit-time seeding is
   * unconditional — if the GDD declared the feature, the seed lands. */
  ${JSON.stringify(cfg.seedTriggers || []).replace(/^/, 'var _ANT_SEEDS = ').replace(/$/, ';')}
  if (typeof window !== 'undefined' && Array.isArray(_ANT_SEEDS)) {
    for (var __ai = 0; __ai < _ANT_SEEDS.length; __ai++) {
      var __seed = _ANT_SEEDS[__ai];
      if (!__seed || !__seed.symbol) continue;
      /* De-dupe by id — if the same trigger was already pushed by a
       * block's own init script, leave it alone. */
      var __already = false;
      for (var __aj = 0; __aj < window.__ANT_TRIGGERS__.length; __aj++) {
        if (window.__ANT_TRIGGERS__[__aj].id === __seed.id) { __already = true; break; }
      }
      if (!__already) window.__ANT_TRIGGERS__.push(__seed);
    }
  }
  function _antTriggers() {
    var t = (typeof window !== 'undefined' && Array.isArray(window.__ANT_TRIGGERS__))
      ? window.__ANT_TRIGGERS__ : [];
    /* Seed FS scatter ladder when FREESPINS is enabled (legacy contract). */
    var out = [];
    if (FREESPINS && FREESPINS.enabled) {
      var sym = (FREESPINS.triggerSymbol || "S").toUpperCase();
      var thr = (FREESPINS.triggerCounts && FREESPINS.triggerCounts[0]) ||
                (FREESPINS.awards && FREESPINS.awards[0] && FREESPINS.awards[0].count) || 3;
      var top = (FREESPINS.awards || []).reduce(function (m, a) { return Math.max(m, a.count); }, thr);
      var mode = (FREESPINS.countMode === 'any') ? 'any' : 'perReel';
      out.push({ id: 'fs', symbol: sym, threshold: thr, topRung: top, countMode: mode });
    }
    /* Seed Hold & Win bonus ladder when enabled. Other blocks
     * (bonusPick, dualRoleScatter) push to window.__ANT_TRIGGERS__
     * directly at their runtime init. */
    if (typeof window !== 'undefined' && window.HW_STATE && window.HW_STATE.enabled) {
      var hwSym = (window.HW_STATE.bonusSymbolId || 'B').toUpperCase();
      var hwThr = window.HW_STATE.triggerCount || 6;
      out.push({ id: 'hw', symbol: hwSym, threshold: hwThr, topRung: hwThr, countMode: 'any' });
    }
    /* 2026-06-18 — Boki rule "anticipation u svakom gdd-u mora da radi
     * uvek" (HEAD 72f3170 still failed live probe on GoO1000 which has
     * FREESPINS.enabled=false). DEFAULT FALLBACK: when neither FS nor
     * H&W are enabled, seed a generic scatter-style trigger from the
     * symbol registry so the player still gets suspense feedback on
     * any anchor symbol the GDD declared. Vendor-neutral, picks from
     * (a) SYMBOL_REGISTRY.scatter, (b) FREESPINS.triggerSymbol even when
     * disabled (parser fallback), (c) the canonical 'S' / 'SC' / 'B'
     * order, in priority. Threshold defaults to 3 (industry baseline). */
    if (out.length === 0) {
      var fallbackSym = null;
      try {
        /* SYMBOL_REGISTRY lives in the outer slot IIFE scope; access via
         * window so the anticipation IIFE doesn't depend on lexical
         * visibility (orchestrator block ordering can drift). */
        var REG = (typeof window !== 'undefined' && window.SYMBOL_REGISTRY) ||
                  (typeof SYMBOL_REGISTRY !== 'undefined' ? SYMBOL_REGISTRY : null);
        if (REG && typeof REG.scatter === 'string') {
          fallbackSym = REG.scatter.toUpperCase();
        } else if (FREESPINS && typeof FREESPINS.triggerSymbol === 'string') {
          fallbackSym = FREESPINS.triggerSymbol.toUpperCase();
        }
      } catch (_) {}
      if (!fallbackSym && typeof document !== 'undefined') {
        /* Scan the grid for any cell whose textContent is a canonical
         * trigger glyph. Last-resort discovery so we always have a
         * symbol to suspense on. */
        var anchors = ['SC', 'S', 'B', 'BONUS', 'SCATTER'];
        var grid = document.querySelector('.gridHost');
        if (grid) {
          var seenSyms = {};
          var cells = grid.querySelectorAll('.cell');
          for (var ci = 0; ci < cells.length; ci++) {
            var sv = (cells[ci].textContent || '').trim().toUpperCase();
            if (sv) seenSyms[sv] = 1;
          }
          for (var ai = 0; ai < anchors.length; ai++) {
            if (seenSyms[anchors[ai]]) { fallbackSym = anchors[ai]; break; }
          }
        }
      }
      if (fallbackSym) {
        out.push({ id: 'fallback', symbol: fallbackSym, threshold: 3, topRung: 5, countMode: 'perReel' });
      }
    }
    /* External registrations (additional triggers). */
    for (var i = 0; i < t.length; i++) {
      if (t[i] && typeof t[i].symbol === 'string' && Number.isFinite(t[i].threshold)) {
        out.push({
          id: t[i].id || ('x' + i),
          symbol: t[i].symbol.toUpperCase(),
          threshold: t[i].threshold,
          topRung: Number.isFinite(t[i].topRung) ? t[i].topRung : t[i].threshold,
          countMode: t[i].countMode === 'any' ? 'any' : 'perReel',
        });
      }
    }
    /* De-dupe by symbol (last write wins) so a GDD that uses the same
     * sym for FS + H&W doesn't double-count. */
    var seen = {};
    var unique = [];
    for (var j = out.length - 1; j >= 0; j--) {
      if (!seen[out[j].symbol]) { seen[out[j].symbol] = 1; unique.unshift(out[j]); }
    }
    return unique;
  }

  function maybeArmAnticipation() {
    if (!RECT_REELS) return;
    /* 2026-06-18 — opt-in debug trace. Enable from QA tools:
     *   window.__ANT_DEBUG__ = [];
     * Probes can then read window.__ANT_DEBUG__ to see exactly what each
     * arm call observed (call count, scatter scans, alive verdict). */
    var __dbg = (typeof window !== 'undefined' && Array.isArray(window.__ANT_DEBUG__))
      ? window.__ANT_DEBUG__ : null;
    ${c.skipDuringFs ? `/* Anticipation is a BASE-game suspense cue — skipped during FS lifecycle. */
    if (FSM && FSM.phase && FSM.phase !== 'BASE') return;` : `/* skipDuringFs disabled in GDD — anticipation also runs inside FS_*. */`}
    /* 2026-06-18 — Boki rule "anticipation mora da radi uvek u svakom
     * gdd-u" — the legacy hard FORCE_TRIGGER skip is REMOVED. That
     * guard was added 2026-06-09 because the old arming path re-armed
     * the remaining reels on every reel-stop, with each pass appending
     * HOLD_BASE to scheduledStopAt without checking if a reel was
     * already anticipating — that's the actual infinite-spin bug. The
     * fix below filters "ordered" to only NEW (non-already-anticipating)
     * reels, so re-entry on later reel stops is a no-op. With that
     * guard already in place, force-trigger scatter-plant (FS chip
     * click planting 2-3 scatters) is now legitimate "live" scatter
     * data and SHOULD drive the suspense glow on remaining reels —
     * that's exactly what Boki demands. */

    var triggers = _antTriggers();
    if (__dbg) __dbg.push({ t: performance.now(), step: 'triggers', count: triggers.length, triggers: triggers.slice() });
    if (triggers.length === 0) return;

    var stillSpinning = RECT_REELS.filter(function (r) { return r.spinning; });
    if (__dbg) __dbg.push({ t: performance.now(), step: 'stillSpinning', count: stillSpinning.length });
    if (stillSpinning.length === 0) return;
    var remaining = stillSpinning.length;

    /* Walk each registered trigger; the FIRST one that is "mathematically
     * alive" (scattersSoFar + remaining >= threshold) AND not yet at
     * topRung wins and arms the suspense. Multiple triggers cannot stack
     * the per-reel hold timers — that would cascade infinite waits. */
    var armedTrigger = null;
    for (var ti = 0; ti < triggers.length; ti++) {
      var trg = triggers[ti];
      var scattersSoFar = 0;
      for (var ri = 0; ri < RECT_REELS.length; ri++) {
        var r = RECT_REELS[ri];
        if (r.spinning) continue;
        var reelHits = 0;
        var vis = r.visibleRows || ROWS;
        for (var k = 1; k <= vis; k++) {
          if ((r.cells[k].textContent || "").toUpperCase() === trg.symbol) reelHits++;
        }
        scattersSoFar += (trg.countMode === 'any') ? reelHits : (reelHits > 0 ? 1 : 0);
      }
      /* Wave V1 gate — anticipationGate = max(1, threshold - remaining) */
      var anticipationGate = Math.max(1, trg.threshold - remaining);
      var alive = (scattersSoFar >= anticipationGate) &&
                  (scattersSoFar + remaining >= trg.threshold) &&
                  (scattersSoFar < trg.topRung);
      if (__dbg) __dbg.push({ t: performance.now(), step: 'verdict', trigger: trg.id, symbol: trg.symbol, scattersSoFar: scattersSoFar, gate: anticipationGate, alive: alive });
      if (alive) { armedTrigger = trg; break; }
    }
    if (!armedTrigger) return;
    if (__dbg) __dbg.push({ t: performance.now(), step: 'armed', triggerId: armedTrigger.id, reels: stillSpinning.map(function (r) { return RECT_REELS.indexOf(r); }) });

    /* Sequential per-reel anticipation hold — every anticipating reel
       glows for exactly HOLD_BASE before landing. */
    var now = performance.now();
    var cursor = stillSpinning.reduce(
      function (m, r) { return Math.max(m, r.scheduledStopAt); }, now);
    var ordered = stillSpinning
      .filter(function (r) { return !r.anticipating; })
      .sort(function (a, b) { return a.scheduledStopAt - b.scheduledStopAt; });
    ordered.forEach(function (r) {
      r.anticipating = true;
      r.anticipatingFor = armedTrigger.id;
      var glowStartAt = cursor;
      cursor += HOLD_BASE;
      r.scheduledStopAt = cursor;
      /* 2026-06-18 — CRITICAL race fix (Boki "anticipacija ne radi"
       * live-probe verdict: arms+sched-extends OK but reel still stops
       * immediately because stopRequested=true was already latched by
       * the initial startSpinAll stagger timer). Reset stopRequested
       * to false here — the new stopTimerId below is the authoritative
       * stop signal once anticipation owns the reel. Without this, the
       * next onTickAll iteration sees stopRequested=true + minRotations
       * met → commitStopSymbols fires → reel stops before glow class
       * is even painted. Surgical probe confirmed maybeArmAnticipation
       * arms reels 2/3/4 correctly; live spin lost the suspense purely
       * because of this stale stopRequested flag. */
      r.stopRequested = false;
      var glowDelay = Math.max(0, glowStartAt - now);
      if (r.glowTimerId) clearTimeout(r.glowTimerId);
      r.glowTimerId = setTimeout(function () {
        if (r.col && r.col.classList) r.col.classList.add("reelCol--anticipating");
      }, glowDelay);
      if (r.stopTimerId) clearTimeout(r.stopTimerId);
      r.stopTimerId = setTimeout(function () {
        r.stopRequested = true;
        r.stopRequestTime = performance.now();
      }, r.scheduledStopAt - now);
    });
  }
`;
}
