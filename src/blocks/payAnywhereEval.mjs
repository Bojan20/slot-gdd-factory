/**
 * src/blocks/payAnywhereEval.mjs
 *
 * Wave K1 — Pay-anywhere (scatter pays) win evaluator.
 *
 * Replaces the line-based `detectLineWins()` when GDD declares
 * `evaluation: 'pay_anywhere'` (pay-anywhere cluster reference).
 *
 * Win rule:
 *   For every regular symbol with COUNT >= minWin on the whole grid,
 *   win = bet × paytable[symbol][bucket(count)]
 *
 * Buckets (industry-standard pay-anywhere reference):
 *   8-9   → bucket[0]
 *   10-11 → bucket[1]
 *   12+   → bucket[2]
 *
 * Output event shape mirrors detectWinCombos so winPresentation can
 * cycle pay-anywhere events through the same `is-winsym-cycling` pulse.
 *
 * Pure module — no DOM, no globals. Safe to import in tests + builder.
 *
 * Perf budget: < 0.5 ms for 6×5 grid, < 1 ms for 7×7 — called every spin
 * on every cell, regression risk is silent.
 */

const MIN_WIN_FLOOR = 3, MIN_WIN_CEIL = 30;
const EDGE_FLOOR = 4, EDGE_CEIL = 60;
const MAX_EVENTS_CEIL = 20;
const MAX_BUCKETS = 8;

export function defaultConfig() {
  return {
    enabled: false,
    minWin: 8,              // industry-standard scatter-pays threshold
    bucketEdges: [10, 12],  // count >= edges[i] picks bucket[i+1]
    paytable: {},           // { symbolId: [bucket0, bucket1, bucket2] }
    maxEvents: 9,           // hard cap so cycle stays under ~5s
    noWinChance: 0,         // pay-anywhere already self-rare — no extra fakeout
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = model.payAnywhereEval || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.minWin)) cfg.minWin = clampInt(m.minWin, MIN_WIN_FLOOR, MIN_WIN_CEIL);
  if (Array.isArray(m.bucketEdges) && m.bucketEdges.every(Number.isFinite)) {
    let edges = m.bucketEdges.map(n => clampInt(n, EDGE_FLOOR, EDGE_CEIL)).sort((a, b) => a - b);
    if (edges.length > MAX_BUCKETS) {
      console.warn(`payAnywhereEval: bucketEdges length ${edges.length} > MAX_BUCKETS=${MAX_BUCKETS}; clamping`);
      edges = edges.slice(0, MAX_BUCKETS);
    }
    cfg.bucketEdges = edges;
  }
  if (m.paytable && typeof m.paytable === 'object') {
    cfg.paytable = {};
    for (const k of Object.keys(m.paytable)) {
      const row = m.paytable[k];
      if (Array.isArray(row)) cfg.paytable[String(k).toUpperCase()] = row.map(n => Number(n) || 0);
    }
  }
  if (Number.isFinite(m.maxEvents)) cfg.maxEvents = clampInt(m.maxEvents, 1, MAX_EVENTS_CEIL);
  if (Number.isFinite(m.noWinChance)) cfg.noWinChance = clampFloat(m.noWinChance, 0, 1);
  // Validate paytable rows match bucketEdges.length + 1 — undefined indexing
  // would otherwise mask a configuration error as a silent 0-pay.
  const expectedRowLen = cfg.bucketEdges.length + 1;
  for (const k of Object.keys(cfg.paytable)) {
    const row = cfg.paytable[k];
    if (row.length !== expectedRowLen) {
      console.warn(`payAnywhereEval: paytable[${k}] length ${row.length} ≠ bucketEdges.length+1 (${expectedRowLen})`);
    }
  }
  // Auto-enable when the topology declares pay_anywhere — single source of truth
  if (model.topology && model.topology.evaluation === 'pay_anywhere') {
    cfg.enabled = true;
  }
  return cfg;
}

/* ─── runtime emitter — injected into the standalone HTML ────────── */
export function emitPayAnywhereEvalRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    // Stub — no-op when GDD doesn't declare pay_anywhere
    return `/* payAnywhereEval: disabled (line-pays evaluator owns this game) */
function detectPayAnywhereWins() { return []; }
`;
  }
  const MIN_WIN = Math.floor(cfg.minWin);
  const BUCKET_EDGES = JSON.stringify(cfg.bucketEdges);
  const PAYTABLE = JSON.stringify(cfg.paytable);
  const MAX_EVENTS = Math.floor(cfg.maxEvents);

  return `/* ─── payAnywhereEval — count-based scatter-pays evaluator ─────────
   Perf budget: < 0.5 ms for 6×5 grid, < 1 ms for 7×7. */
const PAY_ANYWHERE_MIN_WIN = ${MIN_WIN};
const PAY_ANYWHERE_BUCKETS = ${BUCKET_EDGES};
const PAY_ANYWHERE_TABLE   = ${PAYTABLE};
const PAY_ANYWHERE_MAX_EVENTS = ${MAX_EVENTS};
const PAY_ANYWHERE_NO_WIN = ${Number(cfg.noWinChance) || 0};

/* Compute which bucket index a count falls into.
   bucketEdges=[10,12], count=9  → 0  (8-9)
                       count=10 → 1  (10-11)
                       count=12 → 2  (12+)
                       count=20 → 2  */
function _payAnywhereBucket(count) {
  let idx = 0;
  for (let i = 0; i < PAY_ANYWHERE_BUCKETS.length; i++) {
    if (count >= PAY_ANYWHERE_BUCKETS[i]) idx = i + 1;
  }
  return idx;
}

/* detectPayAnywhereWins — drop-in replacement for detectLineWins on a
   scatter-pays grid. Counts every regular symbol on the whole grid; any
   id with count >= MIN_WIN becomes one event. Wild contributes to every
   regular symbol's count (wild substitute). Scatter never participates. */
function detectPayAnywhereWins() {
  if (!Array.isArray(RECT_REELS) || RECT_REELS.length === 0) return [];
  const REG = (SYMBOL_REGISTRY && SYMBOL_REGISTRY.regularPay) || [];
  const WILD = SYMBOL_REGISTRY && SYMBOL_REGISTRY.wild;
  const SCATTER = SYMBOL_REGISTRY && SYMBOL_REGISTRY.scatter;
  const TIER = (SYMBOL_REGISTRY && SYMBOL_REGISTRY.tier) || {};

  /* Count + collect cells per symbol id. */
  const counts = Object.create(null);
  const cellsBy = Object.create(null);
  const wildCells = [];
  for (let r = 0; r < RECT_REELS.length; r++) {
    const reel = RECT_REELS[r];
    if (!reel || !Array.isArray(reel.visible)) continue;
    const vRows = reel.visibleRows || reel.visible.length;
    for (let row = 0; row < vRows; row++) {
      const sym = String(reel.visible[row] || '').toUpperCase();
      if (!sym) continue;
      const cell = (typeof reel.cellAt === 'function')
        ? reel.cellAt(row)
        : (reel.cells && reel.cells[row]);
      if (sym === WILD) {
        if (cell) wildCells.push(cell);
        continue;
      }
      if (sym === SCATTER) continue;
      counts[sym] = (counts[sym] || 0) + 1;
      if (!cellsBy[sym]) cellsBy[sym] = [];
      if (cell) cellsBy[sym].push(cell);
    }
  }

  /* Wild adds to every regular symbol's count (substitute) — apply BEFORE
     bucket selection so 7 high-symbol + 2 wild = bucket(9). */
  const wildCount = wildCells.length;
  const events = [];
  for (const sym of REG) {
    const natural = counts[sym] || 0;
    if (natural === 0) continue;            // no symbol on grid → wilds can't scatter it
    const total = natural + wildCount;
    if (total < PAY_ANYWHERE_MIN_WIN) continue;
    const bucket = _payAnywhereBucket(total);
    const row = PAY_ANYWHERE_TABLE[sym];
    const pay = (Array.isArray(row) && row[bucket] != null) ? row[bucket] : 0;
    const tier = TIER[sym] || 'LP';
    events.push({
      symbol: sym,
      tier,
      count: total,
      bucket,
      payX: Number(pay) || 0,
      cells: [...(cellsBy[sym] || []), ...wildCells],
    });
  }

  /* Tier sort: HP → MP → LP. Within tier, higher count first. */
  const tierRank = { HP: 0, MP: 1, LP: 2 };
  events.sort((a, b) => {
    const ra = tierRank[a.tier] ?? 9;
    const rb = tierRank[b.tier] ?? 9;
    if (ra !== rb) return ra - rb;
    return b.count - a.count;
  });

  if (PAY_ANYWHERE_NO_WIN > 0 && Math.random() < PAY_ANYWHERE_NO_WIN) return [];
  return events.slice(0, PAY_ANYWHERE_MAX_EVENTS);
}

if (typeof window !== "undefined") {
  window.detectPayAnywhereWins = detectPayAnywhereWins;
  window.PAY_ANYWHERE_TABLE = PAY_ANYWHERE_TABLE;
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
