/**
 * Slot GDD Factory · pure grid-shape descriptor module
 *
 * Takes a parsed model (from parser.mjs) and emits a deterministic, pure
 * JSON shape descriptor describing exactly which cells exist, how they are
 * laid out, and what visual rendering strategy to use.
 *
 * No DOM, no globals — Node-testable. The descriptor is consumed by the
 * renderer in `app.js` (browser side, builds HTML) and by `tests/render-grid-all.mjs`
 * (Node side, validates structure).
 *
 * Public API:
 *   buildGridShape(model) → GridShape
 *
 * GridShape:
 *   {
 *     kind: 'rectangular' | 'variable_reel' | 'cluster' | 'megaclusters' |
 *           'hexagonal' | 'diamond' | 'pyramid' | 'cross' | 'l_shape' |
 *           'radial' | 'infinity' | 'expanding' | 'dual' | 'slingo' |
 *           'plinko' | 'crash' | 'wheel' | 'lock_respin',
 *     reels: number,
 *     rows: number,            // max row count across all reels
 *     columns: Array<{ rows: number, mask?: Array<boolean> }>, // per-column
 *     cells: Array<{ reel: number, row: number, kind?: string }>, // populated cell positions
 *     totalCells: number,
 *     mechanics: {
 *       cascade: boolean,
 *       lockRespin: boolean,
 *       twinReels: boolean,
 *       mirroredReels: boolean,
 *       growable: boolean,
 *       expandsTo?: { reels: number, rows: number },
 *       tieredRows?: [number, number],
 *       gridCount: number,
 *     },
 *     subgrids?: Array<GridShape>,   // for dual / slingo / megaclusters
 *     evaluation: string,
 *     paylines: number | null,
 *     wayCount: number | null,
 *     shapeNote: string,             // human label like "5×3 rectangular"
 *   }
 *
 * Math (RTP, weights, paytable) is OUT OF SCOPE — same decree as parser.
 */

const VALID_KINDS = new Set([
  'rectangular', 'variable_reel', 'cluster', 'megaclusters', 'hexagonal',
  'diamond', 'pyramid', 'cross', 'l_shape', 'radial', 'infinity', 'expanding',
  'dual', 'slingo', 'plinko', 'crash', 'wheel', 'lock_respin',
]);

export function buildGridShape(model) {
  const t = model.topology || {};
  const kind = classifyKind(t);
  const reels = t.reels || 5;
  const rows = t.rows || 3;

  let columns = [];
  let cells = [];
  let subgrids = undefined;
  let shapeNote = '';

  switch (kind) {
    case 'variable_reel': {
      // Per-reel rows array. Either derived from `rows_per_reel` range or
      // from explicit array (diamond/pyramid).
      const perReel = computeVariableRows(t, reels);
      columns = perReel.map(r => ({ rows: r }));
      for (let c = 0; c < perReel.length; c++) {
        const colRows = perReel[c];
        const offset = Math.floor((rows - colRows) / 2); // center-align
        for (let r = 0; r < colRows; r++) cells.push({ reel: c, row: offset + r });
      }
      shapeNote = `${reels}×[${perReel.join(',')}] variable per-reel`;
      break;
    }
    case 'diamond': {
      const arr = t.rows_per_reel_array && t.rows_per_reel_array.length
        ? t.rows_per_reel_array
        : diamondShape(reels);
      columns = arr.map(r => ({ rows: r }));
      for (let c = 0; c < arr.length; c++) {
        const offset = Math.floor((rows - arr[c]) / 2);
        for (let r = 0; r < arr[c]; r++) cells.push({ reel: c, row: offset + r });
      }
      shapeNote = `[${arr.join('-')}] diamond`;
      break;
    }
    case 'pyramid': {
      const arr = t.rows_per_reel_array && t.rows_per_reel_array.length
        ? t.rows_per_reel_array
        : pyramidShape(reels);
      columns = arr.map(r => ({ rows: r }));
      for (let c = 0; c < arr.length; c++) {
        const offset = rows - arr[c]; // bottom-anchor
        for (let r = 0; r < arr[c]; r++) cells.push({ reel: c, row: offset + r });
      }
      shapeNote = `[${arr.join('-')}] pyramid`;
      break;
    }
    case 'cluster': {
      // Square or near-square grid, every cell populated.
      for (let c = 0; c < reels; c++) {
        columns.push({ rows });
        for (let r = 0; r < rows; r++) cells.push({ reel: c, row: r });
      }
      shapeNote = `${reels}×${rows} cluster`;
      break;
    }
    case 'megaclusters': {
      // Visualized as base grid; mechanic flag indicates 4-way split on win.
      const base = Math.min(reels, rows);
      for (let c = 0; c < base; c++) {
        columns.push({ rows: base });
        for (let r = 0; r < base; r++) cells.push({ reel: c, row: r });
      }
      shapeNote = `${base}×${base} megaclusters (splits to ${base * 2}×${base * 2})`;
      break;
    }
    case 'hexagonal': {
      // Honeycomb — rings of hex tiles. Default ring=3 → 19 cells.
      const ring = t.hex_ring || 3;
      const hexCells = hexGrid(ring);
      // Map hex (q, r) into (reel, row)-ish flat index; we store the raw qr too.
      for (const [q, r] of hexCells) cells.push({ reel: q + ring, row: r + ring, hex: { q, r } });
      // columns describe approximate column count for layout
      const dim = ring * 2 + 1;
      for (let c = 0; c < dim; c++) columns.push({ rows: dim });
      shapeNote = `hex ring=${ring} (${hexCells.length} tiles)`;
      break;
    }
    case 'cross': {
      // Cruciform — 5×5 with 4 corners blanked. Generalize: blank corner 2×2 squares.
      const blank = Math.max(1, Math.floor(Math.min(reels, rows) / 3));
      for (let c = 0; c < reels; c++) {
        const mask = new Array(rows).fill(true);
        if (c < blank || c >= reels - blank) {
          for (let r = 0; r < blank; r++) mask[r] = false;
          for (let r = rows - blank; r < rows; r++) mask[r] = false;
        }
        columns.push({ rows, mask });
        for (let r = 0; r < rows; r++) if (mask[r]) cells.push({ reel: c, row: r });
      }
      shapeNote = `${reels}×${rows} cross (corner blank=${blank})`;
      break;
    }
    case 'l_shape': {
      // One bottom-right corner blanked (or top-right).
      const blank = Math.max(1, Math.floor(Math.min(reels, rows) / 2));
      for (let c = 0; c < reels; c++) {
        const mask = new Array(rows).fill(true);
        if (c >= reels - blank) {
          for (let r = rows - blank; r < rows; r++) mask[r] = false;
        }
        columns.push({ rows, mask });
        for (let r = 0; r < rows; r++) if (mask[r]) cells.push({ reel: c, row: r });
      }
      shapeNote = `${reels}×${rows} L-shape (corner blank=${blank})`;
      break;
    }
    case 'radial': {
      // Spoke wheel — N spokes radiating from center; spokes count = reels.
      const spokes = t.wheel_segments || reels || 8;
      columns.push({ rows: spokes });
      for (let r = 0; r < spokes; r++) cells.push({ reel: 0, row: r, spoke: r });
      shapeNote = `radial ${spokes}-spoke`;
      break;
    }
    case 'wheel': {
      // N segments around a wheel — wheel_segments wins, else reels*rows fallback.
      const segments = t.wheel_segments || (rows > 1 ? rows : (reels * rows)) || 24;
      columns.push({ rows: segments });
      for (let r = 0; r < segments; r++) cells.push({ reel: 0, row: r, segment: r });
      shapeNote = `wheel ${segments}-segment`;
      break;
    }
    case 'plinko': {
      // Triangular peg matrix. Row n has n+1 pegs. Default 16 rows.
      const pegRows = t.plinko_rows || 16;
      for (let r = 0; r < pegRows; r++) {
        columns.push({ rows: r + 1 });
        for (let c = 0; c <= r; c++) cells.push({ reel: c, row: r });
      }
      shapeNote = `plinko ${pegRows}-row triangle`;
      break;
    }
    case 'crash': {
      // Single-line multiplier curve — represent as 1×1 placeholder.
      columns.push({ rows: 1 });
      cells.push({ reel: 0, row: 0, multiplier: true });
      shapeNote = `crash multiplier curve`;
      break;
    }
    case 'slingo': {
      // 5×5 bingo board + 1×5 reel strip below
      const boardSize = 5;
      for (let c = 0; c < boardSize; c++) {
        columns.push({ rows: boardSize });
        for (let r = 0; r < boardSize; r++) cells.push({ reel: c, row: r, region: 'board' });
      }
      // strip
      subgrids = [{
        kind: 'rectangular',
        reels: boardSize,
        rows: 1,
        columns: Array.from({ length: boardSize }, () => ({ rows: 1 })),
        cells: Array.from({ length: boardSize }, (_, c) => ({ reel: c, row: 0, region: 'strip' })),
        totalCells: boardSize,
        mechanics: emptyMechanics(),
        evaluation: 'lines',
        paylines: 1,
        wayCount: null,
        shapeNote: 'slingo reel strip 1×5',
      }];
      shapeNote = `slingo 5×5 board + 1×5 strip`;
      break;
    }
    case 'dual': {
      // Two side-by-side grids. Default: equal-size copies; if Colossal cue,
      // upper=5×4 + lower=5×12.
      const isColossal = !!t.is_colossal;
      const a = isColossal ? { reels: 5, rows: 4 } : { reels, rows };
      const b = isColossal ? { reels: 5, rows: 12 } : { reels, rows };
      // Primary in the descriptor mirrors `a`
      for (let c = 0; c < a.reels; c++) {
        columns.push({ rows: a.rows });
        for (let r = 0; r < a.rows; r++) cells.push({ reel: c, row: r, region: 'a' });
      }
      subgrids = [{
        kind: 'rectangular',
        reels: b.reels, rows: b.rows,
        columns: Array.from({ length: b.reels }, () => ({ rows: b.rows })),
        cells: gridCells(b.reels, b.rows, 'b'),
        totalCells: b.reels * b.rows,
        mechanics: emptyMechanics(),
        evaluation: 'lines',
        paylines: null,
        wayCount: null,
        shapeNote: `${b.reels}×${b.rows} secondary`,
      }];
      shapeNote = isColossal
        ? `Colossal dual: ${a.reels}×${a.rows} + ${b.reels}×${b.rows}`
        : `dual: 2×(${a.reels}×${a.rows})`;
      break;
    }
    case 'infinity': {
      // Base 3×3 (or whatever) with horizontal grow indicator
      for (let c = 0; c < reels; c++) {
        columns.push({ rows });
        for (let r = 0; r < rows; r++) cells.push({ reel: c, row: r });
      }
      shapeNote = `${reels}×${rows} → ∞ horizontal (infinity reels)`;
      break;
    }
    case 'expanding': {
      // Base rows × reels with `tiered_rows` indicating max
      for (let c = 0; c < reels; c++) {
        columns.push({ rows });
        for (let r = 0; r < rows; r++) cells.push({ reel: c, row: r });
      }
      const maxRows = (t.tiered_rows && t.tiered_rows[1]) || rows;
      shapeNote = `${reels}×${rows} → ${reels}×${maxRows} expanding`;
      break;
    }
    case 'lock_respin': {
      for (let c = 0; c < reels; c++) {
        columns.push({ rows });
        for (let r = 0; r < rows; r++) cells.push({ reel: c, row: r, lockable: true });
      }
      shapeNote = `${reels}×${rows} lock-respin (Hold & Win)`;
      break;
    }
    case 'rectangular':
    default: {
      for (let c = 0; c < reels; c++) {
        columns.push({ rows });
        for (let r = 0; r < rows; r++) cells.push({ reel: c, row: r });
      }
      shapeNote = `${reels}×${rows} rectangular`;
    }
  }

  return {
    kind,
    reels,
    rows,
    columns,
    cells,
    totalCells: cells.length,
    mechanics: {
      cascade: !!(t.cascade && t.cascade.enabled),
      lockRespin: !!t.lock_respin,
      twinReels: !!t.twin_reels,
      mirroredReels: !!t.mirrored_reels,
      growable: !!t.growable,
      expandsTo: t.tiered_rows ? { reels, rows: t.tiered_rows[1] } : undefined,
      tieredRows: t.tiered_rows || undefined,
      gridCount: t.grid_count || 1,
    },
    subgrids,
    evaluation: t.evaluation || 'lines',
    paylines: t.paylines === null || t.paylines === undefined ? null : t.paylines,
    wayCount: t.ways_count || null,
    shapeNote,
  };
}

/* ─── classifier ─────────────────────────────────────────── */
function classifyKind(t) {
  // explicit override
  if (t.kind && VALID_KINDS.has(t.kind)) return t.kind;
  // shape field maps directly for several
  const shape = t.shape || 'rectangular';
  if (shape === 'hexagonal') return 'hexagonal';
  if (shape === 'pyramid')   return 'pyramid';
  if (shape === 'diamond')   return 'diamond';
  if (shape === 'cross')     return 'cross';
  if (shape === 'l_shape')   return 'l_shape';
  if (shape === 'radial')    return 'radial';
  // wheel / plinko / crash / slingo come from evaluation kind or special flags
  if (t.evaluation === 'crash')   return 'crash';
  if (t.evaluation === 'wheel')   return 'wheel';
  if (t.is_slingo || t.evaluation === 'slingo') return 'slingo';
  if (t.is_plinko || t.evaluation === 'plinko') return 'plinko';
  // dual / multi-grid
  if ((t.grid_count || 1) >= 2)   return 'dual';
  // megaclusters — explicit
  if (t.is_megaclusters || t.evaluation === 'megaclusters') return 'megaclusters';
  // cluster eval
  if (t.evaluation === 'cluster') return 'cluster';
  // infinity / growing
  if (t.growable || t.evaluation === 'infinity') return 'infinity';
  // expanding (tiered rows)
  if (t.tiered_rows) return 'expanding';
  // variable per-reel (Megaways family)
  if (t.rows_per_reel && t.rows_per_reel.variable) return 'variable_reel';
  // lock-respin
  if (t.lock_respin) return 'lock_respin';
  // default
  return 'rectangular';
}

/* ─── helpers ────────────────────────────────────────────── */
function computeVariableRows(t, reels) {
  if (t.rows_per_reel_array && t.rows_per_reel_array.length === reels) return t.rows_per_reel_array;
  if (t.rows_per_reel && t.rows_per_reel.variable) {
    const { min, max } = t.rows_per_reel;
    // Default Megaways pattern: max at center reels, min at edges
    const arr = [];
    for (let i = 0; i < reels; i++) {
      // simple deterministic pattern: max for middle reels, scaled down at edges
      const fromEdge = Math.min(i, reels - 1 - i);
      const v = Math.min(max, min + Math.round((max - min) * (fromEdge / Math.floor((reels - 1) / 2 || 1))));
      arr.push(v);
    }
    return arr;
  }
  return new Array(reels).fill(t.rows || 3);
}

function diamondShape(reels) {
  // [3,4,5,4,3] for 5 reels; generalize: symmetric ramp peaking at center
  if (reels === 5) return [3, 4, 5, 4, 3];
  if (reels === 7) return [3, 4, 5, 7, 5, 4, 3];
  // generic symmetric ramp
  const peak = Math.floor(reels / 2);
  const arr = new Array(reels);
  for (let i = 0; i < reels; i++) {
    const d = Math.abs(i - peak);
    arr[i] = Math.max(3, peak - d + 3);
  }
  return arr;
}

function pyramidShape(reels) {
  // [1,3,5,3,1] for 5 reels; generalize: symmetric odd peak
  if (reels === 5) return [1, 3, 5, 3, 1];
  if (reels === 7) return [1, 3, 5, 7, 5, 3, 1];
  const peak = Math.floor(reels / 2);
  const arr = new Array(reels);
  for (let i = 0; i < reels; i++) {
    const d = Math.abs(i - peak);
    arr[i] = Math.max(1, (peak - d) * 2 + 1);
  }
  return arr;
}

function hexGrid(ring) {
  // Axial coordinates for a hex ring centered at (0,0) with given radius
  const cells = [];
  for (let q = -ring; q <= ring; q++) {
    const rMin = Math.max(-ring, -q - ring);
    const rMax = Math.min(ring, -q + ring);
    for (let r = rMin; r <= rMax; r++) cells.push([q, r]);
  }
  return cells;
}

function gridCells(reels, rows, region) {
  const out = [];
  for (let c = 0; c < reels; c++) {
    for (let r = 0; r < rows; r++) out.push({ reel: c, row: r, region });
  }
  return out;
}

function emptyMechanics() {
  return {
    cascade: false, lockRespin: false, twinReels: false, mirroredReels: false,
    growable: false, gridCount: 1,
  };
}
