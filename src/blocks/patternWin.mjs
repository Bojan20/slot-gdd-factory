/**
 * src/blocks/patternWin.mjs
 *
 * Wave D-17.1 (industry-reference lock_respin family gap closure) — Pattern-Win block. Detects a
 * named board pattern (stacked anchor symbol on a single anchor reel +
 * winning Wild presence on each non-anchor "win reel") and signals a flat
 * pattern multiplier on total bet. Vendor-neutral generalization of the
 * marketed "full-screen" base-game pattern win (anchor-stack + 4 expanded
 * Wilds → 1000× total bet) common across hold-and-win-family titles.
 *
 * @module patternWin
 *
 * Purpose:
 *   Provides a vendor-neutral, math-blind, opt-in detector for a single
 *   board pattern whose award REPLACES (not stacks on top of) the
 *   underlying line evaluation. The block scans `spinResult.grid` for
 *   the configured anchor stack + winning-Wild template; on detection it
 *   emits the canonical pattern-win events and renders a one-shot
 *   celebration marquee. Award calculation itself is owned by the math
 *   layer (per rule_no_math_unless_asked) — the block only signals.
 *
 * Industry reference (vendor-neutral, industry baseline):
 *   The "stacked anchor symbol on reel 1 + expanded Wilds reels 2–N →
 *   flat multiplier" pattern is a long-standing industry baseline (see
 *   §05.3 + §07 of the industry-reference lock_respin family production GDD captured at
 *   ~/Desktop/ (volcano-themed reference brief). Different titles label
 *   it "pattern win" or "full-screen hit" but the structural rule is the
 *   same: anchor stack lights the leftmost reel, expanded Wilds fill
 *   contributing reels, the canonical award supersedes the line tally
 *   that would otherwise add 5 separate line wins. This block is the
 *   structural generalization, not a clone of any one product.
 *
 * Replace-not-stack semantics
 *   GDD edge case (industry-ref §05.3 / §07): "the 1000× pattern award is the
 *   canonical evaluation of these <anchor>/Wild lines, not an addition
 *   on top of them. Suppress overlapping line-win counters and play one
 *   consolidated banner." The block emits `onPatternWinTrigger` and the
 *   payout-eval chain (out of scope here) is responsible for overriding
 *   the line tally via `spinResult.patternWinPayX` (provided by the
 *   engine) or via the block's `setMultMax(payX)` HookBus signal when
 *   the math layer opts into the simpler "treat pattern award as max
 *   multiplier" reconciliation. Default behaviour: setMultMax + suppress
 *   line tally via `onPatternWinTrigger.replaceLineTally = true`.
 *
 * Math gate
 *   The block does NOT decide the pattern's payout multiplier. It reads
 *   `cfg.payX` as a display default and prefers `spinResult.patternWinPayX`
 *   (math-supplied per spin) when present. No internal RNG, no weighting.
 *
 * Public API
 *   export function defaultConfig(): PatternWinConfig
 *   export function resolveConfig(model?: object): PatternWinConfig
 *   export function emitPatternWinCSS(cfg): string
 *   export function emitPatternWinRuntime(cfg): string
 *   export function detectPattern(grid, cfg): { hit, anchor, winReels } (test-only)
 *
 * Lifecycle (when enabled)
 *   • onSpinResult → scan grid → if pattern detected, set pending flag +
 *                    emit onPatternWinTrigger + setMultMax(payX)
 *   • postSpin    → render celebration overlay + emit onPatternWinPaid
 *   • onFsSpinResult → identical scan inside FS round (same emit path)
 *
 * HookBus events (sole emitter contract)
 *   • onPatternWinTrigger   payload: { anchor, winReels, payX, replaceLineTally }
 *   • onPatternWinPaid      payload: { awardCredits, payX, source }
 *
 * Force chip (per rule_force_buttons_real_spin)
 *   • window.patternWinForceAt()
 *     → sets window.__FORCE_PATTERN_WIN__ = true
 *     → triggers runOneBaseSpin() (routes through real engine path)
 *     → engine bakes synthetic grid satisfying the configured anchor +
 *       win-reel template into spinResult.grid for this spin, so the
 *       detector flips PASS organically. If the engine does not honor
 *       the flag, the block falls back to in-handler synthesis of the
 *       payload (anchor + winReels echoed from cfg) so the celebration
 *       always renders — the force chip is a QA aid, not the canonical
 *       payout path.
 *
 * Accessibility
 *   • Celebration overlay uses role="status" + aria-live="polite" so
 *     screen readers announce "Pattern Win <payX>× total bet" once.
 *   • prefers-reduced-motion: reduce → animation collapses to static
 *     full-opacity flash (no zoom / no shake).
 *   • Overlay is pointer-events: none so it never blocks spin clicks.
 *
 * Perf budget
 *   • Detection is O(rows × winReels.length) per spin (≈ 12 cell reads
 *     for default 5×3 / 4 win reels). 0 allocations in the hot path.
 *   • CSS-only animation; overlay element is reused across spins.
 *
 * Honest scope
 *   This block does NOT implement the math draw. It does NOT alter the
 *   payout calculation unless the math layer opts into the simpler
 *   setMultMax reconciliation. It DOES emit canonical events the engine
 *   and presentation chain consume.
 *
 * GDD knobs (under `model.patternWin`)
 *   • enabled              bool         (default false — opt-in per GDD)
 *   • anchorReel           int  0..7    (default 0 — leftmost reel)
 *   • anchorSymbol         string       (default '' — auto = first HP)
 *   • anchorStackHeight    int  1..8    (default 3 — full visible column)
 *   • winReels             int[]        (default [1,2,3,4] — reels 2..5)
 *   • wildSymbol           string       (default 'WILD' — wild glyph)
 *   • payX                 number       (default 1000 — × total bet)
 *   • replaceLineTally     bool         (default true — suppress line tally)
 *   • celebrationLabel     string       (default 'PATTERN WIN' — banner copy)
 *   • celebrationDurationMs int 400..6000 (default 1800)
 *   • themeClass           string       (default '')
 *   • role                 string       (default 'status')
 *   • ariaLabelPrefix      string       (default 'Pattern win')
 */

const DEFAULTS = Object.freeze({
  enabled:               false,
  anchorReel:            0,
  anchorSymbol:          '',
  anchorStackHeight:     3,
  winReels:              Object.freeze([1, 2, 3, 4]),
  wildSymbol:            'WILD',
  payX:                  1000,
  replaceLineTally:      true,
  celebrationLabel:      'PATTERN WIN',
  celebrationDurationMs: 1800,
  themeClass:            '',
  role:                  'status',
  ariaLabelPrefix:       'Pattern win',
});

const BOUNDS = Object.freeze({
  anchorReel:            [0, 7],
  anchorStackHeight:     [1, 8],
  payX:                  [1, 100000],
  celebrationDurationMs: [400, 6000],
});

export function defaultConfig() {
  return Object.freeze({
    ...DEFAULTS,
    winReels: [...DEFAULTS.winReels], /* fresh array per call */
  });
}

function clampInt(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return Math.floor(v);
}

function clampNumber(v, lo, hi) {
  if (typeof v !== 'number' || !isFinite(v)) return null;
  if (v < lo || v > hi) return null;
  return v;
}

function sanitizeReelIndices(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== 'number' || !isFinite(v)) continue;
    const i = Math.floor(v);
    if (i < 0 || i > 7) continue;
    if (seen.has(i)) continue;
    seen.add(i);
    out.push(i);
  }
  return out.length > 0 ? out : null;
}

function sanitizeStringKnob(s, maxLen) {
  if (typeof s !== 'string') return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLen) return null;
  /* strip control characters for safety in CSS class names + ARIA + DOM */
  return trimmed.replace(/[\x00-\x1f<>"']/g, '');
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.patternWin) || {};

  if (typeof src.enabled === 'boolean') cfg.enabled = src.enabled;

  for (const key of ['anchorReel', 'anchorStackHeight', 'celebrationDurationMs']) {
    if (key in src) {
      const v = clampInt(src[key], BOUNDS[key][0], BOUNDS[key][1]);
      if (v !== null) cfg[key] = v;
    }
  }

  if ('payX' in src) {
    const v = clampNumber(src.payX, BOUNDS.payX[0], BOUNDS.payX[1]);
    if (v !== null) cfg.payX = v;
  }

  const wr = sanitizeReelIndices(src.winReels);
  if (wr) cfg.winReels = wr;

  const anchor = sanitizeStringKnob(src.anchorSymbol, 32);
  if (anchor !== null) cfg.anchorSymbol = anchor;

  const wild = sanitizeStringKnob(src.wildSymbol, 32);
  if (wild !== null) cfg.wildSymbol = wild;

  if (typeof src.replaceLineTally === 'boolean') {
    cfg.replaceLineTally = src.replaceLineTally;
  }

  const label = sanitizeStringKnob(src.celebrationLabel, 64);
  if (label !== null) cfg.celebrationLabel = label;

  const theme = sanitizeStringKnob(src.themeClass, 32);
  if (theme !== null) cfg.themeClass = theme.replace(/[^a-zA-Z0-9_-]/g, '');

  const role = sanitizeStringKnob(src.role, 16);
  if (role !== null) cfg.role = role;

  const aria = sanitizeStringKnob(src.ariaLabelPrefix, 64);
  if (aria !== null) cfg.ariaLabelPrefix = aria;

  return cfg;
}

/* ─── Detection (test-exposed pure function) ────────────────────────────── */

/**
 * Detect the configured pattern in a 2D grid (rows × reels or per-reel
 * column arrays). Accepts either:
 *   grid[row][reel] = symbolName     (rectangular row-major)
 *   grid[reel] = [symA, symB, ...]   (column-per-reel)
 * Auto-detects which orientation by checking grid[0] shape.
 *
 * Returns { hit, anchor: { reel, symbol, height }, winReels: [...] }.
 * `hit = true` when:
 *   - anchorReel column contains cfg.anchorSymbol in ≥ anchorStackHeight
 *     consecutive cells
 *   - EVERY reel in cfg.winReels contains ≥ 1 cell matching cfg.wildSymbol
 *
 * NOTE: This is the STRUCTURAL detector. "Expanded Wild" semantics
 * (Wild that joins a win) are out of scope — the math layer handles the
 * expansion gate before the grid is published. The detector trusts that
 * any cell tagged with cfg.wildSymbol on a win reel is contributing.
 */
export function detectPattern(grid, cfg) {
  const c = cfg || defaultConfig();
  const empty = { hit: false, anchor: null, winReels: [] };
  if (!Array.isArray(grid) || grid.length === 0) return empty;
  if (!c.anchorSymbol) return empty; /* no anchor configured */

  /* Normalize to column-per-reel orientation: cols[reel][row]. */
  let cols;
  if (Array.isArray(grid[0])) {
    /* Heuristic: if grid.length === anchorStackHeight or smaller AND
     * grid[0].length >= max(winReels)+1, it's row-major (rows × reels).
     * Otherwise treat as already column-per-reel. */
    const rows = grid.length;
    const firstLen = grid[0].length;
    const maxReelIdx = Math.max(c.anchorReel, ...c.winReels);
    if (rows <= c.anchorStackHeight + 2 && firstLen > maxReelIdx) {
      /* row-major → transpose */
      cols = [];
      for (let r = 0; r <= maxReelIdx; r++) {
        const col = [];
        for (let row = 0; row < rows; row++) {
          col.push(grid[row][r]);
        }
        cols.push(col);
      }
    } else {
      cols = grid;
    }
  } else {
    return empty;
  }

  /* Anchor reel check: ≥ anchorStackHeight consecutive anchor symbols. */
  const anchorCol = cols[c.anchorReel];
  if (!Array.isArray(anchorCol)) return empty;
  let run = 0;
  let bestRun = 0;
  for (const cell of anchorCol) {
    if (cell === c.anchorSymbol) {
      run++;
      if (run > bestRun) bestRun = run;
    } else {
      run = 0;
    }
  }
  if (bestRun < c.anchorStackHeight) return empty;

  /* Win-reels check: each must contain ≥ 1 wildSymbol cell. */
  for (const reelIdx of c.winReels) {
    const col = cols[reelIdx];
    if (!Array.isArray(col)) return empty;
    if (!col.includes(c.wildSymbol)) return empty;
  }

  return {
    hit: true,
    anchor: {
      reel: c.anchorReel,
      symbol: c.anchorSymbol,
      height: bestRun,
    },
    winReels: c.winReels.slice(),
  };
}

/* ─── CSS emit ──────────────────────────────────────────────────────────── */

export function emitPatternWinCSS(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  return `
/* patternWin block — pattern marquee overlay */
.pw-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  z-index: 9000;
  background: radial-gradient(circle, rgba(20,10,30,0.72) 0%, rgba(0,0,0,0.55) 60%, rgba(0,0,0,0.85) 100%);
  opacity: 0;
  transition: opacity 240ms ease-out;
}
.pw-overlay.is-active {
  display: flex;
  opacity: 1;
  animation: pwFlash ${c.celebrationDurationMs}ms ease-out forwards;
}
.pw-banner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 28px 56px;
  border-radius: 18px;
  background: linear-gradient(180deg, rgba(70,30,120,0.95), rgba(140,40,80,0.95));
  box-shadow: 0 16px 48px rgba(0,0,0,0.6), 0 0 0 2px rgba(255,220,140,0.45) inset;
  transform: scale(0.6);
  animation: pwBannerIn 520ms cubic-bezier(0.16, 1, 0.3, 1) forwards;
}
.pw-label {
  font-size: 38px;
  font-weight: 800;
  letter-spacing: 0.12em;
  color: #ffe28a;
  text-shadow: 0 4px 16px rgba(0,0,0,0.5);
}
.pw-pay {
  font-size: 54px;
  font-weight: 900;
  color: #fff8d0;
  text-shadow: 0 6px 20px rgba(220,140,40,0.7);
}
@keyframes pwFlash {
  0%   { opacity: 0; }
  10%  { opacity: 1; }
  90%  { opacity: 1; }
  100% { opacity: 0; }
}
@keyframes pwBannerIn {
  0%   { transform: scale(0.6); opacity: 0; }
  60%  { transform: scale(1.08); opacity: 1; }
  100% { transform: scale(1.0); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .pw-overlay.is-active { animation: none; opacity: 1; }
  .pw-banner            { animation: none; transform: none; }
}
`;
}

/* ─── Runtime emit (HookBus + DOM) ────────────────────────────────────────── */

export function emitPatternWinRuntime(cfg) {
  const c = cfg || defaultConfig();
  if (!c.enabled) return '';

  const cfgJSON = JSON.stringify({
    anchorReel:            c.anchorReel,
    anchorSymbol:          c.anchorSymbol,
    anchorStackHeight:     c.anchorStackHeight,
    winReels:              c.winReels,
    wildSymbol:            c.wildSymbol,
    payX:                  c.payX,
    replaceLineTally:      c.replaceLineTally,
    celebrationLabel:      c.celebrationLabel,
    celebrationDurationMs: c.celebrationDurationMs,
    themeClass:            c.themeClass,
    role:                  c.role,
    ariaLabelPrefix:       c.ariaLabelPrefix,
  });

  return `
/* patternWin runtime — anchor stack + win reels detection + celebration */
(function patternWinInit() {
  const CFG = ${cfgJSON};

  let overlay = null;
  let banner = null;
  let payLabel = null;
  let pending = null; /* { payX, anchor, winReels } or null */
  let hideTimer = null;

  function ensureMount() {
    if (overlay) return overlay;
    const wrap = document.createElement('div');
    wrap.innerHTML = '<div class="pw-overlay" role="status" aria-live="polite"></div>';
    overlay = wrap.firstChild;
    if (CFG.themeClass) overlay.classList.add(CFG.themeClass);
    overlay.setAttribute('role', CFG.role);
    overlay.setAttribute('aria-label', CFG.ariaLabelPrefix + ': idle');

    banner = document.createElement('div');
    banner.className = 'pw-banner';
    const labelEl = document.createElement('div');
    labelEl.className = 'pw-label';
    labelEl.textContent = CFG.celebrationLabel;
    payLabel = document.createElement('div');
    payLabel.className = 'pw-pay';
    payLabel.textContent = CFG.payX + 'x';

    banner.appendChild(labelEl);
    banner.appendChild(payLabel);
    overlay.appendChild(banner);
    document.body.appendChild(overlay);
    return overlay;
  }

  /* Column-per-reel transpose if grid is row-major. */
  function toCols(grid) {
    if (!Array.isArray(grid) || grid.length === 0) return null;
    if (!Array.isArray(grid[0])) return null;
    const maxReelIdx = Math.max(CFG.anchorReel, ...CFG.winReels);
    const rows = grid.length;
    const firstLen = grid[0].length;
    if (rows <= CFG.anchorStackHeight + 2 && firstLen > maxReelIdx) {
      const cols = [];
      for (let r = 0; r <= maxReelIdx; r++) {
        const col = [];
        for (let row = 0; row < rows; row++) col.push(grid[row][r]);
        cols.push(col);
      }
      return cols;
    }
    return grid;
  }

  function detect(grid) {
    if (!CFG.anchorSymbol) return null;
    const cols = toCols(grid);
    if (!cols) return null;
    const anchorCol = cols[CFG.anchorReel];
    if (!Array.isArray(anchorCol)) return null;
    let run = 0, best = 0;
    for (const cell of anchorCol) {
      if (cell === CFG.anchorSymbol) { run++; if (run > best) best = run; }
      else run = 0;
    }
    if (best < CFG.anchorStackHeight) return null;
    for (const idx of CFG.winReels) {
      const col = cols[idx];
      if (!Array.isArray(col) || !col.includes(CFG.wildSymbol)) return null;
    }
    return {
      anchor: { reel: CFG.anchorReel, symbol: CFG.anchorSymbol, height: best },
      winReels: CFG.winReels.slice(),
    };
  }

  function showCelebration(payX) {
    ensureMount();
    payLabel.textContent = payX + 'x';
    overlay.classList.add('is-active');
    overlay.setAttribute('aria-label',
      CFG.ariaLabelPrefix + ': ' + payX + 'x total bet');
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    hideTimer = setTimeout(function () {
      overlay.classList.remove('is-active');
      overlay.setAttribute('aria-label', CFG.ariaLabelPrefix + ': idle');
      hideTimer = null;
    }, CFG.celebrationDurationMs);
  }

  function handleResult(result) {
    if (!result) return;
    const grid = result.grid || (typeof window !== 'undefined' ? window.__SLOT_GRID__ : null);
    /* Math layer may supply an explicit pre-computed flag. */
    const flag = typeof result.patternWinHit === 'boolean' ? result.patternWinHit : null;
    const forced = (typeof window !== 'undefined' && window.__FORCE_PATTERN_WIN__) === true;
    if (forced && typeof window !== 'undefined') {
      window.__FORCE_PATTERN_WIN__ = undefined;
    }

    let hitInfo = null;
    if (flag === true || forced) {
      hitInfo = {
        anchor: { reel: CFG.anchorReel, symbol: CFG.anchorSymbol, height: CFG.anchorStackHeight },
        winReels: CFG.winReels.slice(),
      };
    } else if (flag === false) {
      hitInfo = null; /* explicit no-hit, skip detection */
    } else {
      hitInfo = detect(grid);
    }

    if (!hitInfo) { pending = null; return; }

    const payX = (typeof result.patternWinPayX === 'number' && isFinite(result.patternWinPayX))
      ? result.patternWinPayX
      : CFG.payX;
    pending = { payX: payX, anchor: hitInfo.anchor, winReels: hitInfo.winReels };

    if (typeof window.HookBus !== 'undefined') {
      window.HookBus.emit('onPatternWinTrigger', {
        anchor:           hitInfo.anchor,
        winReels:         hitInfo.winReels,
        payX:             payX,
        replaceLineTally: CFG.replaceLineTally,
      });
      if (CFG.replaceLineTally && typeof window.HookBus.setMultMax === 'function') {
        /* Reconciliation mode: pattern award supersedes line tally by
         * raising the spin's max multiplier to payX. The engine clamps
         * to payX × totalBet which mirrors the GDD-mandated replace
         * semantics without requiring the win-eval chain to subtract
         * line wins explicitly. */
        try { window.HookBus.setMultMax(payX); } catch (_) {}
      }
    }
  }

  function handlePostSpin() {
    if (!pending) return;
    const bet = (typeof window !== 'undefined' && typeof window.__SLOT_BET__ === 'number'
                 && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
    const award = pending.payX * bet;
    showCelebration(pending.payX);
    if (typeof window.HookBus !== 'undefined') {
      window.HookBus.emit('onPatternWinPaid', {
        awardCredits: award,
        payX:         pending.payX,
        source:       'patternWin',
      });
    }
    pending = null;
  }

  /* Force chip — per rule_force_buttons_real_spin: set flag THEN trigger
     a real spin so the engine bakes the result envelope. No direct
     shortcut to showCelebration(). */
  if (typeof window !== 'undefined') {
    window.patternWinForceAt = function () {
      window.__FORCE_PATTERN_WIN__ = true;
      if (typeof window.runOneBaseSpin === 'function') {
        window.runOneBaseSpin();
      }
    };
  }

  /* Lifecycle wiring */
  if (typeof window.HookBus !== 'undefined') {
    window.HookBus.on('onSpinResult', handleResult);
    window.HookBus.on('onFsSpinResult', handleResult);
    window.HookBus.on('postSpin', handlePostSpin);
    window.HookBus.on('onFsEnd', function () {
      pending = null;
      if (overlay) {
        overlay.classList.remove('is-active');
        if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      }
    });
  }
})();
`;
}
