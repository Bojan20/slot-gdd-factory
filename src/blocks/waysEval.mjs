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
 * GDD knobs:
 *   • waysCount: number — declared ways (243/1024/4096/7776/117649…)
 *   • minRun: number — min consecutive reels (default 3 = LTR)
 *   • direction: 'ltr' | 'rtl' | 'both'
 *   • maxEvents: number
 */

export function defaultConfig() {
  return {
    enabled: false,
    waysCount: 243,
    minRun: 3,
    direction: 'ltr',
    maxEvents: 8,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.waysEval || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.waysCount)) cfg.waysCount = clampInt(m.waysCount, 9, 999999);
  if (Number.isFinite(m.minRun)) cfg.minRun = clampInt(m.minRun, 2, 7);
  if (m.direction === 'ltr' || m.direction === 'rtl' || m.direction === 'both') cfg.direction = m.direction;
  if (Number.isFinite(m.maxEvents)) cfg.maxEvents = clampInt(m.maxEvents, 1, 32);

  const hasFeature = Array.isArray(model.features) && model.features.some(f => f.kind === 'ways');
  const isWaysGrid = model.topology && (
    model.topology.evaluation === 'ways' ||
    Number.isFinite(model.topology.ways_count)
  );
  if (hasFeature || isWaysGrid) cfg.enabled = true;
  if (model.topology && Number.isFinite(model.topology.ways_count)) cfg.waysCount = model.topology.ways_count;
  return cfg;
}

export function emitWaysEvalRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* waysEval: disabled */`;
  return `/* ─── ways evaluator ──────────────────────────────────────────── */
const WAYS_COUNT      = ${cfg.waysCount};
const WAYS_MIN_RUN    = ${cfg.minRun};
const WAYS_DIRECTION  = ${JSON.stringify(cfg.direction)};
const WAYS_MAX_EVENTS = ${cfg.maxEvents};

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
      events.push({ symbol: sym, ways, runLength: run, cells: winCells });
    }
  }
  return events;
}

function detectWaysWins() {
  const host = document.getElementById('gridHost');
  if (!host) return [];
  const REELS = window.REELS || 5;
  const ROWS  = window.ROWS  || 3;
  const cells = host.querySelectorAll('.cell');
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
  window.WAYS_COUNT     = WAYS_COUNT;
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
