/**
 * Slot GDD Factory · paylineOverlay BLOCK
 *
 * Browser-side SVG overlay that renders ONE polyline per win event through
 * the geometric centres of matched cells, with a leftmost line-number badge.
 *
 * This block is unusual among lego pieces: it lives at *runtime* in the
 * built HTML, not on the Node server side, because it manipulates the DOM
 * (`document.createElementNS`, `getBoundingClientRect`). So the public API
 * is a single string-emitter `emitPaylineOverlayRuntime()` that the
 * orchestrator (`buildSlotHTML.mjs`) splices into the inline `<script>` tag.
 *
 * Public API:
 *   emitPaylineOverlayRuntime()  → string of JS to be injected into the
 *                                   runtime <script> tag
 *
 * Runtime contract (after the emitted code executes):
 *   • `ensurePaylineOverlay()`     → SVG node, idempotent
 *   • `clearPaylineOverlay()`      → wipes children
 *   • `drawPaylineOverlay(event)`  → renders ONE event (polyline + badge)
 *   • `cellCenterInGrid(cell, r)`  → helper for the cycle module
 *
 * Required runtime dependencies (must exist in the enclosing scope of the
 * emitted code — the orchestrator wires them):
 *   • `grid`  — the gridHost DOM node (already declared upstream)
 *
 * Geometry model (matches WoO reference 1:1):
 *   • SVG sized to gridHost client rect (viewBox = "0 0 W H")
 *   • Each cell's center = getBoundingClientRect mid-point, translated
 *     into gridHost-local coordinates
 *   • Polyline points = "x0,y0 x1,y1 ... xN,yN"
 *   • Stroke colored by tier (HP gold, MP cyan, LP bronze, WILD magenta)
 *   • Badge = circle + line-number text, anchored at (x0 - 22, y0)
 *     clamped to the SVG viewport so it stays visible.
 *
 * Idempotent: ensurePaylineOverlay re-creates the SVG node if missing
 * (renderGrid wipes innerHTML at startup), so callers can rely on the
 * overlay existing whenever they call drawPaylineOverlay.
 */

/* Emit the runtime JS source as a string. Pure function — no parameters yet,
   but the signature accepts a config slot for future per-game overrides
   (custom badge offset, alternative tier→color mapping etc.). */
export function emitPaylineOverlayRuntime(/* config = {} */) {
  return `
  /* ── Payline SVG overlay — emitted by src/blocks/paylineOverlay.mjs ────
     Boki rule: "ne sme nigde da se animira po jedan simbol nego cele win
     linije sa tim simbolom u toj win liniji i tako svaka win linija
     posebno." → every winning payline gets ITS OWN polyline drawn
     through the geometric centers of its matched cells, with the symbol
     cells pulsing simultaneously and a leftmost line-number badge. */
  let PAYLINE_SVG = null;
  function ensurePaylineOverlay() {
    PAYLINE_SVG = document.getElementById('paylineOverlay');
    if (!PAYLINE_SVG) {
      const ns = 'http://www.w3.org/2000/svg';
      PAYLINE_SVG = document.createElementNS(ns, 'svg');
      PAYLINE_SVG.setAttribute('id', 'paylineOverlay');
      PAYLINE_SVG.setAttribute('class', 'payline-overlay');
      PAYLINE_SVG.setAttribute('aria-hidden', 'true');
      grid.appendChild(PAYLINE_SVG);
    }
    return PAYLINE_SVG;
  }
  function clearPaylineOverlay() {
    const svg = ensurePaylineOverlay();
    while (svg.firstChild) svg.removeChild(svg.firstChild);
  }
  /* Convert a DOM cell node into a center-point in gridHost-local
     pixel coordinates. Returns null if the cell has zero bounds (off-
     screen / unmounted). */
  function cellCenterInGrid(cell, gridRect) {
    if (!cell) return null;
    const r = cell.getBoundingClientRect();
    if (!r || (r.width === 0 && r.height === 0)) return null;
    return {
      x: (r.left + r.width  / 2) - gridRect.left,
      y: (r.top  + r.height / 2) - gridRect.top,
    };
  }
  function drawPaylineOverlay(event) {
    const svg = ensurePaylineOverlay();
    clearPaylineOverlay();
    if (!event || !Array.isArray(event.cells) || event.cells.length < 2) return;
    const gridRect = grid.getBoundingClientRect();
    if (!gridRect || gridRect.width === 0 || gridRect.height === 0) return;
    /* Size the SVG to the gridHost — viewBox tracks the live pixel size
       so polyline coordinates render 1:1 with the cell layout. */
    svg.setAttribute('width',  String(gridRect.width));
    svg.setAttribute('height', String(gridRect.height));
    svg.setAttribute('viewBox', '0 0 ' + gridRect.width + ' ' + gridRect.height);
    const pts = [];
    for (const c of event.cells) {
      const p = cellCenterInGrid(c, gridRect);
      if (p) pts.push(p);
    }
    if (pts.length < 2) return;
    const tier = event.tier || 'LP';
    const ns = 'http://www.w3.org/2000/svg';
    /* Polyline through every matched cell center. */
    const poly = document.createElementNS(ns, 'polyline');
    poly.setAttribute('class', 'payline-path tier-' + tier);
    poly.setAttribute('points', pts.map(p => p.x.toFixed(1) + ',' + p.y.toFixed(1)).join(' '));
    /* Set the dash length custom prop so the draw-in keyframe runs the
       full visible length, not the default 1000px placeholder. */
    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      pathLen += Math.sqrt(dx * dx + dy * dy);
    }
    poly.style.setProperty('--payline-len', String(Math.ceil(pathLen) + 10));
    svg.appendChild(poly);
    /* Line-number badge anchored just left of the leftmost endpoint.
       Clamped so it stays inside the SVG viewport even on narrow grids. */
    if (typeof event.lineIndex === 'number') {
      const bx = Math.max(14, pts[0].x - 22);
      const by = Math.max(14, Math.min(gridRect.height - 14, pts[0].y));
      const badgeR = 12;
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', 'payline-badge tier-' + tier);
      circle.setAttribute('cx', String(bx));
      circle.setAttribute('cy', String(by));
      circle.setAttribute('r',  String(badgeR));
      svg.appendChild(circle);
      const t = document.createElementNS(ns, 'text');
      t.setAttribute('class', 'payline-badge-text');
      t.setAttribute('x', String(bx));
      t.setAttribute('y', String(by));
      t.textContent = String(event.lineIndex + 1);
      svg.appendChild(t);
    }
  }
`;
}
