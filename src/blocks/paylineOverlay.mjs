/**
 * Slot GDD Factory · paylineOverlay BLOCK
 *
 * Browser-side SVG overlay that renders ONE polyline per win event through
 * the geometric centres of matched cells, with a leftmost line-number badge.
 *
 * This block is unusual among lego pieces: it lives at *runtime* in the
 * built HTML, not on the Node server side, because it manipulates the DOM
 * (`document.createElementNS`, `getBoundingClientRect`). So the public API
 * is a string-emitter `emitPaylineOverlayRuntime()` that the orchestrator
 * (`buildSlotHTML.mjs`) splices into the inline `<script>` tag.
 *
 * Wave T-slim: `emitPaylineOverlayCSS()` is also exposed so the orchestrator
 * no longer carries the 55-LOC payline CSS inline. Tier colors are kept
 * frozen here so a future config layer can override per game without
 * touching the orchestrator.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitPaylineOverlayCSS(cfg)   → .payline-overlay + tier classes
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
 * Geometry model (line-pays reference 1:1):
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

/* Industry-baseline tier palette. RGB triplets so rgba() interpolation in
 * the CSS template works without re-parsing hex codes. */
const DEFAULTS = Object.freeze({
  enabled: true,
  strokeWidth: 4.5,
  drawInMs: 220,
  badgeRadius: 12,
  /* tier → ["stroke hex", "glow rgba"] */
  tierColors: Object.freeze({
    HP:   { stroke: '#ffc85a', glow: '255, 200,  90' },
    MP:   { stroke: '#7ec8e3', glow: '126, 200, 227' },
    LP:   { stroke: '#d29560', glow: '210, 149,  96' },
    WILD: { stroke: '#e070c0', glow: '224, 112, 192' },
  }),
});

import { applyGridProfile } from '../registry/gridProfile.mjs';

export function defaultConfig() {
  return {
    enabled: DEFAULTS.enabled,
    strokeWidth: DEFAULTS.strokeWidth,
    drawInMs: DEFAULTS.drawInMs,
    badgeRadius: DEFAULTS.badgeRadius,
    tierColors: { ...DEFAULTS.tierColors },
  };
}

export function resolveConfig(model = {}) {
  /* Wave UD — start from global baseline, then apply per-`SHAPE.kind`
     contextual override (gridProfile registry), then let explicit GDD
     model values win on top. Order is intentional: baseline → context →
     explicit so a GDD always has the final word. */
  let cfg = applyGridProfile('paylineOverlay', defaultConfig(), model);
  const m = (model && model.paylineOverlay) || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.strokeWidth))  cfg.strokeWidth = Math.max(1, Math.min(12, Number(m.strokeWidth)));
  if (Number.isFinite(m.drawInMs))     cfg.drawInMs    = Math.max(60, Math.min(2000, Math.round(m.drawInMs)));
  if (Number.isFinite(m.badgeRadius))  cfg.badgeRadius = Math.max(6, Math.min(32, Math.round(m.badgeRadius)));
  /* Defensive merge of tierColors — accept only HP/MP/LP/WILD keys with
   * the right shape. Anything else is silently ignored. */
  if (m.tierColors && typeof m.tierColors === 'object') {
    for (const tier of ['HP', 'MP', 'LP', 'WILD']) {
      const t = m.tierColors[tier];
      if (t && typeof t.stroke === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(t.stroke)
           && typeof t.glow === 'string'   && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(t.glow)) {
        cfg.tierColors[tier] = { stroke: t.stroke, glow: t.glow.replace(/\s+/g, '') };
      }
    }
  }
  return cfg;
}

/* CSS string — pulled out of buildSlotHTML.mjs in Wave T-slim. */
export function emitPaylineOverlayCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ paylineOverlay: cfg });
  if (!c.enabled) return '';
  const t = c.tierColors;
  return `
  /* ── Payline overlay (SVG) — emitted by src/blocks/paylineOverlay.mjs
     Absolute layer over the entire gridHost. Each winning payline draws
     ONE <polyline> through the geometric centers of its matched cells,
     colored by tier. A round number-badge floats at the leftmost
     endpoint so the player reads "LINE 4" at a glance. SVG drawn at the
     gridHost dimensions in pixel space (viewBox = "0 0 W H"), updated on
     each cycle step. */
  .payline-overlay {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    z-index: 6;
    overflow: visible;
  }
  .payline-path {
    fill: none;
    stroke-width: ${c.strokeWidth};
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 6px rgba(255, 196, 90, 0.55));
    stroke-dasharray: var(--payline-len, 1000);
    stroke-dashoffset: var(--payline-len, 1000);
    animation: payline-draw ${c.drawInMs}ms ease-out forwards;
  }
  @keyframes payline-draw {
    to { stroke-dashoffset: 0; }
  }
  .payline-path.tier-HP   { stroke: ${t.HP.stroke};   filter: drop-shadow(0 0 8px rgba(${t.HP.glow},   0.85)); }
  .payline-path.tier-MP   { stroke: ${t.MP.stroke};   filter: drop-shadow(0 0 7px rgba(${t.MP.glow},   0.75)); }
  .payline-path.tier-LP   { stroke: ${t.LP.stroke};   filter: drop-shadow(0 0 6px rgba(${t.LP.glow},   0.70)); }
  .payline-path.tier-WILD { stroke: ${t.WILD.stroke}; filter: drop-shadow(0 0 8px rgba(${t.WILD.glow}, 0.80)); }
  .payline-badge {
    fill: rgba(15, 12, 10, 0.92);
    stroke-width: 1.5;
  }
  .payline-badge.tier-HP   { stroke: ${t.HP.stroke}; }
  .payline-badge.tier-MP   { stroke: ${t.MP.stroke}; }
  .payline-badge.tier-LP   { stroke: ${t.LP.stroke}; }
  .payline-badge.tier-WILD { stroke: ${t.WILD.stroke}; }
  .payline-badge-text {
    font: 800 11px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    fill: #f2f2f2;
    text-anchor: middle;
    dominant-baseline: central;
    letter-spacing: 0.5px;
  }
  @media (prefers-reduced-motion: reduce) {
    .payline-path { animation: none; stroke-dashoffset: 0; }
  }
`;
}

/* Emit the runtime JS source as a string. */
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
