/**
 * src/blocks/waysEval.mjs
 *
 * Wave M2 — Ways-to-Win evaluator block.
 *
 * Evaluates "ways" wins: from leftmost reel, count consecutive reels
 * containing the same symbol; multiply by the count of that symbol on
 * each reel. Industry baseline: ways-to-win pattern — 243 / 1024 / 3125 /
 * 117 649 ways tier ladder, multiplicative reel-count formula.
 *
 * Perf budget: ≤ 0.5 ms / spin on 5×3, ≤ 2 ms on 6×4 (DOM textContent reads only, no layout).
 *
 * GDD knobs:
 *   • waysCount: number — declared ways (243/1024/4096/7776/117649…)
 *   • minRun: number — min consecutive reels (default 3 = LTR)
 *   • direction: 'ltr' | 'rtl' | 'both'
 *   • maxEvents: number
 *   • payCap: number — per-win payout ceiling multiplier (default 50)
 *   • waysCap: number — ways count ceiling for payout formula (default 20)
 *   • tierMult: { HP, MP, WILD, LP } — per-tier payout multipliers
 */

const WAYS_BOUNDS = { waysCount: [9, 999999], minRun: [2, 9], maxEvents: [1, 32] };

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    waysCount: 243,
    minRun: 3,
    direction: 'ltr',
    maxEvents: 8,
    payCap: 50,
    waysCap: 20,
    tierMult: { HP: 1.0, MP: 0.5, WILD: 2.0, LP: 0.25 },
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.waysEval || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.waysCount)) cfg.waysCount = clampInt(m.waysCount, ...WAYS_BOUNDS.waysCount);
  if (Number.isFinite(m.minRun)) cfg.minRun = clampInt(m.minRun, ...WAYS_BOUNDS.minRun);
  if (m.direction === 'ltr' || m.direction === 'rtl' || m.direction === 'both') cfg.direction = m.direction;
  if (Number.isFinite(m.maxEvents)) cfg.maxEvents = clampInt(m.maxEvents, ...WAYS_BOUNDS.maxEvents);
  if (Number.isFinite(m.payCap)) cfg.payCap = clampInt(m.payCap, 1, 10000);
  if (Number.isFinite(m.waysCap)) cfg.waysCap = clampInt(m.waysCap, 1, 100000);
  if (m.tierMult && typeof m.tierMult === 'object') {
    for (const k of ['HP', 'MP', 'WILD', 'LP']) {
      if (Number.isFinite(m.tierMult[k])) cfg.tierMult[k] = m.tierMult[k];
    }
  }

  const hasFeature = Array.isArray(model.features) && model.features.some(f => f.kind === 'ways');
  const isWaysGrid = model.topology && (
    model.topology.evaluation === 'ways' ||
    Number.isFinite(model.topology.ways_count)
  );
  if (hasFeature || isWaysGrid) cfg.enabled = true;
  if (model.topology && Number.isFinite(model.topology.ways_count))
    cfg.waysCount = clampInt(model.topology.ways_count, ...WAYS_BOUNDS.waysCount);
  return cfg;
}

export function emitWaysEvalRuntime(cfg = defaultConfig()) {
  cfg = { ...defaultConfig(), ...cfg };
  if (!cfg.enabled) return `/* waysEval: disabled */`;
  const waysCount = clampInt(cfg.waysCount, ...WAYS_BOUNDS.waysCount);
  const minRun    = clampInt(cfg.minRun,    ...WAYS_BOUNDS.minRun);
  const maxEvents = clampInt(cfg.maxEvents, ...WAYS_BOUNDS.maxEvents);
  const payCap    = clampInt(cfg.payCap,    1, 10000);
  const waysCap   = clampInt(cfg.waysCap,   1, 100000);
  const tierMult  = { ...defaultConfig().tierMult, ...cfg.tierMult };
  return `/* ─── ways evaluator ──────────────────────────────────────────── */
const WAYS_COUNT      = ${waysCount};
const WAYS_MIN_RUN    = ${minRun};
const WAYS_DIRECTION  = ${JSON.stringify(cfg.direction)};
const WAYS_MAX_EVENTS = ${maxEvents};
const WAYS_PAY_CAP    = ${payCap};
const WAYS_CAP        = ${waysCap};
const WAYS_TIER_MULT  = ${JSON.stringify(tierMult)};

function _waysReelSymbols(reelIdx, REELS, ROWS, cells) {
  const out = new Set();
  for (let r = 0; r < ROWS; r++) {
    const idx = r * REELS + reelIdx;
    const sym = ((cells[idx] && cells[idx].textContent) || '').trim();
    if (sym) out.add(sym);
  }
  return out;
}

function _waysCountOnReel(reelIdx, sym, wild, REELS, ROWS, cells) {
  let n = 0;
  for (let r = 0; r < ROWS; r++) {
    const idx = r * REELS + reelIdx;
    const s = ((cells[idx] && cells[idx].textContent) || '').trim();
    if (s === sym || s === wild) n++;
  }
  return n;
}

function _evalWaysDirection(startReel, dir, REELS, ROWS, cells, anchorSyms, wild, scat) {
  /* Walk from startReel in dir (1 or -1) for each anchor symbol */
  const events = [];
  for (const sym of anchorSyms) {
    if (sym === wild || sym === scat) continue;
    let ways = 0;
    let run = 0;
    const reelsInRun = [];
    for (let i = 0; i < REELS; i++) {
      const reelIdx = startReel + i * dir;
      if (reelIdx < 0 || reelIdx >= REELS) break;
      const cnt = _waysCountOnReel(reelIdx, sym, wild, REELS, ROWS, cells);
      if (cnt === 0) break;
      ways = ways === 0 ? cnt : ways * cnt;
      run++;
      reelsInRun.push(reelIdx);
    }
    if (run >= WAYS_MIN_RUN && ways > 0) {
      /* Wave T4 fix — push actual DOM cell elements (not metadata objects)
         so tumble.runTumbleChain can call cell.classList.add('is-removing')
         downstream. Previously emitted { r, c, idx } plain objects which
         caused "Cannot read properties of undefined (reading 'add')" the
         first FS spin that landed a ways-mode win. */
      const winCells = [];
      reelsInRun.forEach(reelIdx => {
        for (let r = 0; r < ROWS; r++) {
          const idx = r * REELS + reelIdx;
          const cellEl = cells[idx];
          if (!cellEl) continue;
          const s = ((cellEl.textContent) || '').trim();
          if (s === sym || s === wild) winCells.push(cellEl);
        }
      });
      /* 2026-06-10 (Boki bug "nema win prezentacije") — emit payX so
         applyWinHighlight's totalAward > 0 gate fires and
         onWinPresentationStart actually emits. Industry baseline payout
         per ways: tier_mult × runLength × ways × bet (capped). Without
         this every ways-mode game (Huff lock_respin, GoO base, Megaclusters)
         silently treated wins as zero-paying and skipped the presentation. */
      const __regWE = (typeof SYMBOL_REGISTRY !== 'undefined' && SYMBOL_REGISTRY) ? SYMBOL_REGISTRY : null;
      const tier = (__regWE && __regWE.tier && __regWE.tier[sym]) || 'LP';
      const mult = (WAYS_TIER_MULT && WAYS_TIER_MULT[tier]) || WAYS_TIER_MULT.LP;
      const bet = (typeof window !== 'undefined' && Number.isFinite(window.__SLOT_BET__) && window.__SLOT_BET__ > 0) ? window.__SLOT_BET__ : 1;
      const payX = Math.min(WAYS_PAY_CAP, mult * (run - WAYS_MIN_RUN + 1) * Math.min(ways, WAYS_CAP)) * bet;
      events.push({ symbol: sym, ways, runLength: run, tier, matchLength: run, payX, cells: winCells });
    }
  }
  return events;
}

function detectWaysWins() {
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  /* D-10 FIX (2026-06-20): Boki "simboli u win liniji nestraju iz reel framea".
     Root cause was using host.querySelectorAll('.cell') which includes BUFFER
     cells (1 top + 3 visible + 1 bottom = 5 per reel × 5 reels = 25 total)
     but indexing math (r * REELS + reelIdx) assumes a flat REELS×ROWS = 15
     array. The mismatch picked up off-frame buffer cells as winning cells
     and marked them with cell--winsym → simboli su crtani 54px iznad frame-a.
     Fix: build the flat array from RECT_REELS[reelIdx].cellAt(rowIdx) which
     is the canonical visible-cell accessor (skips buffer rows). */
  const cells = new Array(REELS * ROWS);
  if (Array.isArray(window.RECT_REELS)) {
    for (let reelIdx = 0; reelIdx < REELS; reelIdx++) {
      const reel = window.RECT_REELS[reelIdx];
      if (!reel) continue;
      for (let r = 0; r < ROWS; r++) {
        const el = (typeof reel.cellAt === 'function')
          ? reel.cellAt(r)
          : (Array.isArray(reel.cells) ? reel.cells[r + 1] : null);
        cells[r * REELS + reelIdx] = el || null;
      }
    }
  } else {
    /* Fallback: original behavior. */
    const flat = host.querySelectorAll('.cell');
    for (let i = 0; i < REELS * ROWS && i < flat.length; i++) cells[i] = flat[i];
  }
  const reg   = (typeof SYMBOL_REGISTRY !== 'undefined') ? SYMBOL_REGISTRY : null;
  const wild  = reg && reg.wild;
  const scat  = reg && reg.scatter;
  if (!reg) return [];

  const anchorSyms = reg.regularPay || [];
  let all = [];
  if (WAYS_DIRECTION === 'ltr' || WAYS_DIRECTION === 'both') {
    all = all.concat(_evalWaysDirection(0, 1, REELS, ROWS, cells, anchorSyms, wild, scat));
  }
  if (WAYS_DIRECTION === 'rtl' || WAYS_DIRECTION === 'both') {
    all = all.concat(_evalWaysDirection(REELS - 1, -1, REELS, ROWS, cells, anchorSyms, wild, scat));
  }

  /* Sort by tier then ways desc */
  const tierRank = { HP: 0, MP: 1, LP: 2, WILD: 3 };
  all.sort((a, b) => {
    const ta = (reg.tier && reg.tier[a.symbol]) || 'LP';
    const tb = (reg.tier && reg.tier[b.symbol]) || 'LP';
    return (tierRank[ta] - tierRank[tb]) || (b.ways - a.ways);
  });
  return all.slice(0, WAYS_MAX_EVENTS);
}

if (typeof window !== 'undefined') {
  window.detectWaysWins = detectWaysWins;
  window.__waysEval     = { count: WAYS_COUNT };
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
