/**
 * src/blocks/expandingWild.mjs
 *
 * Wave L2 — Expanding Wild block.
 *
 * When GDD declares an `expanding_wild` feature, this block emits:
 *   • CSS expand-grow keyframe + column-fill overlay
 *   • Runtime that detects a wild on a reel, fills the whole column with
 *     the wildSymbolId, and flags those cells `.cell--expanded-wild`
 *
 * GDD knobs:
 *   • mode: 'fs' | 'base' | 'both'
 *   • wildSymbolId: string
 *   • expandDurationMs: number (CSS grow animation)
 *   • haloColor: 'r,g,b'
 *
 * HOOK CONTRACT:
 *   Subscribes to 'onSpinResult' (post reels-settle) and emits
 *   'expandingWild:applied' with { expanded, mode } so win-calc / rollup /
 *   audio / analytics can react. Win evaluation MUST listen for
 *   'expandingWild:applied' on spins where expansion fires; otherwise
 *   expanded wilds will not contribute to wins (silent payout regression).
 *   Also emits 'expandingWild:cleared' from clearExpandingWilds
 *   (preSpin / onFsTrigger).
 *
 * PERF BUDGET: ≤0.5ms on 6×5 grid (one querySelectorAll + O(REELS·ROWS) loop).
 */

const MIN_DURATION_MS = 80;
const MAX_DURATION_MS = 2000;
const FALLBACK_REELS  = 5;
const FALLBACK_ROWS   = 3;

/* UQ-DEEP-X (Boki 2026-06-24): 3-stage industry-grade animation constants.
 * Source: reference lock-respin GDD GDD §13.3 "Wild Expansion & Pattern Win" — Stage 2
 * 350ms exact + top→bottom flood-fill, gold rim. Industry baseline
 * (reference vendor/industry standard/BGaming): 3 stages (anticipation → expand → hold pulse). */
const EW = {
  /* Stage 1 — anticipation glow (per source cell that triggered). */
  STAGE1_MS:          180,
  STAGE1_SCALE_PEAK:  1.08,
  STAGE1_GLOW_PEAK_A: 0.9,
  /* Stage 2 — column flood-fill (top → bottom). Per-row stagger. */
  STAGE2_MS:          350,
  STAGE2_ROW_STAGGER_MS: 60,
  STAGE2_SCALE_FROM:  0.85,
  STAGE2_SCALE_OVER:  1.05,
  /* Stage 3 — hold pulse (loops while wild is active). */
  STAGE3_LOOP_MS:     1200,
  STAGE3_SCALE_AMPL:  1.015,
  STAGE3_GLOW_MIN_A:  0.5,
  STAGE3_GLOW_MAX_A:  0.85,
  /* Visual rim + glow. */
  RIM_PX:             2,
  RIM_ALPHA:          0.95,
  GLOW_PX:            20,
  GLOW_BASE_ALPHA:    0.7,
  /* Stage 4 — clear (preSpin). */
  STAGE4_MS:          150,
  /* Lava gradient (reference lock-respin GDD-class molten gold; vendor-neutral). */
  LAVA_COLOR_HOT:     '#FF6A1A',
  LAVA_COLOR_WARM:    '#FFB347',
  RIM_COLOR:          'rgba(255, 215, 100, 0.95)',
  /* Easing curves (Material D3 emphasized decel for flood, sine for pulse). */
  EASE_FLOOD:         'cubic-bezier(0.2, 0, 0, 1)',
  EASE_ANTICIPATE:    'cubic-bezier(0.4, 0, 0.6, 1)',
};

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* UQ-DEEP-K fix (Boki "ne radi expanding wild u [reference-slot]"
     * 2026-06-23): [reference-slot] GDD spec — expanding wild fires
     * u BASE game (reels 2-5 only) jer signature pattern win zavisi od
     * njega. Prethodni default 'fs' je disabling-ed mehaniku u BASE
     * phase, što je suprotno industriji. 'both' je najpermisivniji safe
     * default — block se aktivira u obe phase ako GDD ne kaže drugačije.
     * Parser i dalje override-uje sa mode='base'/'fs' kad GDD eksplicitno. */
    mode: 'both',
    wildSymbolId: 'W',
    expandDurationMs: 360,
    haloColor: '255,214,110',
    /* RENDER-INTEG-A (2026-06-23): GDD-declared gate. When true, expansion
     * only fires on spins where a paying win already landed. Mirrors GDD
     * "Expanding Wild — only_if_winning" prose. Parser (MATH-DEEP D-16)
     * already extracts model.expandingWild.onlyIfWinning; this surfaces it
     * through render so live slot.html honors the same gate. */
    onlyIfWinning: false,
    /* UQ-DEEP-K: GDD knob za "reels 2-5 only" ([reference-slot]) tip
     * restrikciju. Parser ekstraktuje appliesOnReels:[2,3,4,5] već.
     * Block sad honor-uje: skip wild detection u kolonama van liste.
     * Default null = sve kolone allowed. Spec 1-indexed jer GDD je tako. */
    appliesOnReels: null,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.expandingWild || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (m.mode === 'fs' || m.mode === 'base' || m.mode === 'both') cfg.mode = m.mode;
  if (typeof m.wildSymbolId === 'string' && /^[A-Za-z][A-Za-z0-9_]*$/.test(m.wildSymbolId)) cfg.wildSymbolId = m.wildSymbolId;
  if (Number.isFinite(m.expandDurationMs)) cfg.expandDurationMs = clampInt(m.expandDurationMs, MIN_DURATION_MS, MAX_DURATION_MS);
  if (typeof m.haloColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.haloColor)) cfg.haloColor = m.haloColor;
  if (m.onlyIfWinning === true || m.onlyIfWinning === false) cfg.onlyIfWinning = m.onlyIfWinning;
  /* UQ-DEEP-K: parse appliesOnReels — 1-indexed array from GDD prose,
   * normalize na 0-indexed integer set za brzi membership check u
   * runtime-u. Filter to valid integers in [1, 12] range to reject
   * pathological GDD inputs. */
  if (Array.isArray(m.appliesOnReels)) {
    const reels = m.appliesOnReels
      .map((n) => Number(n))
      .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
    cfg.appliesOnReels = reels.length > 0 ? reels : null;
  }

  /* UQ-DEEP-Q B2 (CRIT) fix: also inherit knobs from features[].config when
   * parser emits the feature in canonical features[] shape rather than
   * top-level expandingWild key. [reference-slot] GDD ekstraktor emits:
   *   features: [{ kind: 'expanding_wild',
   *                config: { appliesOnReels:[2,3,4,5], onlyIfWinning:true,
   *                          mode:'base', wildSymbolId:'W' } }]
   * Before this fix, only `model.expandingWild.*` was read → reel
   * restriction + only_if_winning + base-mode preference all silently
   * dropped → wild expanded on reel 1 with no winning-line gate. */
  if (Array.isArray(model.features)) {
    const ewFeature = model.features.find((f) => f && f.kind === 'expanding_wild');
    if (ewFeature) {
      cfg.enabled = true;
      const fc = ewFeature.config || ewFeature.opts || {};
      if (cfg.appliesOnReels == null && Array.isArray(fc.appliesOnReels)) {
        const reels = fc.appliesOnReels
          .map((n) => Number(n))
          .filter((n) => Number.isInteger(n) && n >= 1 && n <= 12);
        if (reels.length > 0) cfg.appliesOnReels = reels;
      }
      if ((fc.mode === 'fs' || fc.mode === 'base' || fc.mode === 'both')
          && m.mode == null) cfg.mode = fc.mode;
      if (typeof fc.wildSymbolId === 'string'
          && /^[A-Za-z][A-Za-z0-9_]*$/.test(fc.wildSymbolId)
          && m.wildSymbolId == null) cfg.wildSymbolId = fc.wildSymbolId;
      if ((fc.onlyIfWinning === true || fc.onlyIfWinning === false)
          && m.onlyIfWinning == null) cfg.onlyIfWinning = fc.onlyIfWinning;
    }
  }
  return cfg;
}

export function emitExpandingWildCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── expanding wild (UQ-DEEP-X 3-stage industry animation) ─────── */

/* Stage 1: anticipation glow (per source cell that triggered).
 * Single cell flash → signals "wild detected, expansion incoming". */
.cell.is-wild-anticipation {
  position: relative;
  animation: ewAnticipate ${EW.STAGE1_MS}ms ${EW.EASE_ANTICIPATE};
  z-index: 3;
}
@keyframes ewAnticipate {
  0%   { transform: scale(1); box-shadow: 0 0 0 0 rgba(255,200,80,0); }
  50%  { transform: scale(${EW.STAGE1_SCALE_PEAK}); box-shadow: 0 0 24px 4px rgba(255,200,80,${EW.STAGE1_GLOW_PEAK_A}); filter: brightness(1.6); }
  100% { transform: scale(1); box-shadow: 0 0 12px 2px rgba(255,200,80,0.6); filter: brightness(1); }
}

/* Stage 2: column flood-fill, top-down stagger.
 * Per-row CSS var --ew-row-delay = N * STAGE2_ROW_STAGGER_MS (ms).
 * Lava gradient + gold rim. Material D3 emphasized decel. */
.cell.is-wild-expanding {
  position: relative;
  animation: ewExpand ${EW.STAGE2_MS}ms ${EW.EASE_FLOOD} both;
  animation-delay: var(--ew-row-delay, 0ms);
  background:
    linear-gradient(135deg, ${EW.LAVA_COLOR_HOT} 0%, ${EW.LAVA_COLOR_WARM} 100%);
  background-blend-mode: screen;
  box-shadow:
    inset 0 0 0 ${EW.RIM_PX}px ${EW.RIM_COLOR},
    0 0 ${EW.GLOW_PX}px rgba(255, 140, 40, ${EW.GLOW_BASE_ALPHA});
  z-index: 2;
}
@keyframes ewExpand {
  0%   { transform: scale(${EW.STAGE2_SCALE_FROM}); opacity: 0; filter: brightness(1.8); }
  60%  { transform: scale(${EW.STAGE2_SCALE_OVER}); opacity: 1; filter: brightness(1.2); }
  100% { transform: scale(1); opacity: 1; filter: brightness(1); }
}

/* Stage 3: hold pulse loop while wild active.
 * Subtle sub-bass-like visual idle so player ostane fokusiran. */
.cell.is-wild-hold {
  position: relative;
  animation: ewHoldPulse ${EW.STAGE3_LOOP_MS}ms ease-in-out infinite;
  background:
    linear-gradient(135deg, ${EW.LAVA_COLOR_HOT} 0%, ${EW.LAVA_COLOR_WARM} 100%);
  background-blend-mode: screen;
  box-shadow:
    inset 0 0 0 ${EW.RIM_PX}px ${EW.RIM_COLOR},
    0 0 ${EW.GLOW_PX}px rgba(255, 140, 40, ${EW.GLOW_BASE_ALPHA});
  z-index: 2;
}
@keyframes ewHoldPulse {
  0%, 100% { box-shadow: inset 0 0 0 ${EW.RIM_PX}px ${EW.RIM_COLOR}, 0 0 ${EW.GLOW_PX}px rgba(255, 140, 40, ${EW.STAGE3_GLOW_MIN_A}); transform: scale(1); }
  50%      { box-shadow: inset 0 0 0 ${EW.RIM_PX}px ${EW.RIM_COLOR}, 0 0 ${EW.GLOW_PX + 6}px rgba(255, 140, 40, ${EW.STAGE3_GLOW_MAX_A}); transform: scale(${EW.STAGE3_SCALE_AMPL}); }
}

/* Stage 4: clear (preSpin / onFsTrigger). */
.cell.is-wild-clearing {
  animation: ewClear ${EW.STAGE4_MS}ms ease-in both;
}
@keyframes ewClear {
  0%   { opacity: 1; transform: scale(1); }
  100% { opacity: 0; transform: scale(0.95); }
}

/* Legacy class kept za backward compat (any external test / selector
 * that scrapes .is-expanded-wild still pojavljuje class — block uvek
 * dodaje paralelno sa stage class-om). */
.cell.is-expanded-wild { z-index: 2; }

/* Reduced motion — skip stages 1 + 3 (loop), Stage 2 collapse to instant. */
@media (prefers-reduced-motion: reduce) {
  .cell.is-wild-anticipation,
  .cell.is-wild-expanding,
  .cell.is-wild-hold,
  .cell.is-wild-clearing { animation: none; }
  .cell.is-wild-expanding,
  .cell.is-wild-hold {
    /* Skip animation but keep visual state (gold rim + lava bg). */
    opacity: 1; transform: scale(1);
  }
}
`;
}

export function emitExpandingWildRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* expandingWild: disabled */`;
  return `/* ─── expanding wild runtime ──────────────────────────────────── */
const EXPANDING_WILD_MODE   = ${JSON.stringify(cfg.mode)};
const EXPANDING_WILD_SYMBOL = ${JSON.stringify(cfg.wildSymbolId)};
const EXPANDING_WILD_ONLY_IF_WINNING = ${JSON.stringify(cfg.onlyIfWinning)};
/* UQ-DEEP-K: GDD-declared reel restriction (1-indexed). Block normalizes
 * to 0-indexed Set in runtime. Empty/null = no restriction (all cols). */
const EXPANDING_WILD_APPLIES_ON_REELS_RAW = ${JSON.stringify(cfg.appliesOnReels)};
const EXPANDING_WILD_APPLIES_ON_REELS = Array.isArray(EXPANDING_WILD_APPLIES_ON_REELS_RAW)
  ? new Set(EXPANDING_WILD_APPLIES_ON_REELS_RAW.map((n) => n - 1))
  : null;
const EXPANDING_WILD_FALLBACK_REELS = ${FALLBACK_REELS};
const EXPANDING_WILD_FALLBACK_ROWS  = ${FALLBACK_ROWS};

/* RENDER-INTEG-A (2026-06-23) — onlyIfWinning gate.
 * UQ-DEEP-Q B6 fix: pravi class koji winPresentation postavlja je
 *   .cell--winsym (NOT .cell--win) — gate je do sad UVEK vraćao false
 *   za onlyIfWinning=true igre ([reference-slot]) → expansion nikad ne fire-uje.
 *   Sad gleda više pravih klasa + win-line overlay DOM. */
function _expWildOnlyIfWinningPassed() {
  if (!EXPANDING_WILD_ONLY_IF_WINNING) return true;
  if (typeof window !== 'undefined' && window.__FORCE_FEATURE_PENDING__ === 'expanding_wild') return true;
  /* Prefer numeric win signal if winPresentation publishes one. */
  if (typeof window !== 'undefined' && Number.isFinite(window.__LAST_SPIN_WIN__) && window.__LAST_SPIN_WIN__ > 0) return true;
  const host = typeof document !== 'undefined' ? document.getElementById('gridHost') : null;
  if (host && host.querySelector('.cell--winsym, .cell--win, .is-winning, .win-line-active, .payline-active')) return true;
  /* Win-line overlay (paylineOverlay block) creates SVG paths with class .payline-line.active. */
  if (typeof document !== 'undefined' && document.querySelector('.payline-line.active, .payline-segment.active')) return true;
  return false;
}

/* UQ-DEEP-Q B3 fix: FSM phase check unified sa sister blocks
 *   (expandingWildMultiplier, fsExpansionWilds) — use regex /^FS_/ tako da
 *   FS_INTRO / FS_SPIN / FS_OUTRO / FS_RETRIGGER svi pucaju. Pre: samo
 *   exact 'FS_ACTIVE' match → expansion u 1/4 FS sub-phaza.
 * UQ-DEEP-Q also: read FSM via window.FSM (safer in browser sandbox). */
function _expWildPhaseAllowed() {
  let ph = null;
  if (typeof window !== 'undefined' && window.FSM) ph = window.FSM.phase || window.FSM.state || null;
  else if (typeof FSM !== 'undefined' && FSM) ph = FSM.phase;
  /* No FSM available: default to allow except pure 'fs' mode. */
  if (!ph) return EXPANDING_WILD_MODE !== 'fs';
  if (EXPANDING_WILD_MODE === 'fs')   return /^FS_/.test(ph);
  if (EXPANDING_WILD_MODE === 'base') return ph === 'BASE' || ph === 'IDLE' || ph === 'SPIN';
  /* both */ return true;
}

/* UQ-DEEP-Q B4 fix: H&W gate — sister blocks (expandingWildMultiplier L420,
 * fsExpansionWilds L284) gate-uju kad je Hold & Win round active. Ovaj blok
 * je bio outlier. Industry convention (BGaming/Pragmatic mechanics doc):
 * locked-symbol layer takes priority over reel-paint layers. */
function _expWildHwActive() {
  if (typeof window === 'undefined') return false;
  if (window.HW_STATE && window.HW_STATE.active === true) return true;
  if (window.__HW_ACTIVE__ === true) return true;
  return false;
}

function applyExpandingWilds(spinPayload) {
  /* UQ-DEEP-Q B5 anti-recursion: if onSpinResult was re-fired by us
   * (reEval marker), don't expand again — that would infinite-loop. */
  if (spinPayload && spinPayload.reEval === true && spinPayload.source === 'expandingWild') return [];
  /* UQ-MULTIPLIER-FIX (Boki 2026-06-22 — "wild expansion ... ne radi pravilno
   * niti priblizno"). Force chip click bypasses phase guard. */
  const _isForcedExpand = (typeof window !== 'undefined' &&
                          window.__FORCE_FEATURE_PENDING__ === 'expanding_wild');
  /* UQ-DEEP-Q B4 fix: Hold & Win takes priority — column-paint layers
   * must defer dok H&W round nije gotov (locked-symbol layer owns cells). */
  if (!_isForcedExpand && _expWildHwActive()) return [];
  if (!_isForcedExpand && !_expWildPhaseAllowed()) return [];
  /* RENDER-INTEG-A (2026-06-23) — GDD only_if_winning gate. */
  if (!_expWildOnlyIfWinningPassed()) return [];
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = Number.isInteger(window.REELS) ? window.REELS : EXPANDING_WILD_FALLBACK_REELS;
  const ROWS  = Number.isInteger(window.ROWS)  ? window.ROWS  : EXPANDING_WILD_FALLBACK_ROWS;
  const cells = host.querySelectorAll('.cell');
  /* WAVE U1 force-guard (Boki 2026-06-20): if UFP chip set PENDING ===
     'expanding_wild', GUARANTEE at least one wild seed lands so the
     expansion has a column to grow from. Without this guard, force on a
     no-win spin produced zero wilds → user perceived "force ne radi". */
  try {
    if (window.__FORCE_FEATURE_PENDING__ === 'expanding_wild' && cells.length) {
      /* UQ-DEEP-K: force-seed must land u ALLOWED reel ako GDD declarira
       * appliesOnReels (npr. [2,3,4,5] — reel 1 = col 0 je izuzet kod
       * vendor-neutral spec-ova). Pick first allowed col (default mid). */
      let _seedCol = Math.floor(REELS / 2);
      if (EXPANDING_WILD_APPLIES_ON_REELS) {
        if (!EXPANDING_WILD_APPLIES_ON_REELS.has(_seedCol)) {
          const _firstAllowed = [...EXPANDING_WILD_APPLIES_ON_REELS].sort((a, b) => a - b).find((c) => c < REELS);
          if (_firstAllowed != null) _seedCol = _firstAllowed;
        }
      }
      const _seedRow = Math.floor(ROWS / 2);
      const _seedIdx = _seedRow * REELS + _seedCol;
      const _seedCell = cells[_seedIdx];
      if (_seedCell) {
        if (_seedCell.dataset.origSym == null) _seedCell.dataset.origSym = (_seedCell.textContent || '').trim();
        _seedCell.textContent = EXPANDING_WILD_SYMBOL;
      }
      window.__FORCE_FEATURE_PENDING__ = null;
    }
  } catch (_) {}
  /* Detect which columns have any wild.
   * UQ-DEEP-K: honor GDD appliesOnReels restriction. Industry spec
   * "wild substitutes reels 2-5 only in base game" — column 0 mora
   * da bude izuzet jer pattern win zavisi od cleane reel 1.
   * Filtriramo i wild detection (skip excluded cols) i force-seed
   * pozicioniranje (seed mora pasti unutar allowed kolona). */
  const colsWithWild = new Set();
  cells.forEach((cell, idx) => {
    const col = idx % REELS;
    if (EXPANDING_WILD_APPLIES_ON_REELS && !EXPANDING_WILD_APPLIES_ON_REELS.has(col)) return;
    const sym = (cell.textContent || '').trim();
    if (sym === EXPANDING_WILD_SYMBOL) {
      colsWithWild.add(col);
    }
  });
  /* Expand: 3-stage industry-grade animation per reference lock-respin GDD GDD §13.3.
   * Stage 1 (anticipation 180ms): glow flash na seed cell-u per kolone.
   * Stage 2 (expand 350ms, top→bottom 60ms stagger): lava column flood.
   * Stage 3 (hold 1200ms loop): subtle pulse while wild active.
   * UQ-DEEP-X (Boki 2026-06-24): pre fix-a samo single-keyframe scale;
   * sad pun 3-stage timeline + per-stage HookBus events za audio sync. */
  const STAGE1_MS = 180;
  const STAGE2_ROW_STAGGER_MS = 60;
  const STAGE2_MS = 350;
  const expanded = [];
  /* Detect prefers-reduced-motion: skip stages 1 + 3 entirely, jump
   * Stage 2 to final frame instantly. */
  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || false;
  colsWithWild.forEach((col) => {
    /* Find the seed cell (the one that actually had wild on the grid) for
     * Stage 1 anticipation. Falls back to middle row if multiple. */
    let seedRow = Math.floor(ROWS / 2);
    for (let r = 0; r < ROWS; r++) {
      const idx = r * REELS + col;
      const cell = cells[idx];
      if (cell && (cell.textContent || '').trim() === EXPANDING_WILD_SYMBOL) {
        seedRow = r; break;
      }
    }
    const seedCell = cells[seedRow * REELS + col];
    /* Stage 1: anticipation glow on seed cell. */
    if (seedCell && !reducedMotion) {
      seedCell.classList.add('is-wild-anticipation');
      try { HookBus.emit && (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('expandingWild:stage1:anticipation', { col, row: seedRow }) : void 0); } catch (_) {}
      /* Remove anticipation class after Stage 1 to allow Stage 2 paint. */
      setTimeout(() => { try { seedCell.classList.remove('is-wild-anticipation'); } catch (_) {} }, STAGE1_MS);
    }
    /* Stage 2: schedule per-row fill sa stagger. */
    const stage2Start = reducedMotion ? 0 : STAGE1_MS;
    for (let r = 0; r < ROWS; r++) {
      const idx = r * REELS + col;
      const cell = cells[idx];
      if (!cell) continue;
      if (cell.dataset.origSym == null) cell.dataset.origSym = (cell.textContent || '').trim();
      cell.setAttribute('aria-live', 'polite');
      cell.setAttribute('aria-label', 'Expanding wild on reel ' + (col + 1));
      cell.textContent = EXPANDING_WILD_SYMBOL;
      /* P6 fix (UQ-DEEP-R): data-symbol + GRID + symbolOverride. */
      cell.setAttribute('data-symbol', EXPANDING_WILD_SYMBOL);
      if (window.GRID && typeof window.GRID.set === 'function') {
        try { window.GRID.set(col, r, EXPANDING_WILD_SYMBOL); } catch (_) {}
      }
      try { HookBus.emit && (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('symbolOverride', { r, c: col, sym: EXPANDING_WILD_SYMBOL, source: 'expandingWild' }) : void 0); } catch (_) {}
      /* Legacy class persistent (back-compat). */
      cell.classList.add('is-expanded-wild');
      if (reducedMotion) {
        /* Skip stagger — class hop direct to hold state. */
        cell.classList.add('is-wild-hold');
      } else {
        /* CSS animation-delay via inline style (cell-row specific). */
        const rowDelay = r * STAGE2_ROW_STAGGER_MS;
        cell.style.setProperty('--ew-row-delay', rowDelay + 'ms');
        cell.classList.add('is-wild-expanding');
        /* Per-row settle event at stage2Start + STAGE1 + rowDelay (audio sync). */
        setTimeout(() => {
          try { HookBus.emit && (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('expandingWild:stage2:rowSettle', { col, row: r }) : void 0); } catch (_) {}
        }, stage2Start + rowDelay + STAGE2_MS);
        /* Transition to Stage 3 hold pulse after Stage 2 complete + final stagger. */
        setTimeout(() => {
          try {
            cell.classList.remove('is-wild-expanding');
            cell.classList.add('is-wild-hold');
            cell.style.removeProperty('--ew-row-delay');
          } catch (_) {}
        }, stage2Start + rowDelay + STAGE2_MS + 30);
      }
      expanded.push({ r, c: col });
    }
    /* Stage 2 start emit. */
    if (!reducedMotion) {
      setTimeout(() => {
        try { HookBus.emit && (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('expandingWild:stage2:expandStart', { col, direction: 'top-down', rows: ROWS }) : void 0); } catch (_) {}
      }, stage2Start);
      /* Stage 2 complete (last row + STAGE2_MS) + Stage 3 pulse start. */
      const stage2Total = stage2Start + (ROWS - 1) * STAGE2_ROW_STAGGER_MS + STAGE2_MS;
      setTimeout(() => {
        try { HookBus.emit && (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('expandingWild:stage2:expandComplete', { col }) : void 0); } catch (_) {}
        try { HookBus.emit && HookBus.emit('expandingWild:stage3:pulseStart', { col }); } catch (_) {}
      }, stage2Total);
    }
  });
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('expandingWild:applied', { expanded, mode: EXPANDING_WILD_MODE, stages: 3 });
    /* UQ-DEEP-Q B5 (CRIT) fix — Boki "ne radi pravilno" root cause:
     * After mutating cells to wild symbol, the win evaluator (which ran
     * BEFORE expansion at priority 0) has NOT re-evaluated the grid →
     * expanded wilds visually present but payout reflects pre-expansion
     * line wins → operator sees expansion animation but no extra credit.
     * Industry rule ([reference-slot] GDD step 5→6→7): "Re-evaluate all 20
     * lines with expanded Wilds in place; pay the recomputed result".
     *
     * Fix: emit canonical 're-eval' signal that downstream pay layers
     * subscribe to. Three channels for max compat with diverse evaluators:
     *  1. window.__LAST_SPIN_GRID_MUTATED__ flag (sync read by next eval)
     *  2. HookBus 'onReelsMutated' event (clean subscribe channel)
     *  3. Re-fire 'onSpinResult' with reEval:true marker so existing
     *     win-calc listeners pick it up without code changes
     * Idempotency: reEval:true marker prevents infinite loop (block
     * itself ignores reEval-marked onSpinResult). */
    if (expanded.length > 0) {
      if (typeof window !== 'undefined') {
        window.__LAST_SPIN_GRID_MUTATED__ = { source: 'expandingWild', count: expanded.length, ts: Date.now() };
      }
      try {
        (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onReelsMutated', {
          source: 'expandingWild',
          expanded,
          wildSymbolId: EXPANDING_WILD_SYMBOL,
        }) : void 0);
      } catch (_) {}
      /* Re-fire onSpinResult sa reEval marker — win-calc listeners
       * koji se vežu samo na onSpinResult će sad reskenirati grid sa
       * expanded wildovima i nadoknaditi missing pay. */
      try {
        (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function' ? HookBus.emit('onSpinResult', { duringFs: false, reEval: true, source: 'expandingWild' }) : void 0);
      } catch (_) {}
    }
  }
  return expanded;
}

function clearExpandingWilds() {
  const host = document.getElementById('gridHost');
  if (!host) return;
  /* UQ-DEEP-X Stage 4: fade-out animation pre uklanjanja class-ova.
   * 150ms cubic-bezier ease-in. Cell vraća origSym posle fade-out-a. */
  const STAGE4_MS = 150;
  const targets = host.querySelectorAll('.cell.is-expanded-wild, .cell.is-wild-hold, .cell.is-wild-expanding, .cell.is-wild-anticipation');
  const reducedMotion = (typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches) || false;
  targets.forEach(c => {
    if (reducedMotion) {
      /* Immediate restore. */
      if (c.dataset.origSym != null) { c.textContent = c.dataset.origSym; delete c.dataset.origSym; }
      c.removeAttribute('data-symbol');
      c.removeAttribute('aria-live');
      c.removeAttribute('aria-label');
      c.style.removeProperty('--ew-row-delay');
      c.classList.remove('is-expanded-wild', 'is-wild-hold', 'is-wild-expanding', 'is-wild-anticipation', 'is-wild-clearing');
    } else {
      /* Stage 4 fade-out then strip class-ove. */
      c.classList.remove('is-wild-hold', 'is-wild-expanding', 'is-wild-anticipation');
      c.classList.add('is-wild-clearing');
      setTimeout(() => {
        try {
          if (c.dataset.origSym != null) { c.textContent = c.dataset.origSym; delete c.dataset.origSym; }
          c.removeAttribute('data-symbol');
          c.removeAttribute('aria-live');
          c.removeAttribute('aria-label');
          c.style.removeProperty('--ew-row-delay');
          c.classList.remove('is-expanded-wild', 'is-wild-clearing');
        } catch (_) {}
      }, STAGE4_MS);
    }
  });
  if (typeof HookBus !== 'undefined') {
    HookBus.emit('expandingWild:cleared', { count: targets.length });
  }
}

if (typeof window !== 'undefined') {
  window.applyExpandingWilds = applyExpandingWilds;
  window.clearExpandingWilds = clearExpandingWilds;
}

/* HookBus wire-up — expanding wild fires AFTER reels settle.
   Idempotency guard prevents duplicate handlers from HMR / double-emit / test reload. */
/* WASH PASS (2026-06-18) — sentinel renamed from camelCase
 * __expandingWildBound to UPPER_SNAKE __EXPANDING_WILD_WIRED__ for
 * consistency with every other LEGO block's wired-once naming. */
if (typeof HookBus !== 'undefined' && typeof window !== 'undefined' && !window.__EXPANDING_WILD_WIRED__) {
  window.__EXPANDING_WILD_WIRED__ = true;
  /* UQ-DEEP-J fix: explicit priority 10 ensures expandingWild fires
   * AFTER default-priority win evaluator (priority 0) and BEFORE
   * wildCollisionMultiplier (priority 22). Order:
   *   0 (eval) → 10 (expandingWild) → 22 (wildCollisionMult)
   * This way collision mult sees expanded cells in correct state and
   * only_if_winning gate reads finalized __LAST_SPIN_WIN__. */
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onSpinResult', (p) => { applyExpandingWilds(p); }, { priority: 10 }) : void 0);
  HookBus.on('preSpin', () => {
    clearExpandingWilds();
    /* UQ-DEEP-Q B5: clear stale mutation flag on every preSpin so the
     * downstream layers don't treat fresh spin as re-eval. */
    if (typeof window !== 'undefined') window.__LAST_SPIN_GRID_MUTATED__ = null;
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', () => { clearExpandingWilds(); }) : void 0);
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
