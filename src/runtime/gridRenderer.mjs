/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  src/runtime/gridRenderer.mjs
 *
 *  Purpose
 *  ───────
 *    Extracted grid render layer for `buildSlotHTML.mjs`. Owns the
 *    DOM-construction code for every supported grid kind so the orchestrator
 *    is a pure `import + emit` shell. Without this module, ~700 lines of
 *    inline `<script>` JS lived in `buildSlotHTML.mjs`, blowing the
 *    Wave T-slim Phase 2 LOC budget (target < 800).
 *
 *  Industry reference (vendor-neutral synthesis)
 *  ─────────────────────────────────────────────
 *    Every commercial slot front-end separates the static grid renderer
 *    (rectangular / hex / wheel / SVG kinds) from the spin engine. The
 *    renderer is invoked on initial load and on resize; the spin engine
 *    drives column motion. We mirror that split.
 *
 *  Public API
 *  ──────────
 *    emitGridHelpersRuntime(model) -> string
 *        Emits `symAt`, `makeCell`, `cellSize`, `UNIFORM_REEL_KINDS`.
 *        MUST be injected BEFORE `emitReelEngineRuntime(...)` because the
 *        engine block depends on `makeCell` / `symAt` / `UNIFORM_REEL_KINDS`
 *        being in scope at its execution time.
 *
 *    emitGridDispatchRuntime(model) -> string
 *        Emits `renderRect`, `renderVariableReel`, `renderMaskedRect`,
 *        `renderHex`, `renderWheel`, `renderPlinko`, `renderCrash`,
 *        `renderSlingo`, `renderDual`, `renderGrid` dispatcher, and `fit`
 *        + the `resize` listener + first-frame schedule. MUST be injected
 *        AFTER the reel engine, payline overlay, and win-presentation
 *        runtimes are emitted (`renderRect` calls `buildReelColumns`,
 *        `renderGrid` calls `ensurePaylineOverlay`).
 *
 *  Lifecycle / hook ownership
 *  ──────────────────────────
 *    This is INFRASTRUCTURE, not a feature LEGO block. It does not register
 *    on HookBus. The only event it owns is the DOM `window.resize` listener
 *    that re-runs `renderGrid()`. No spin-lifecycle ownership — engine still
 *    drives spin, this module only builds the initial DOM and re-builds on
 *    resize / kind change.
 *
 *  Configuration consumed from `model`
 *  ───────────────────────────────────
 *    `model.theme.palette[2]` (or `'#c9a227'` fallback) — used as `accent`
 *    in SVG stroke / text fills for `renderWheel` and `renderCrash`.
 *
 *  Performance budget
 *  ──────────────────
 *    All render functions are O(cells) DOM appends; cellSize is O(1). Single
 *    grid mount per render, no inner loops > totalCells. Safe for the
 *    7×7 cluster (49 cells) up to the 7×35 megacluster (245 cells) ceilings
 *    enforced upstream by `gridShape.mjs`.
 *
 *  Accessibility
 *  ─────────────
 *    Cells are plain `<div class="cell">` with text content. No interactivity
 *    here — interactivity (click / focus) is owned by feature blocks that
 *    listen on the cell elements. Keeps WCAG focus management isolated.
 *
 *  Vendor neutrality
 *  ─────────────────
 *    Zero game / vendor mentions. Only references are to abstract kinds
 *    ("rectangular", "hex", "cluster", "megaclusters", "wheel" ...).
 *
 *  GDD keys read
 *  ─────────────
 *    `theme.palette` (optional). All other render decisions are driven by
 *    runtime globals (`SHAPE`, `REELS`, `ROWS`, `POOL`) which are already
 *    emitted upstream into the same `<script>` block.
 * ─────────────────────────────────────────────────────────────────────────────
 */

/**
 * @typedef {object} GridRendererConfig
 * @property {string} accent — palette accent color used in SVG strokes / fills.
 */

const DEFAULT_ACCENT = '#c9a227';

/**
 * Pure config resolver. Defensive against missing / malformed palette.
 * @param {object} model
 * @returns {GridRendererConfig}
 */
export function resolveGridRendererConfig(model) {
  const m = (model && typeof model === 'object') ? model : {};
  const theme = (m.theme && typeof m.theme === 'object') ? m.theme : {};
  const palette = Array.isArray(theme.palette) ? theme.palette : [];
  const raw = (typeof palette[2] === 'string') ? palette[2].trim() : '';
  /* Defensive: only accept hex (#RGB / #RRGGBB), rgb()/rgba() forms,
     or known CSS color keywords (best-effort: anything non-empty and
     plausibly safe — we still escape on emit). Reject anything with
     `<` or `"` which would break out of the SVG attribute. */
  const safe = /^[#a-zA-Z0-9(),.\s%]+$/.test(raw) ? raw : '';
  return { accent: safe || DEFAULT_ACCENT };
}

/**
 * Emits helper functions that MUST be in scope before the reel engine
 * runtime. Stand-alone — no other emit depends on it semantically beyond
 * symbol visibility.
 * @param {object} model
 * @returns {string}
 */
export function emitGridHelpersRuntime(/* model */) {
  /* No model-driven branches here — the helpers are pure DOM glue. We still
     accept `model` to keep the emit-signature symmetric with the rest of
     the runtime. */
  return `
  /* ── Grid helpers (extracted: src/runtime/gridRenderer.mjs) ────────── */
  /* Deterministic symbol fill — repeatable layout per fixture for snapshots */
  function symAt(i) { return POOL[i % POOL.length]; }

  function makeCell(text, extraClass) {
    const el = document.createElement("div");
    el.className = "cell" + (extraClass ? " " + extraClass : "");
    el.textContent = text || "?";
    return el;
  }

  /* Compute the side length so a (cols x rowsCount) grid of square cells
     with the given gap between them fits inside the frame inner box. The
     grid is centered by .gridHost flex layout. */
  function cellSize(cols, rowsCount, gap) {
    if (gap === undefined) gap = 6;
    var innerW = grid.clientWidth  || frame.clientWidth;
    var innerH = grid.clientHeight || frame.clientHeight;
    var cellW = (innerW - gap * Math.max(0, cols - 1)) / cols;
    var cellH = (innerH - gap * Math.max(0, rowsCount - 1)) / rowsCount;
    return Math.max(20, Math.floor(Math.min(cellW, cellH)));
  }

  /* Shape kinds that share the rectangular reel engine (flat REELS×ROWS
     column layout). Cluster's 7×7 looks like 7 stacked-symbol columns
     spinning, same beat as rectangular's 5×3 — just larger. */
  const UNIFORM_REEL_KINDS = new Set([
    'rectangular',
    'cluster',
    'megaclusters',
    'lock_respin',
    'expanding',
    'infinity',
    'variable_reel',
    'diamond',
    'pyramid',
    'cross',
    'l_shape',
  ]);
`;
}

/**
 * Emits the per-kind render functions, dispatcher, and bootstrap (`fit` +
 * resize listener + first-frame schedule). Inserted AFTER reelEngine /
 * paylineOverlay / winPresentation runtimes so all referenced helpers
 * (`buildReelColumns`, `ensurePaylineOverlay`) are already in scope.
 * @param {object} model
 * @returns {string}
 */
export function emitGridDispatchRuntime(model) {
  const cfg = resolveGridRendererConfig(model);
  const accent = cfg.accent;
  return `
  /* ── Grid renderers (extracted: src/runtime/gridRenderer.mjs) ──────── */

  function renderRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = side + "px";  // single row of reel columns

    if (UNIFORM_REEL_KINDS.has(SHAPE.kind)) {
      const extraClass = (SHAPE.kind === 'lock_respin') ? 'lockable' : '';
      let perReelRows = ROWS;
      let anchor = 'center';
      const PER_COLUMN_KINDS = new Set(['variable_reel', 'diamond', 'pyramid']);
      const SHAPED_HOST_KINDS = new Set(['variable_reel', 'diamond', 'pyramid', 'cross', 'l_shape']);
      if (PER_COLUMN_KINDS.has(SHAPE.kind) && Array.isArray(SHAPE.columns)) {
        perReelRows = SHAPE.columns.map(c => c.rows || ROWS);
        if (SHAPE.kind === 'pyramid') anchor = 'bottom';
      }
      if (SHAPED_HOST_KINDS.has(SHAPE.kind)) {
        host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
      }
      buildReelColumns(host, REELS, perReelRows, side, extraClass, anchor);
      /* cross / l_shape: dim cells that the GDD shape mask marks as blank
         (corner cuts). Engine still spins every column, just visual mask. */
      if (SHAPE.kind === 'cross' || SHAPE.kind === 'l_shape') {
        for (let c = 0; c < REELS; c++) {
          const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
          if (!colMask) continue;
          const reel = RECT_REELS[c];
          if (!reel) continue;
          for (let r = 0; r < ROWS; r++) {
            if (colMask[r]) continue;
            /* Strip cells are indexed 0..stripBufferCells+visibleRows-1.
               The visible window is cells[1..visibleRows]. Mark cells in
               the blank rows as cell--masked so CSS can hide them. */
            const cell = reel.cells[1 + r];
            if (cell) cell.classList.add('cell--masked');
          }
        }
      }
      if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
        const tag = document.createElement("div");
        tag.className = "grow-tag";
        tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
        frame.appendChild(tag);
      }
      grid.appendChild(host);
      return;
    }

    /* Irregular shapes — legacy static-cell render. Dispatcher routes hex /
       wheel / etc. away from renderRect; this branch is reached only when a
       kind is NOT in UNIFORM_REEL_KINDS yet still dispatches here (defensive
       fallback for future kinds). */
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        host.appendChild(makeCell(symAt(idx), ""));
        idx++;
      }
    }
    grid.appendChild(host);
  }

  function renderVariableReel() {
    const host = document.createElement("div");
    host.className = "grid-vrl";
    const maxRows = Math.max.apply(null, SHAPE.columns.map(c => c.rows));
    const side = cellSize(SHAPE.columns.length, maxRows);
    let idx = 0;
    for (let c = 0; c < SHAPE.columns.length; c++) {
      const colEl = document.createElement("div");
      colEl.className = "col";
      const colRows = SHAPE.columns[c].rows;
      for (let r = 0; r < colRows; r++) {
        const cell = makeCell(symAt(idx));
        cell.style.width = side + "px";
        cell.style.height = side + "px";
        colEl.appendChild(cell);
        idx++;
      }
      host.appendChild(colEl);
    }
    grid.appendChild(host);
  }

  function renderMaskedRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        const colMask = SHAPE.columns[c] && SHAPE.columns[c].mask;
        const enabled = colMask ? colMask[r] : true;
        if (enabled) {
          host.appendChild(makeCell(symAt(idx)));
          idx++;
        } else {
          const blank = document.createElement("div");
          blank.style.cssText = "width:" + side + "px;height:" + side + "px;opacity:0.02";
          host.appendChild(blank);
        }
      }
    }
    grid.appendChild(host);
  }

  function renderHex() {
    const host = document.createElement("div");
    host.className = "grid-hex";
    const ring = Math.floor((SHAPE.columns.length - 1) / 2);
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const dim = ring * 2 + 1;
    const size = Math.min(innerW / (dim * 1.05), innerH / (dim * 0.9));
    const w = size, h = size * 0.85;
    host.style.width  = (dim * w * 1.05 + 20) + "px";
    host.style.height = (dim * h + 20) + "px";
    SHAPE.cells.forEach((c, i) => {
      const q = c.hex ? c.hex.q : 0;
      const r = c.hex ? c.hex.r : 0;
      const x = (q + ring) * w * 1.0 + (r % 2 ? w * 0.5 : 0) + 10;
      const y = (r + ring) * h + 10;
      const el = makeCell(symAt(i), "hex");
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.width = w + "px";
      el.style.height = (h * 1.15) + "px";
      host.appendChild(el);
    });
    grid.appendChild(host);
  }

  function renderWheel() {
    const host = document.createElement("div");
    host.className = "grid-wheel";
    const segments = SHAPE.cells.length;
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "wheel-svg");
    svg.setAttribute("viewBox", "-100 -100 200 200");
    for (let i = 0; i < segments; i++) {
      const a0 = (i / segments) * 2 * Math.PI - Math.PI / 2;
      const a1 = ((i + 1) / segments) * 2 * Math.PI - Math.PI / 2;
      const x0 = Math.cos(a0) * 92, y0 = Math.sin(a0) * 92;
      const x1 = Math.cos(a1) * 92, y1 = Math.sin(a1) * 92;
      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", "M 0 0 L " + x0.toFixed(2) + " " + y0.toFixed(2) + " A 92 92 0 0 1 " + x1.toFixed(2) + " " + y1.toFixed(2) + " Z");
      path.setAttribute("fill", i % 2 ? "#1a2230" : "#0f1620");
      path.setAttribute("stroke", "${accent}");
      path.setAttribute("stroke-width", "0.5");
      svg.appendChild(path);
      const mid = (a0 + a1) / 2;
      const tx = Math.cos(mid) * 62, ty = Math.sin(mid) * 62;
      const tEl = document.createElementNS("http://www.w3.org/2000/svg", "text");
      tEl.setAttribute("x", tx.toFixed(2)); tEl.setAttribute("y", ty.toFixed(2));
      tEl.setAttribute("text-anchor", "middle"); tEl.setAttribute("dominant-baseline", "middle");
      tEl.setAttribute("fill", "${accent}");
      tEl.setAttribute("font-size", "8");
      tEl.setAttribute("font-weight", "700");
      tEl.textContent = String(symAt(i) || (i + 1));
      svg.appendChild(tEl);
    }
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderPlinko() {
    const host = document.createElement("div");
    host.className = "grid-plinko";
    let idx = 0;
    for (let r = 0; r < SHAPE.columns.length; r++) {
      const rowEl = document.createElement("div");
      rowEl.className = "plinko-row";
      const pegCount = SHAPE.columns[r].rows;
      for (let c = 0; c < pegCount; c++) {
        const peg = document.createElement("div");
        peg.className = "peg";
        rowEl.appendChild(peg);
        idx++;
      }
      host.appendChild(rowEl);
    }
    grid.appendChild(host);
  }

  function renderCrash() {
    const host = document.createElement("div");
    host.className = "grid-crash";
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "crash-curve");
    svg.setAttribute("viewBox", "0 0 320 180");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    let d = "M 0 180";
    for (let x = 0; x <= 320; x += 6) {
      const y = 180 - Math.pow(x / 320, 2) * 160 * 0.85;
      d += " L " + x + " " + y.toFixed(1);
    }
    path.setAttribute("d", d);
    path.setAttribute("stroke", "${accent}");
    path.setAttribute("stroke-width", "3");
    path.setAttribute("fill", "none");
    svg.appendChild(path);
    const txt = document.createElementNS("http://www.w3.org/2000/svg", "text");
    txt.setAttribute("x", "240"); txt.setAttribute("y", "40");
    txt.setAttribute("fill", "${accent}");
    txt.setAttribute("font-size", "24"); txt.setAttribute("font-weight", "800");
    txt.textContent = "1.00x";
    svg.appendChild(txt);
    host.appendChild(svg);
    grid.appendChild(host);
  }

  function renderSlingo() {
    const host = document.createElement("div");
    host.className = "grid-slingo";
    const innerH = grid.clientHeight || frame.clientHeight;
    const totalRows = 6 + 0.4; /* small visual separator */
    const side = (innerH - 12 - 6 * 5) / totalRows;
    const board = document.createElement("div");
    board.className = "grid-rect";
    board.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    board.style.gridTemplateRows = "repeat(5, " + side + "px)";
    for (let i = 0; i < 25; i++) board.appendChild(makeCell(symAt(i)));
    host.appendChild(board);
    const strip = document.createElement("div");
    strip.className = "grid-rect";
    strip.style.gridTemplateColumns = "repeat(5, " + side + "px)";
    strip.style.gridTemplateRows = side + "px";
    strip.style.marginTop = "12px";
    for (let i = 25; i < 30; i++) strip.appendChild(makeCell(symAt(i)));
    host.appendChild(strip);
    grid.appendChild(host);
  }

  function renderDual() {
    const wrap = document.createElement("div");
    wrap.style.cssText = "display:flex;gap:20px;align-items:center;width:100%;height:100%;justify-content:center";
    const sgRowsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].rows : ROWS;
    const sgReelsB = (SHAPE.subgrids && SHAPE.subgrids[0]) ? SHAPE.subgrids[0].reels : REELS;
    const innerW = (grid.clientWidth || frame.clientWidth) - 30;
    const innerH = grid.clientHeight || frame.clientHeight;
    const gap = 4;
    const halfW = innerW / 2;
    const sideA = Math.min(
      (halfW - gap * (REELS - 1)) / REELS,
      (innerH - gap * (ROWS - 1)) / ROWS,
    );
    const sideB = Math.min(
      (halfW - gap * (sgReelsB - 1)) / sgReelsB,
      (innerH - gap * (sgRowsB - 1)) / sgRowsB,
    );
    /* primary */
    const a = document.createElement("div");
    a.className = "grid-rect";
    a.style.gridTemplateColumns = "repeat(" + REELS + ", " + sideA + "px)";
    a.style.gridTemplateRows = "repeat(" + ROWS + ", " + sideA + "px)";
    a.style.gap = gap + "px";
    const primCells = SHAPE.totalCells || REELS * ROWS;
    for (let i = 0; i < primCells; i++) {
      const el = makeCell(symAt(i));
      el.style.fontSize = (sideA * 0.32) + "px";
      a.appendChild(el);
    }
    wrap.appendChild(a);
    if (SHAPE.subgrids && SHAPE.subgrids[0]) {
      const sg = SHAPE.subgrids[0];
      const b = document.createElement("div");
      b.className = "grid-rect";
      b.style.gridTemplateColumns = "repeat(" + sg.reels + ", " + sideB + "px)";
      b.style.gridTemplateRows = "repeat(" + sg.rows + ", " + sideB + "px)";
      b.style.gap = gap + "px";
      for (let i = 0; i < sg.totalCells; i++) {
        const el = makeCell(symAt(primCells + i));
        el.style.fontSize = Math.max(8, sideB * 0.32) + "px";
        b.appendChild(el);
      }
      wrap.appendChild(b);
    }
    grid.appendChild(wrap);
  }

  /* Dispatch */
  function renderGrid() {
    grid.innerHTML = "";
    /* Re-attach the payline SVG overlay after every render — innerHTML
       wipe blows away the static node from initial HTML. Idempotent. */
    if (typeof ensurePaylineOverlay === 'function') ensurePaylineOverlay();
    switch (SHAPE.kind) {
      case "rectangular":
      case "cluster":
      case "lock_respin":
      case "megaclusters":
      case "infinity":
      case "expanding":
      case "variable_reel":
      case "diamond":
      case "pyramid":
      case "cross":
      case "l_shape":
        return renderRect();
      case "hexagonal":
        return renderHex();
      case "radial":
      case "wheel":
        return renderWheel();
      case "plinko":
        return renderPlinko();
      case "crash":
        return renderCrash();
      case "slingo":
        return renderSlingo();
      case "dual":
        return renderDual();
      default:
        return renderRect();
    }
  }

  /* Initial render + responsive on resize */
  function fit() { renderGrid(); }
  window.addEventListener("resize", fit);
  /* run after first layout pass so .frame has measured dimensions */
  requestAnimationFrame(fit);
`;
}
