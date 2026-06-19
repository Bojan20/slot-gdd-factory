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

import { applyGridProfile } from '../registry/gridProfile.mjs';

/* Industry-baseline tier palette. RGB triplets so rgba() interpolation in
 * the CSS template works without re-parsing hex codes. */
const DEFAULTS = Object.freeze({
  enabled: true,
  strokeWidth: 4.5,
  drawInMs: 220,
  badgeRadius: 12,
  zIndex: 6,
  badgePadFromStart: 22,
  badgeEdgePad: 14,
  badgeFontPx: 11,
  dashPlaceholder: 1000,
  dashBuffer: 10,
  /* tier → ["stroke hex", "glow rgba"] */
  tierColors: Object.freeze({
    HP:   { stroke: '#ffc85a', glow: '255, 200,  90' },
    MP:   { stroke: '#7ec8e3', glow: '126, 200, 227' },
    LP:   { stroke: '#d29560', glow: '210, 149,  96' },
    WILD: { stroke: '#e070c0', glow: '224, 112, 192' },
  }),
  /* drop-shadow blur + alpha per tier (and base path) */
  glow: Object.freeze({
    base: Object.freeze({ blurPx: 6, alpha: 0.55 }),
    HP:   Object.freeze({ blurPx: 8, alpha: 0.85 }),
    MP:   Object.freeze({ blurPx: 7, alpha: 0.75 }),
    LP:   Object.freeze({ blurPx: 6, alpha: 0.70 }),
    WILD: Object.freeze({ blurPx: 8, alpha: 0.80 }),
  }),
});

export function defaultConfig() {
  return Object.freeze({
    enabled: DEFAULTS.enabled,
    strokeWidth: DEFAULTS.strokeWidth,
    drawInMs: DEFAULTS.drawInMs,
    badgeRadius: DEFAULTS.badgeRadius,
    zIndex: DEFAULTS.zIndex,
    badgePadFromStart: DEFAULTS.badgePadFromStart,
    badgeEdgePad: DEFAULTS.badgeEdgePad,
    badgeFontPx: DEFAULTS.badgeFontPx,
    dashPlaceholder: DEFAULTS.dashPlaceholder,
    dashBuffer: DEFAULTS.dashBuffer,
    tierColors: Object.fromEntries(
      Object.entries(DEFAULTS.tierColors).map(([k, v]) => [k, { ...v }])
    ),
    glow: Object.fromEntries(
      Object.entries(DEFAULTS.glow).map(([k, v]) => [k, { ...v }])
    ),
  });
}

export function resolveConfig(model = {}) {
  /* Wave UD — start from global baseline, then apply per-`SHAPE.kind`
     contextual override (gridProfile registry), then let explicit GDD
     model values win on top. Order is intentional: baseline → context →
     explicit so a GDD always has the final word. */
  let cfg = { ...applyGridProfile('paylineOverlay', defaultConfig(), model) };
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
      if (t && typeof t.stroke === 'string' && /^#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(t.stroke)
           && typeof t.glow === 'string'   && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(t.glow)) {
        cfg.tierColors[tier] = { stroke: t.stroke, glow: t.glow.replace(/\s+/g, '') };
      }
    }
  }
  return cfg;
}

/* CSS string — pulled out of buildSlotHTML.mjs in Wave T-slim.
 * Accepts either a resolved cfg object or a full `{ paylineOverlay: {…} }`
 * model. Detects shape so we don't double-wrap and re-apply `applyGridProfile`
 * on top of an already-resolved baseline. */
export function emitPaylineOverlayCSS(cfgOrModel = {}) {
  const c = (cfgOrModel && cfgOrModel.paylineOverlay)
    ? resolveConfig(cfgOrModel)
    : resolveConfig({ paylineOverlay: cfgOrModel });
  if (!c.enabled) return '';
  const t = c.tierColors;
  const g = c.glow;
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
    z-index: ${c.zIndex};
    overflow: visible;
  }
  .payline-path {
    fill: none;
    stroke-width: ${c.strokeWidth};
    stroke-linecap: round;
    stroke-linejoin: round;
    filter: drop-shadow(0 0 ${g.base.blurPx}px rgba(255, 196, 90, ${g.base.alpha}));
    stroke-dasharray: var(--payline-len, ${c.dashPlaceholder});
    stroke-dashoffset: var(--payline-len, ${c.dashPlaceholder});
    animation: payline-draw ${c.drawInMs}ms ease-out forwards;
  }
  @keyframes payline-draw {
    to { stroke-dashoffset: 0; }
  }
  .payline-path.tier-HP   { stroke: ${t.HP.stroke};   filter: drop-shadow(0 0 ${g.HP.blurPx}px rgba(${t.HP.glow},   ${g.HP.alpha})); }
  .payline-path.tier-MP   { stroke: ${t.MP.stroke};   filter: drop-shadow(0 0 ${g.MP.blurPx}px rgba(${t.MP.glow},   ${g.MP.alpha})); }
  .payline-path.tier-LP   { stroke: ${t.LP.stroke};   filter: drop-shadow(0 0 ${g.LP.blurPx}px rgba(${t.LP.glow},   ${g.LP.alpha})); }
  .payline-path.tier-WILD { stroke: ${t.WILD.stroke}; filter: drop-shadow(0 0 ${g.WILD.blurPx}px rgba(${t.WILD.glow}, ${g.WILD.alpha})); }
  .payline-badge {
    fill: rgba(15, 12, 10, 0.92);
    stroke-width: 1.5;
  }
  .payline-badge.tier-HP   { stroke: ${t.HP.stroke}; }
  .payline-badge.tier-MP   { stroke: ${t.MP.stroke}; }
  .payline-badge.tier-LP   { stroke: ${t.LP.stroke}; }
  .payline-badge.tier-WILD { stroke: ${t.WILD.stroke}; }
  .payline-badge-text {
    font: 800 ${c.badgeFontPx}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
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

/* Emit the runtime JS source as a string. Accepts the same shape as
 * `emitPaylineOverlayCSS` so the orchestrator can pass either a resolved
 * cfg or a full model. Tunables resolved from cfg are inlined into the
 * emitted runtime as plain JS constants (no `window.*` plumbing needed). */
export function emitPaylineOverlayRuntime(cfgOrModel = {}) {
  const c = (cfgOrModel && cfgOrModel.paylineOverlay)
    ? resolveConfig(cfgOrModel)
    : resolveConfig({ paylineOverlay: cfgOrModel });
  return `
  /* ── Payline SVG overlay — emitted by src/blocks/paylineOverlay.mjs ────
     Boki rule: "ne sme nigde da se animira po jedan simbol nego cele win
     linije sa tim simbolom u toj win liniji i tako svaka win linija
     posebno." → every winning payline gets ITS OWN polyline drawn
     through the geometric centers of its matched cells, with the symbol
     cells pulsing simultaneously and a leftmost line-number badge. */
  const BADGE_R = ${c.badgeRadius};
  const BADGE_OFFSET_X = ${c.badgePadFromStart};
  const BADGE_EDGE_PAD = ${c.badgeEdgePad};
  const DASH_BUFFER = ${c.dashBuffer};
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
     pixel coordinates. Returns null if:
       - cell is null/undefined
       - cell is not a DOM element (string/stale ref from cluster /
         tumble eval where post-gravity cells got nulled or stringified)
       - cell has zero bounds (off-screen / unmounted)
     Wave D-3 hardening — Bokijev imperative "svaki jebeni blok": starlight
     6×7 grid + cluster eval emits ev.cells with stale refs after gravity.
     Defensive typeof check prevents TypeError on .getBoundingClientRect()
     when caller passes a non-DOM object. */
  function cellCenterInGrid(cell, gridRect) {
    if (!cell || typeof cell.getBoundingClientRect !== 'function') return null;
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
       full visible length, not the default placeholder. */
    let pathLen = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = pts[i].x - pts[i - 1].x;
      const dy = pts[i].y - pts[i - 1].y;
      pathLen += Math.sqrt(dx * dx + dy * dy);
    }
    poly.style.setProperty('--payline-len', String(Math.ceil(pathLen) + DASH_BUFFER));
    svg.appendChild(poly);
    /* Line-number badge anchored just left of the leftmost endpoint.
       Clamped so it stays inside the SVG viewport even on narrow grids. */
    if (typeof event.lineIndex === 'number') {
      const bx = Math.max(BADGE_EDGE_PAD, pts[0].x - BADGE_OFFSET_X);
      const by = Math.max(BADGE_EDGE_PAD, Math.min(gridRect.height - BADGE_EDGE_PAD, pts[0].y));
      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('class', 'payline-badge tier-' + tier);
      circle.setAttribute('cx', String(bx));
      circle.setAttribute('cy', String(by));
      circle.setAttribute('r',  String(BADGE_R));
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
