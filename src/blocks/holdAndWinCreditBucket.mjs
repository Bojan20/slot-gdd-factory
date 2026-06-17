/**
 * src/blocks/holdAndWinCreditBucket.mjs
 *
 * Wave H14 — Hold-and-Win Credit Bucket extension.
 *
 * Industry pattern (template-neutral, vendor-neutral):
 *
 *   The "Credit Bucket" / "Cash-On-Reels" pattern is the universal DNA of
 *   the modern hold-and-spin family of slots — bonus symbols that land on
 *   the grid carry a CREDIT VALUE displayed on the symbol face, and the
 *   round ends with a single payout equal to the SUM of every locked
 *   bucket. A small number of credit buckets are replaced with JACKPOT
 *   tags (MINI / MINOR / MAJOR / GRAND) whose value is a separate prize
 *   ladder unlocked when that bucket lands. When the whole grid fills
 *   (all cells locked), the highest jackpot tier auto-awards on top of
 *   the bucket sum.
 *
 *   This block EXTENDS the existing `holdAndWin.mjs` LEGO atom without
 *   modifying its source. Composition contract:
 *     • holdAndWin owns the lock-cell map, respin counter, HUD chrome
 *       (RESPINS / LOCKED tiles), and the on-grid bonus symbol harvest.
 *     • holdAndWinCreditBucket OBSERVES `window.HW_STATE.lockedCells`
 *       changes via the `postSpin`/`onSpinResult` lifecycle, assigns a
 *       credit value (or jackpot tag) to each newly locked cell using a
 *       weighted prize ladder, accumulates the running total, renders
 *       the value chip inside the cell, maintains a separate TOTAL chip
 *       in the HUD, and emits the dedicated HookBus events.
 *
 *   When this block is disabled (default), holdAndWin runs unchanged —
 *   purely additive.
 *
 * Lifecycle (HookBus contract):
 *
 *   postSpin → 1) if `window.HW_STATE.active === true`, snapshot the
 *                 current lockedCells size and diff against the previous
 *                 snapshot. For every NEW entry, draw a value from the
 *                 weighted prizeMap and bind it (cellKey → value).
 *              2) re-render every locked cell with its bound value chip
 *                 (jackpot tag rendered as TAG string, credit value
 *                 rendered as currency-formatted number).
 *              3) recompute total. If `HW_STATE.active` is FALSE on this
 *                 postSpin (round just ended), emit
 *                 `onCreditBucketEnd { total, jackpotTier, cells }` and
 *                 push `window.__WIN_AWARD__` so the win-presentation
 *                 pipeline picks the bucket payout up like a regular
 *                 round award. If all cells are locked, the highest
 *                 jackpot tier is added on top per industry rule.
 *   onSpinResult → re-apply value chips after each spin's DOM swap.
 *   onFsTrigger / onFsEnd → reset the credit bucket so FS round starts
 *                 with a clean slate.
 *
 *   Emitted events:
 *     onCreditBucketRespinStart { startingRespins }    (round enters)
 *     onCreditBucketLocked      { cell, amount, label, isJackpot }
 *     onCreditBucketEnd         { total, jackpotTier, cellCount, allLocked }
 *
 * GDD config (consumed from `model.holdAndWinCreditBucket`):
 *
 *   {
 *     enabled:          boolean (default false; auto-enables if any
 *                       feature kind matches /credit[_-]?bucket/i, OR
 *                       if `model.holdAndWin.enabled` is true AND
 *                       `model.holdAndWinCreditBucket.enabled` is undefined
 *                       and the prizeMap/jackpotMap below are populated.)
 *     prizeMap:         Array<{ x: number, weight: number }>
 *                       Credit values (in × bet) and their selection
 *                       weight. Defaults to a 7-tier industry-baseline
 *                       ladder centered on 1× with a long tail toward 25×.
 *     jackpotMap:       Array<{ label: string, x: number, weight: number }>
 *                       Jackpot tier ladder. Defaults to
 *                       [MINI 5×, MINOR 25×, MAJOR 100×, GRAND 1000×]
 *                       with weights skewed low (MINI common, GRAND rare).
 *     allLockedAward:   string | 'GRAND' | 'MAJOR'  (default 'GRAND')
 *                       Jackpot tier label awarded ON TOP when the player
 *                       locks every cell. The label MUST match one of
 *                       jackpotMap[i].label.
 *     bucketColor:      'r,g,b' (default '255,215,80' — warm gold)
 *     jackpotColor:     'r,g,b' (default '255,80,80' — alert red)
 *     currencyPrefix:   string (default '×') — what precedes the value.
 *                       'currency' uses balanceHud currency symbol.
 *     hudShowsTotal:    boolean (default true) — appends a 'TOTAL' chip
 *                       to holdAndWin HUD (created if missing).
 *   }
 *
 * Public API (server-side, ES module):
 *
 *   defaultConfig()                        → safe defaults
 *   resolveConfig(model)                   → merge defaults with GDD override
 *   emitHoldAndWinCreditBucketCSS(cfg)     → value-chip + jackpot-chip CSS
 *   emitHoldAndWinCreditBucketMarkup(cfg)  → empty (chips render dynamically)
 *   emitHoldAndWinCreditBucketRuntime(cfg) → runtime JS string
 *
 * Runtime contract (after emitted JS executes):
 *
 *   window.__HW_CREDIT_TOTAL__           current running total (×bet units)
 *   window.__HW_CREDIT_JACKPOT__         jackpot tier hit this round, or ''
 *   window.HW_CREDIT_STATE               { values:Map<key,{x,label,isJackpot}>,
 *                                          total, jackpotTier, prevSize }
 *   window.hwCreditReset()               clears state (used by preSpin guards)
 *
 * Composition contract:
 *
 *   - REQUIRES `holdAndWin` block to be enabled in the same model. The
 *     block early-exits at runtime if `window.HW_STATE` is missing.
 *   - DOES NOT modify holdAndWin source. Reads HW_STATE.lockedCells via
 *     diff snapshot on every postSpin. Writes the value chip into each
 *     `.cell.is-locked-bonus` node as a `<span class="hw-credit-chip">`
 *     child element — purely additive DOM.
 *   - When the round ends and `__WIN_AWARD__` is pushed, the existing
 *     winPresentation → bigWinTier chain takes over as for any other
 *     award. No special-case code needed downstream.
 *
 * Industry references (template-neutral):
 *
 *   • Hold-and-spin core DNA: weighted credit-value prize map + jackpot
 *     tier ladder + all-locked grand award. Widely standardized across
 *     studios (UKGC/MGA/NJDGE all certify this pattern unchanged).
 *   • Reset-on-collect respin engine: lives in holdAndWin.mjs already
 *     (`resetOnNewBonus` flag). This block consumes its outcome, doesn't
 *     reimplement it.
 *   • Audit-grade bucket-payout sum: total award = Σ (cell.x) + (jackpot
 *     hit ? jackpotMap[jackpot].x : 0). Single payout, single audit row.
 */

const DEFAULT_PRIZE_MAP = Object.freeze([
  { x: 1,  weight: 32 },
  { x: 2,  weight: 22 },
  { x: 3,  weight: 14 },
  { x: 5,  weight: 9  },
  { x: 10, weight: 5  },
  { x: 15, weight: 2  },
  { x: 25, weight: 1  },
]);

const DEFAULT_JACKPOT_MAP = Object.freeze([
  { label: 'MINI',  x: 5,    weight: 0.12 },
  { label: 'MINOR', x: 25,   weight: 0.04 },
  { label: 'MAJOR', x: 100,  weight: 0.01 },
  { label: 'GRAND', x: 1000, weight: 0.0025 },
]);

const HEX_RGB = /^(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5]),\s*(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5]),\s*(?:\d{1,2}|1\d{2}|2[0-4]\d|25[0-5])$/;
const SAFE_LABEL = /^[A-Z0-9_ -]{1,16}$/;

/* Fable audit (high): HEX_RGB only counts digits, so "999,215,80" would
 * pass syntactic check but is out of the 0..255 channel range. Validate
 * each channel as a proper RGB byte. */
function _isValidRgb(s) {
  if (typeof s !== 'string' || !HEX_RGB.test(s)) return false;
  const parts = s.split(',').map(p => parseInt(p.trim(), 10));
  return parts.length === 3 && parts.every(n => Number.isFinite(n) && n >= 0 && n <= 255);
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

/** Validate prizeMap entries — array of { x:number>0, weight:number>0 } */
function _validPrizeMap(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 24) return false;
  return arr.every(e =>
    e && typeof e === 'object'
    && Number.isFinite(e.x) && e.x > 0 && e.x <= 1e6
    && Number.isFinite(e.weight) && e.weight > 0 && e.weight <= 1e6
  );
}

/** Validate jackpotMap entries — array of { label:safe string, x>0, weight>0 } */
function _validJackpotMap(arr) {
  if (!Array.isArray(arr) || arr.length === 0 || arr.length > 8) return false;
  const seen = new Set();
  for (const e of arr) {
    if (!e || typeof e !== 'object') return false;
    if (typeof e.label !== 'string' || !SAFE_LABEL.test(e.label)) return false;
    if (seen.has(e.label)) return false;          /* labels must be unique */
    seen.add(e.label);
    if (!Number.isFinite(e.x) || e.x <= 0 || e.x > 1e9) return false;
    if (!Number.isFinite(e.weight) || e.weight <= 0 || e.weight > 1e6) return false;
  }
  return true;
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    prizeMap: DEFAULT_PRIZE_MAP.map(e => ({ ...e })),
    jackpotMap: DEFAULT_JACKPOT_MAP.map(e => ({ ...e })),
    allLockedAward: 'GRAND',
    bucketColor: '255,215,80',
    jackpotColor: '255,80,80',
    currencyPrefix: '×',
    hudShowsTotal: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.holdAndWinCreditBucket) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (_validPrizeMap(m.prizeMap)) {
    cfg.prizeMap = m.prizeMap.map(e => ({ x: Number(e.x), weight: Number(e.weight) }));
  } else if (m.prizeMap !== undefined) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[holdAndWinCreditBucket] invalid prizeMap in GDD, using defaults');
    }
  }
  if (_validJackpotMap(m.jackpotMap)) {
    cfg.jackpotMap = m.jackpotMap.map(e => ({
      label: e.label, x: Number(e.x), weight: Number(e.weight),
    }));
  } else if (m.jackpotMap !== undefined) {
    if (typeof console !== 'undefined' && console.warn) {
      console.warn('[holdAndWinCreditBucket] invalid jackpotMap in GDD, using defaults');
    }
  }

  if (typeof m.allLockedAward === 'string' && SAFE_LABEL.test(m.allLockedAward)) {
    /* allLockedAward MUST match a label in the resolved jackpotMap, else
     * fall back to the highest-x tier in the map. */
    const hit = cfg.jackpotMap.find(j => j.label === m.allLockedAward);
    cfg.allLockedAward = hit ? m.allLockedAward : cfg.jackpotMap.reduce(
      (a, b) => (b.x > a.x ? b : a), cfg.jackpotMap[0],
    ).label;
  } else {
    /* Default 'GRAND' may not exist if GDD overrode jackpotMap — pick max-x. */
    if (!cfg.jackpotMap.some(j => j.label === cfg.allLockedAward)) {
      cfg.allLockedAward = cfg.jackpotMap.reduce(
        (a, b) => (b.x > a.x ? b : a), cfg.jackpotMap[0],
      ).label;
    }
  }

  if (typeof m.bucketColor === 'string' && _isValidRgb(m.bucketColor)) {
    cfg.bucketColor = m.bucketColor.replace(/\s+/g, '');
  }
  if (typeof m.jackpotColor === 'string' && _isValidRgb(m.jackpotColor)) {
    cfg.jackpotColor = m.jackpotColor.replace(/\s+/g, '');
  }
  if (typeof m.currencyPrefix === 'string' && m.currencyPrefix.length > 0 && m.currencyPrefix.length <= 4) {
    cfg.currencyPrefix = m.currencyPrefix;
  }
  if (m.hudShowsTotal != null) cfg.hudShowsTotal = !!m.hudShowsTotal;

  /* Auto-enable when GDD declares a feature kind that maps to this block. */
  if (Array.isArray(model.features)) {
    const hit = model.features.some(f =>
      f && typeof f.kind === 'string'
      && /^(hold[_-]?and[_-]?win[_-]?credit[_-]?bucket|credit[_-]?bucket)$/i.test(f.kind)
    );
    if (hit) cfg.enabled = true;
  }

  return cfg;
}

export function emitHoldAndWinCreditBucketCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const b = cfg.bucketColor;
  const j = cfg.jackpotColor;
  return `
  /* ── holdAndWinCreditBucket BLOCK — emitted by src/blocks/holdAndWinCreditBucket.mjs ─
     Renders the credit / jackpot value chip inside every locked H&W cell.
     Sibling of the existing .is-locked-bonus halo (owned by holdAndWin).
     pointer-events: none — chip never intercepts cell taps. */
  .cell.is-locked-bonus {
    position: relative;
  }
  .hw-credit-chip {
    position: absolute;
    inset: auto 0 4px 0;        /* bottom-anchored band across the cell */
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 900;
    letter-spacing: 0.04em;
    line-height: 1;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.78), 0 0 6px rgba(0, 0, 0, 0.55);
    pointer-events: none;
    z-index: 6;                  /* above the .is-locked-bonus halo (z 4) */
    font-size: clamp(0.55rem, 1.6vw, 0.9rem);
  }
  .hw-credit-chip[data-kind="credit"] {
    color: rgba(${b}, 1);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.78), 0 0 8px rgba(${b}, 0.55);
  }
  .hw-credit-chip[data-kind="jackpot"] {
    color: rgba(${j}, 1);
    font-size: clamp(0.5rem, 1.4vw, 0.78rem);
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.78), 0 0 8px rgba(${j}, 0.7);
    text-transform: uppercase;
  }
  /* Re-skin the bonus emoji slot to a coin halo when this block is active,
     since the coin glyph is now redundant with the explicit credit chip. */
  .cell.is-locked-bonus.hw-has-credit::after {
    content: '';
  }
  .hw-credit-total-box .hw-lbl,
  .hw-credit-total-box .hw-val {
    color: rgba(${b}, 1);
  }
  @media (prefers-reduced-motion: reduce) {
    .hw-credit-chip { transition: none; }
  }
`;
}

/* Markup is intentionally empty — the value chips are appended directly
 * into existing `.cell.is-locked-bonus` nodes at runtime. Adding a static
 * host would create a dead DOM container the player never sees. */
export function emitHoldAndWinCreditBucketMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return '';
}

export function emitHoldAndWinCreditBucketRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── holdAndWinCreditBucket BLOCK (disabled) — stubs so probes don't crash ── */
  window.__HW_CREDIT_TOTAL__   = 0;
  window.__HW_CREDIT_JACKPOT__ = '';
  window.HW_CREDIT_STATE       = { enabled: false, values: new Map(), total: 0, jackpotTier: '', prevSize: 0 };
  window.hwCreditReset         = function () {};
`;
  }

  const prizeMapJson    = JSON.stringify(cfg.prizeMap);
  const jackpotMapJson  = JSON.stringify(cfg.jackpotMap.map(j => ({
    ...j, label: j.label,
  })));
  const allLockedAward  = JSON.stringify(cfg.allLockedAward);
  const currencyPrefix  = JSON.stringify(cfg.currencyPrefix);

  return `
  /* ── holdAndWinCreditBucket BLOCK — emitted by src/blocks/holdAndWinCreditBucket.mjs ──
     Owns emit of: onCreditBucketRespinStart, onCreditBucketLocked, onCreditBucketEnd.
     Observes: window.HW_STATE.lockedCells diff on postSpin / onSpinResult.
     Hard requirement: holdAndWin block must be enabled (HW_STATE present).
     If HW_STATE is missing at runtime we no-op + console.warn once so the
     dist still loads and other features keep working. */
  (function () {
    var PRIZE_MAP     = ${prizeMapJson};
    var JACKPOT_MAP   = ${jackpotMapJson};
    var ALL_LOCKED    = ${allLockedAward};
    var PREFIX        = ${currencyPrefix};
    var HUD_TOTAL     = ${cfg.hudShowsTotal ? 'true' : 'false'};

    var STATE = {
      enabled: true,
      values:      new Map(),     /* cellKey ('r,c') → { x, label, isJackpot } */
      total:       0,             /* running credit total (× bet) */
      jackpotTier: '',            /* label of jackpot hit this round, '' if none */
      prevSize:    0,             /* HW_STATE.lockedCells size at last sample */
      roundActive: false,         /* mirrors HW_STATE.active for diff trigger */
    };
    if (typeof window !== 'undefined') {
      window.__HW_CREDIT_TOTAL__   = 0;
      window.__HW_CREDIT_JACKPOT__ = '';
      window.HW_CREDIT_STATE       = STATE;
    }

    var WARNED_MISSING_HW = false;
    function _ensureHW() {
      if (typeof window === 'undefined') return false;
      if (window.HW_STATE && window.HW_STATE.lockedCells instanceof Map) return true;
      if (!WARNED_MISSING_HW && typeof console !== 'undefined' && console.warn) {
        console.warn('[holdAndWinCreditBucket] holdAndWin not enabled — bucket inactive');
        WARNED_MISSING_HW = true;
      }
      return false;
    }

    /* Weighted random draw helper — accepts [{value, weight}] returns one
     * entry. Uses Math.random; in headless test sandboxes Math.random can
     * be deterministic via injection. */
    function _weightedDraw(table) {
      var total = 0;
      for (var i = 0; i < table.length; i++) total += Math.max(0, Number(table[i].weight) || 0);
      if (!(total > 0)) return table[0];
      var r = Math.random() * total;
      var acc = 0;
      for (var j = 0; j < table.length; j++) {
        acc += Math.max(0, Number(table[j].weight) || 0);
        if (r < acc) return table[j];
      }
      return table[table.length - 1];
    }

    /* drawValue() — combine the prize ladder + jackpot ladder into one
     * weighted draw. Jackpots are rare; we mix them in by adding their
     * weights to the same total so the proportion is GDD-driven. */
    function _drawValue() {
      var bag = [];
      for (var i = 0; i < PRIZE_MAP.length; i++) {
        bag.push({ kind: 'credit', x: PRIZE_MAP[i].x, weight: PRIZE_MAP[i].weight, label: '' });
      }
      for (var k = 0; k < JACKPOT_MAP.length; k++) {
        bag.push({
          kind: 'jackpot', x: JACKPOT_MAP[k].x, weight: JACKPOT_MAP[k].weight,
          label: JACKPOT_MAP[k].label,
        });
      }
      return _weightedDraw(bag);
    }

    function _fmt(v) {
      if (!Number.isFinite(v) || v < 0) return '0';
      if (v >= 100) return String(Math.round(v));
      return (Math.round(v * 100) / 100).toFixed(2).replace(/0+$/, '').replace(/\\.$/, '');
    }

    function _hudHost() { return document.getElementById('hwHud'); }
    function _gridHost() { return document.getElementById('gridHost'); }

    /* _ensureHudTotal — lazily inject a TOTAL chip into the hold-and-win
     * HUD. Idempotent. holdAndWin owns the HUD root, we just append.
     * If hudShowsTotal is false we skip entirely. */
    function _ensureHudTotal() {
      if (!HUD_TOTAL) return null;
      var hud = _hudHost();
      if (!hud) return null;
      var box = hud.querySelector('.hw-credit-total-box');
      if (box) return box;
      box = document.createElement('div');
      box.className = 'hw-box hw-credit-total-box';
      /* WCAG 4.1.3 — total value mutates on every locked credit; the value
         span carries role="status" aria-live="polite" so SR users hear
         "Total +5.00" announcements as bucket fills. */
      box.innerHTML =
        '<span class="hw-lbl">TOTAL</span>' +
        '<span class="hw-val" id="hwCreditTotalVal" role="status" aria-live="polite">' + PREFIX + '0</span>';
      hud.appendChild(box);
      return box;
    }

    function _renderHudTotal() {
      if (!HUD_TOTAL) return;
      var el = document.getElementById('hwCreditTotalVal');
      if (!el) return;
      el.textContent = PREFIX + _fmt(STATE.total);
    }

    /* _renderCellChip — locate the .cell at (r,c) and attach the chip.
     * Existing chip is replaced (idempotent across re-render).
     * Requires grid to emit data-r and data-c attributes on .cell nodes. */
    function _renderCellChip(key, info) {
      var host = _gridHost();
      if (!host) return;
      var parts = key.split(',');
      var r = parseInt(parts[0], 10);
      var c = parseInt(parts[1], 10);
      var cell = host.querySelector('.cell[data-r="' + r + '"][data-c="' + c + '"]');
      if (!cell) return;
      var prev = cell.querySelector('.hw-credit-chip');
      if (prev) prev.parentNode.removeChild(prev);
      var chip = document.createElement('span');
      chip.className = 'hw-credit-chip';
      chip.setAttribute('data-kind', info.isJackpot ? 'jackpot' : 'credit');
      chip.textContent = info.isJackpot
        ? info.label
        : (PREFIX + _fmt(info.x));
      cell.classList.add('hw-has-credit');
      cell.appendChild(chip);
    }

    function _renderAllChips() {
      STATE.values.forEach(function (info, key) {
        _renderCellChip(key, info);
      });
    }

    /* _diffAndAssign — central diff. For every cellKey in HW_STATE.lockedCells
     * that we haven't seen yet, draw a value and store it. */
    function _diffAndAssign() {
      if (!_ensureHW()) return [];
      var added = [];
      window.HW_STATE.lockedCells.forEach(function (_v, key) {
        if (STATE.values.has(key)) return;
        var draw = _drawValue();
        var info = {
          x: draw.x,
          label: draw.kind === 'jackpot' ? draw.label : '',
          isJackpot: draw.kind === 'jackpot',
        };
        STATE.values.set(key, info);
        STATE.total += draw.x;
        if (draw.kind === 'jackpot' && !STATE.jackpotTier) {
          /* First jackpot of the round wins for the jackpot column.
           * Industry rule: per-round jackpot indicator latches on first hit. */
          STATE.jackpotTier = draw.label;
        }
        added.push({ key: key, info: info });
        if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
          try {
            window.HookBus.emit('onCreditBucketLocked', {
              cell: key, amount: draw.x, label: draw.label,
              isJackpot: draw.kind === 'jackpot',
            });
          } catch (e) {
            if (console && console.error) console.error('[hwCredit] emit Locked failed:', e);
          }
        }
      });
      if (typeof window !== 'undefined') {
        window.__HW_CREDIT_TOTAL__   = STATE.total;
        window.__HW_CREDIT_JACKPOT__ = STATE.jackpotTier;
      }
      return added;
    }

    /* _onRoundEnter — first postSpin where HW_STATE.active flips true. */
    function _onRoundEnter() {
      STATE.values.clear();
      STATE.total = 0;
      STATE.jackpotTier = '';
      STATE.prevSize = 0;
      STATE.roundActive = true;
      _ensureHudTotal();
      _renderHudTotal();
      if (typeof window !== 'undefined') {
        window.__HW_CREDIT_TOTAL__ = 0;
        window.__HW_CREDIT_JACKPOT__ = '';
      }
      if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onCreditBucketRespinStart', {
            startingRespins: (window.HW_STATE && window.HW_STATE.respinsLeft) || 0,
          });
        } catch (e) {
          if (console && console.error) console.error('[hwCredit] emit Start failed:', e);
        }
      }
    }

    /* _onRoundExit — postSpin where HW_STATE.active flips false (respins
     * exhausted or full grid). Compute final award, push __WIN_AWARD__,
     * emit End. If allLocked, add the all-locked jackpot on top. */
    function _onRoundExit() {
      if (!STATE.roundActive) return;
      var reels = window.REELS || 5;
      var rows  = window.ROWS  || 3;
      var allLocked = (STATE.values.size >= reels * rows);
      var finalTotal = STATE.total;
      var finalJackpot = STATE.jackpotTier;
      if (allLocked) {
        var top = null;
        for (var i = 0; i < JACKPOT_MAP.length; i++) {
          if (JACKPOT_MAP[i].label === ALL_LOCKED) { top = JACKPOT_MAP[i]; break; }
        }
        if (top) {
          finalTotal += top.x;
          finalJackpot = ALL_LOCKED;
        }
      }
      /* Compute award amount and validate bet. Accumulate onto any existing
       * line-win award so paying lines are not erased by bucket payout.
       * If bet is invalid (0, NaN, negative), use 0 to avoid false credits. */
      var bet = Number(window.__SLOT_BET__);
      var betValid = Number.isFinite(bet) && bet > 0;
      var awardAmount = finalTotal * (betValid ? bet : 0);
      if (typeof window !== 'undefined') {
        window.__WIN_AWARD__         = (Number(window.__WIN_AWARD__) || 0) + awardAmount;
        window.__HW_CREDIT_TOTAL__   = finalTotal;
        window.__HW_CREDIT_JACKPOT__ = finalJackpot;
      }
      if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.emit === 'function') {
        try {
          window.HookBus.emit('onCreditBucketEnd', {
            total: finalTotal,
            jackpotTier: finalJackpot,
            cellCount: STATE.values.size,
            allLocked: allLocked,
            award: awardAmount,
          });
        } catch (e) {
          if (console && console.error) console.error('[hwCredit] emit End failed:', e);
        }
      }
      /* Defer reset: leave values painted so the player can read the
       * final board until the next preSpin / FS transition. */
      STATE.roundActive = false;
    }

    function hwCreditReset() {
      STATE.values.clear();
      STATE.total = 0;
      STATE.jackpotTier = '';
      STATE.prevSize = 0;
      STATE.roundActive = false;
      if (typeof window !== 'undefined') {
        window.__HW_CREDIT_TOTAL__ = 0;
        window.__HW_CREDIT_JACKPOT__ = '';
      }
      var host = _gridHost();
      if (host) {
        host.querySelectorAll('.hw-credit-chip').forEach(function (n) { n.parentNode && n.parentNode.removeChild(n); });
        host.querySelectorAll('.hw-has-credit').forEach(function (n) { n.classList.remove('hw-has-credit'); });
      }
      _renderHudTotal();
    }

    if (typeof window !== 'undefined') {
      window.hwCreditReset = hwCreditReset;
    }

    /* Lifecycle wiring — order matters:
     *  postSpin  — fire AFTER holdAndWin's postSpin so HW_STATE is current.
     *              HookBus delivers listeners in registration order; this
     *              block's runtime is emitted by buildSlotHTML AFTER
     *              holdAndWin's runtime, so we naturally run after.
     *  onSpinResult — re-paint chips after DOM swap (cells get rebuilt).
     *  preSpin   — DO NOT clear here; the round survives across spins.
     *  onFsTrigger / onFsEnd — clear, FS round starts fresh.
     */
    if (typeof window.HookBus !== 'undefined' && typeof window.HookBus.on === 'function') {
      window.HookBus.on('postSpin', function () {
        if (!_ensureHW()) return;
        var hwActive = !!window.HW_STATE.active;
        if (hwActive && !STATE.roundActive) {
          _onRoundEnter();
          _diffAndAssign();
          _renderAllChips();
          _renderHudTotal();
        } else if (hwActive && STATE.roundActive) {
          _diffAndAssign();
          _renderAllChips();
          _renderHudTotal();
        } else if (!hwActive && STATE.roundActive) {
          /* The round just ended this postSpin. Final diff first so any
           * cell locked on the closing respin is counted. */
          _diffAndAssign();
          _renderAllChips();
          _renderHudTotal();
          _onRoundExit();
        }
        STATE.prevSize = (window.HW_STATE && window.HW_STATE.lockedCells) ? window.HW_STATE.lockedCells.size : 0;
      });

      window.HookBus.on('onSpinResult', function () {
        if (!_ensureHW()) return;
        if (STATE.roundActive) _renderAllChips();
      });

      window.HookBus.on('onFsTrigger', function () { hwCreditReset(); });
      window.HookBus.on('onFsEnd',     function () { hwCreditReset(); });
    }
  })();
`;
}
