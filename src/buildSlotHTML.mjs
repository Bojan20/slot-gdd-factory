/**
 * Slot GDD Factory · build standalone playable slot HTML — BASE GAME ONLY.
 *
 * Static grid render. No animations, no spin/bet/autoplay controls,
 * no HUD, no footer. Grid is centered in the viewport with reference-grade
 * dimensions (frame inset, gap, cell radius, shadows, palette) extracted
 * from an industry reference base game.
 *
 * Dimensions reference (vendor-neutral):
 *   • Frame:        min(1200px, 82vw) × min(732px, 82vw·0.61)  — 1.64:1
 *   • Frame inset:  18px from frame edge to first cell
 *   • Cell gap:     6px between cells
 *   • Cell radius:  10px
 *   • Frame radius: 16px
 *   • Shadow:       0 20px 60px rgba(0,0,0,.5), inset 0 0 80px rgba(0,0,0,.3)
 *
 * Palette tokens (from theme.palette[] override these if present):
 *   --bg0  #05070c   deep blue-black
 *   --bg1  #0b0f16   mid background
 *   --gold #c9a227   primary accent
 *   --text #f2f2f2   default text
 *
 * Same module is consumed by app.js (browser tab) and tests (Node + Playwright).
 */
import { buildGridShape } from './gridShape.mjs';
import { paylineConfig } from './blocks/paylines.mjs';
import { emitPaylineOverlayRuntime } from './blocks/paylineOverlay.mjs';
import {
  emitWinPresentationRuntime,
  emitDetectWinCombosRuntime,
  resolveConfig as resolveWinPresentationConfig,
} from './blocks/winPresentation.mjs';
import {
  emitScatterCelebrationCSS,
  emitScatterCelebrationRuntime,
  resolveConfig as resolveScatterCelebrationConfig,
} from './blocks/scatterCelebration.mjs';
import {
  emitStageBadgeCSS,
  emitStageBadgeMarkup,
  emitStageBadgeRuntime,
  resolveConfig as resolveStageBadgeConfig,
} from './blocks/stageBadge.mjs';
import {
  emitAnticipationCSS,
  emitAnticipationRuntime,
  resolveConfig as resolveAnticipationConfig,
} from './blocks/anticipation.mjs';
import {
  emitSpinTempoRuntime,
  resolveConfig as resolveSpinTempoConfig,
} from './blocks/spinTempo.mjs';
import {
  emitFreeSpinsCSS,
  emitFreeSpinsHudMarkup,
  emitFreeSpinsToastMarkup,
  emitFreeSpinsOverlayMarkup,
  emitFreeSpinsRuntime,
  resolveConfig as resolveFreeSpinsConfig,
} from './blocks/freeSpins.mjs';
import {
  emitReelEngineCSS,
  resolveConfig as resolveReelEngineConfig,
} from './blocks/reelEngineCSS.mjs';
import {
  emitTriggerCountingRuntime,
  resolveConfig as resolveTriggerCountingConfig,
} from './blocks/triggerCounting.mjs';
import {
  emitPostSpinRuntime,
  resolveConfig as resolvePostSpinConfig,
} from './blocks/postSpin.mjs';

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

/* Build the base-game-only standalone HTML for a parsed model. */
export function buildSlotHTML(model) {
  const allSyms = [
    ...model.symbols.specials, ...model.symbols.high,
    ...model.symbols.mid, ...model.symbols.low,
  ];
  /* Fallback if GDD declared no symbols */
  const pool = allSyms.length > 0 ? allSyms : [
    { id: "W", name: "Wild" }, { id: "S", name: "Scatter" },
    { id: "A", name: "Ace" }, { id: "K", name: "King" }, { id: "Q", name: "Queen" },
    { id: "J", name: "Jack" }, { id: "T", name: "Ten" }, { id: "9", name: "Nine" },
  ];
  /* ── Symbol registry for the win-cycle module ────────────────────────
     Classifies every symbol so detectWinCombos knows:
       • regularPay — HP/MP/LP, candidates for win-lines (each unique
         id with >=3 hits becomes ONE event)
       • wild — substitutes for any regular symbol; its cells join EVERY
         regular event (lit alongside the real symbol)
       • scatter — NEVER part of a win-line (trigger-only)
       • tier — 'HP' | 'MP' | 'LP' | 'WILD' (drives sort order so HP
         events fire first, then MP, then LP) */
  const _highIds = (model.symbols.high  || []).map(s => String(s.id).toUpperCase());
  const _midIds  = (model.symbols.mid   || []).map(s => String(s.id).toUpperCase());
  const _lowIds  = (model.symbols.low   || []).map(s => String(s.id).toUpperCase());
  const _specials = model.symbols.specials || [];
  const _wildSym = _specials.find(s => /wild/i.test(s.name || ''));
  const _scatterSym = _specials.find(s => /scatter|bonus|trigger/i.test(s.name || ''));
  const SYMBOL_REGISTRY = {
    regularPay: [..._highIds, ..._midIds, ..._lowIds],
    wild:    _wildSym    ? String(_wildSym.id).toUpperCase()    : null,
    scatter: _scatterSym ? String(_scatterSym.id).toUpperCase() : null,
    tier: Object.assign({},
      Object.fromEntries(_highIds.map(id => [id, 'HP'])),
      Object.fromEntries(_midIds .map(id => [id, 'MP'])),
      Object.fromEntries(_lowIds .map(id => [id, 'LP'])),
      _wildSym ? { [String(_wildSym.id).toUpperCase()]: 'WILD' } : {}
    ),
  };
  const shape = buildGridShape(model);
  /* ── Payline pool (LEGO-block delegation) ───────────────────────────────
     Server-side payline synthesis lives in `src/blocks/paylines.mjs`. This
     builder is now a pure orchestrator — it asks the block for the pool
     and trusts whatever it gets back. GDD-driven: if the parsed model
     declared an explicit pool (model.winPresentation.paylines), the block
     returns that verbatim; otherwise the industry-standard set for the
     grid kind. Empty pool = cluster/ways/wheel/SVG mode downstream. */
  const _payCfg = paylineConfig(model, shape);
  const PAYLINE_POOL = _payCfg.pool;
  const reels = shape.reels;
  const rows  = shape.rows;

  /* Palette — use GDD palette[] if available, else reference defaults */
  const p = model.theme.palette || [];
  const bg0    = p[0] || "#05070c";   // deep background
  const bg1    = p[1] || "#0b0f16";   // mid background
  const accent = p[2] || "#c9a227";   // primary accent (gold)
  const text   = "#f2f2f2";

  const layoutSub = `${shape.shapeNote}${shape.paylines ? ` · ${shape.paylines} lines` : ''}${shape.wayCount ? ` · ${shape.wayCount} ways` : ''}`;

  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8"><title>${escapeHtml(model.name)} · Base Game</title>
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
:root {
  --bg0: ${bg0};
  --bg1: ${bg1};
  --accent: ${accent};
  --text: ${text};
  --frame-inset: 18px;
  --cell-gap: 6px;
  --cell-radius: 10px;
  --frame-radius: 16px;
  --frame-shadow: 0 20px 60px rgba(0,0,0,0.55), inset 0 0 80px rgba(0,0,0,0.35);
}
html, body { width: 100%; height: 100%; }
body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  /* Light slate blue-gray full-body pozadina — cells su #1a2230 (dark
     blue-black), ovaj svetliji ton (~4.5:1 kontrast) ih jasno odvaja
     i daje "screen on a stage" osećaj kao casino floor cabinet. */
  background: #5a6b88;
  color: var(--text);
  min-height: 100vh;
  display: grid;
  place-items: center;
  overflow: hidden;
}
.stage {
  display: grid;
  grid-template-rows: auto 1fr auto;
  grid-template-areas:
    "header"
    "play"
    "hub";
  width: 100%;
  height: 100vh;
  max-width: 1440px;
  margin: 0 auto;
  padding: clamp(8px, 1.5vw, 18px) clamp(8px, 2vw, 24px);
  gap: clamp(6px, 1vw, 12px);
}
.header { grid-area: header; display: flex; flex-direction: column; align-items: center; gap: 2px; }
.title {
  color: var(--accent);
  font-size: 1.25rem;
  font-weight: 800;
  letter-spacing: 1px;
  text-shadow: 0 2px 12px rgba(0,0,0,0.6);
}
.sub {
  color: var(--text);
  opacity: 0.5;
  font-size: 0.7rem;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}
${emitStageBadgeCSS(resolveStageBadgeConfig(model))}
/* Play area — symmetrical 3-column layout on desktop so the frame is
   perfectly horizontally centered. Left column is a transparent spacer
   the same width as the right SPIN rail. On smaller screens we collapse
   to a single column and move SPIN underneath the grid (see below). */
.play {
  grid-area: play;
  display: grid;
  grid-template-columns: var(--spin-rail) minmax(0, 1fr) var(--spin-rail);
  grid-template-areas: "leftSpacer frame sideHud";
  gap: clamp(8px, 1.4vw, 18px);
  align-items: stretch;
  min-height: 0;
}
.frame    { grid-area: frame; }
.sideHud  { grid-area: sideHud; }
.leftSpacer { grid-area: leftSpacer; pointer-events: none; visibility: hidden; }
:root { --spin-rail: 168px; --spin-size: 150px; --spin-auto-size: 58px; }
@media (max-width: 1100px) { :root { --spin-rail: 140px; --spin-size: 120px; --spin-auto-size: 50px; } }
@media (max-width: 920px)  { :root { --spin-rail: 110px; --spin-size: 96px;  --spin-auto-size: 42px; } }
/* Mobile / small screens — collapse to vertical stack:
   frame on top, SPIN+AUTO row underneath, hub at the bottom. */
@media (max-width: 820px) {
  :root { --spin-size: 88px; --spin-auto-size: 42px; }
  .play {
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 1fr auto;
    grid-template-areas:
      "frame"
      "sideHud";
    gap: 10px;
  }
  .leftSpacer { display: none; }
  .sideHud {
    flex-direction: row;
    justify-content: center;
    gap: 22px;
    padding: 4px 0;
  }
}
@media (max-width: 620px) {
  :root { --spin-size: 76px; --spin-auto-size: 38px; }
  .stage { padding: 6px 8px; gap: 6px; }
  .title { font-size: 1rem !important; }
  .sub { font-size: 0.65rem !important; }
  .statBox__label { font-size: 0.5rem !important; }
  .statBox__value { font-size: 0.85rem !important; }
  .sideHud { gap: 16px; }
}
.frame {
  position: relative;
  background: transparent;
  border: none;
  box-shadow: none;
  padding: var(--frame-inset);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  min-height: 0;
  min-width: 0;
}
/* Side controls — vertical SPIN button column on the right of the frame */
.sideHud {
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 16px;
}
/* SPIN button — reference base game dimensions (150px desktop), 3D metal
   gold border + multi-layer radial gradient. Industry-standard circular
   "refresh / two arrows" icon used by most major slot vendors. */
.spinBtn {
  width: var(--spin-size);
  height: var(--spin-size);
  padding: 0;
  border-radius: 50%;
  border: 5px solid;
  border-color: #dbb840 #b08a18 #8b6914 #c9a227;
  cursor: pointer;
  background:
    radial-gradient(ellipse 70% 40% at 50% 15%, rgba(255, 250, 220, 0.5) 0%, transparent 70%),
    radial-gradient(circle at 50% 50%, rgba(217, 180, 74, 0.45) 0%, transparent 60%),
    radial-gradient(ellipse 80% 50% at 50% 85%, rgba(0, 0, 0, 0.6) 0%, transparent 60%),
    linear-gradient(180deg, #3c3223 0%, #231e14 50%, #19140f 100%);
  box-shadow:
    inset 0 3px 6px rgba(255, 230, 150, 0.22),
    inset 0 -4px 8px rgba(0, 0, 0, 0.45),
    0 0 35px rgba(217, 180, 74, 0.25),
    0 0 60px rgba(217, 180, 74, 0.15),
    0 10px 35px rgba(0, 0, 0, 0.5),
    0 25px 60px rgba(0, 0, 0, 0.4);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform 0.25s cubic-bezier(0.34, 1.56, 0.64, 1),
              box-shadow 0.2s ease-out;
}
.spinBtn:hover {
  transform: scale(1.05);
  box-shadow:
    inset 0 3px 6px rgba(255, 230, 150, 0.3),
    inset 0 -4px 8px rgba(0, 0, 0, 0.45),
    0 0 50px rgba(217, 180, 74, 0.45),
    0 0 90px rgba(217, 180, 74, 0.2),
    0 12px 40px rgba(0, 0, 0, 0.55),
    0 28px 70px rgba(0, 0, 0, 0.42);
}
.spinBtn:active { transform: scale(0.97); }
.spinBtn svg {
  width: 52%;
  height: 52%;
  stroke: var(--accent);
  fill: none;
  stroke-width: 2.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.65));
}
.autoBtn {
  width: var(--spin-auto-size);
  height: var(--spin-auto-size);
  border-radius: 50%;
  border: 1px solid rgba(201, 162, 39, 0.4);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  color: var(--accent);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow:
    inset 0 1px 0 rgba(255, 230, 168, 0.08),
    0 2px 8px rgba(0, 0, 0, 0.45);
}
.autoBtn svg { width: 45%; height: 45%; }
/* Bottom bar — BAL | STATUS | BET-/BET/BET+ | SOUND */
.hub {
  grid-area: hub;
  display: grid;
  grid-template-columns: 40px minmax(110px, 1fr) minmax(150px, 1.5fr) minmax(150px, 1fr) 40px;
  align-items: center;
  gap: clamp(6px, 1vw, 12px);
  padding: clamp(6px, 1vw, 10px) clamp(8px, 1.5vw, 16px);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.7), rgba(10, 8, 6, 0.85));
  border: 1px solid rgba(201, 162, 39, 0.22);
  border-radius: 14px;
  box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.05), 0 4px 14px rgba(0, 0, 0, 0.45);
}
@media (max-width: 820px) {
  /* Bottom hub on tablets and below — keep all 5 fields in a single row but
     tighter, since the SPIN column is no longer to the right of the frame. */
  .hub {
    grid-template-columns: 36px minmax(80px, 1fr) minmax(110px, 1.5fr) minmax(110px, 1fr) 36px;
    padding: 8px 10px;
    gap: 8px;
  }
}
@media (max-width: 620px) {
  /* Phone — stack hub into a centered 2-row layout so balance + bet are
     comfortable thumb targets and the status line spans the full width. */
  .hub {
    grid-template-columns: 32px 1fr 1fr 32px;
    grid-template-rows: auto auto;
    grid-template-areas:
      "menu balance bet sound"
      "status status status status";
    row-gap: 6px;
    column-gap: 6px;
    padding: 8px;
  }
  .hub > :nth-child(1) { grid-area: menu; }
  .hub > :nth-child(2) { grid-area: balance; }
  .hub > :nth-child(3) { grid-area: status; justify-self: stretch; }
  .hub > :nth-child(4) { grid-area: bet; }
  .hub > :nth-child(5) { grid-area: sound; }
}
.iconBtn {
  width: 36px; height: 36px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.25);
  background: rgba(0, 0, 0, 0.35);
  display: flex; align-items: center; justify-content: center;
  color: var(--accent);
  cursor: pointer;
}
.iconBtn svg { width: 18px; height: 18px; }
.statBox {
  display: flex; flex-direction: column; align-items: center;
  padding: 4px 12px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.22);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.08), 0 2px 6px rgba(0, 0, 0, 0.4);
  min-width: 0;
}
.statBox__label {
  font-size: 0.55rem; letter-spacing: 2px;
  color: var(--accent); opacity: 0.75;
  text-transform: uppercase;
}
.statBox__value {
  font-size: 1.05rem; font-weight: 800;
  color: #ffe6a8;
  text-shadow: 0 2px 6px rgba(0, 0, 0, 0.6);
}
.statBox--status .statBox__value { font-size: 0.95rem; letter-spacing: 1.5px; }
.betGroup {
  display: grid;
  grid-template-columns: 32px 1fr 32px;
  gap: 6px;
  align-items: stretch;
}
.betStep {
  width: 32px;
  border-radius: 10px;
  border: 1px solid rgba(201, 162, 39, 0.3);
  background: linear-gradient(180deg, rgba(30, 25, 20, 0.85), rgba(15, 12, 10, 0.9));
  color: var(--accent);
  font-size: 1rem; font-weight: 800;
  cursor: pointer;
}
.gridHost {
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  /* Anchor for absolutely-positioned children — payline SVG overlay,
     line badge, big-win plaque etc. all overlay the grid by inset:0. */
  position: relative;
}
/* ── Payline overlay (SVG) ─────────────────────────────────────────────
   Absolute layer over the entire gridHost. Each winning payline draws
   ONE <polyline> through the geometric centers of its matched cells,
   colored by tier (HP gold, MP cyan-ice, LP bronze, WILD magenta). A
   round number-badge floats at the leftmost endpoint so the player
   reads "LINE 4" at a glance. SVG drawn at the gridHost dimensions
   in pixel space (viewBox = "0 0 W H"), updated on each cycle step. */
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
  stroke-width: 4.5;
  stroke-linecap: round;
  stroke-linejoin: round;
  /* Drop-shadow brings the line forward over busy reel backgrounds
     without bleeding past the host bounds (filter clips to overlay). */
  filter: drop-shadow(0 0 6px rgba(255, 196, 90, 0.55));
  /* Draw-in animation: starts fully dash-offset, animates to 0 over
     180ms so the eye reads "the line forms across these symbols". */
  stroke-dasharray: var(--payline-len, 1000);
  stroke-dashoffset: var(--payline-len, 1000);
  animation: payline-draw 220ms ease-out forwards;
}
@keyframes payline-draw {
  to { stroke-dashoffset: 0; }
}
.payline-path.tier-HP   { stroke: #ffc85a; filter: drop-shadow(0 0 8px rgba(255, 200, 90, 0.85)); }
.payline-path.tier-MP   { stroke: #7ec8e3; filter: drop-shadow(0 0 7px rgba(126, 200, 227, 0.75)); }
.payline-path.tier-LP   { stroke: #d29560; filter: drop-shadow(0 0 6px rgba(210, 149, 96, 0.70)); }
.payline-path.tier-WILD { stroke: #e070c0; filter: drop-shadow(0 0 8px rgba(224, 112, 192, 0.80)); }
.payline-badge {
  fill: rgba(15, 12, 10, 0.92);
  stroke-width: 1.5;
}
.payline-badge.tier-HP   { stroke: #ffc85a; }
.payline-badge.tier-MP   { stroke: #7ec8e3; }
.payline-badge.tier-LP   { stroke: #d29560; }
.payline-badge.tier-WILD { stroke: #e070c0; }
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
.grid-rect  { display: grid; gap: var(--cell-gap); }
.grid-vrl   { display: flex; gap: var(--cell-gap); align-items: center; height: 100%; }
.col        { display: flex; flex-direction: column; gap: var(--cell-gap); height: 100%; justify-content: center; }
.grid-hex   { position: relative; }
.grid-wheel { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.grid-plinko{ display: flex; flex-direction: column; align-items: center; gap: 4px; }
.plinko-row { display: flex; gap: 18px; }
.peg        { width: 10px; height: 10px; border-radius: 50%; background: var(--accent); opacity: 0.85; }
.grid-crash { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
.crash-curve{ width: 80%; max-width: 520px; height: 60%; max-height: 280px; }
.grid-slingo{ display: flex; flex-direction: column; gap: 12px; align-items: center; }
.cell {
  background: #1a2230;
  border: none;
  border-radius: var(--cell-radius);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: clamp(0.9rem, 1.4vw, 1.8rem);
  font-weight: 800;
  color: var(--accent);
  text-shadow: none;
  box-shadow: none;
}
.cell.lockable {
  box-shadow: inset 0 0 0 2px rgba(255, 215, 88, 0.35);
}
.cell.hex {
  clip-path: polygon(25% 0%, 75% 0%, 100% 50%, 75% 100%, 25% 100%, 0% 50%);
  position: absolute;
  border: none;
  background: #1a2230;
}
/* Hex inner ornament removed — keep cells flat like every other shape. */
.wheel-svg { width: 80%; max-width: 480px; aspect-ratio: 1 / 1; }
${emitReelEngineCSS(resolveReelEngineConfig(model))}
${emitAnticipationCSS(resolveAnticipationConfig(model))}
.spinBtn.is-spinning { pointer-events: none; opacity: 0.78; }
.spinBtn.is-spinning svg { opacity: 0.55; }

/* ── Placeholder win highlight ─────────────────────────────────────────────
   Visual-only: winning cells stay full opacity + nudge scale, non-winning
   cells dim to ~35%. No keyframes, no glow — just enough to read the combo
   at a glance. Real win-evaluator (matched line / cluster) lands with math.
   Scoped to .gridHost (the actual host element) and to all descendant cells
   so it works for both flat grids and nested SVG/text grids. */
.gridHost.has-winselection .cell,
.gridHost.has-winselection text         { opacity: 0.32; transition: opacity 180ms ease, transform 180ms ease; }
.gridHost.has-winselection .cell.is-win,
.gridHost.has-winselection text.is-win  { opacity: 1;     transform: scale(1.06); }
@media (prefers-reduced-motion: reduce) {
  .gridHost.has-winselection .cell,
  .gridHost.has-winselection text,
  .gridHost.has-winselection .cell.is-win,
  .gridHost.has-winselection text.is-win { transition: none; transform: none; }
}

${emitScatterCelebrationCSS(resolveScatterCelebrationConfig(model))}

/* ── Win-symbol cycle ── independent modular block ────────────────────────
   Plays AFTER reels settle on a non-trigger BASE spin. Multiple winning
   combinations cycle one-by-one, each lit for ~500ms (WoO small-win pace),
   then everything undims back to neutral.

   Composes with: BG/FS swap, scatter celebration, stage badge.
   Mutually exclusive with: scatter celebration (gating in handlePostSpin
   ensures only one of the two ever plays per spin).

   Design constraint (Boki rule): SUBTLE — animation MUST stay entirely
   inside the reel cell. Hard rules:
     - NO transform (no scale / rotate) — glyph stays at native size
     - NO drop-shadow / external glow — every prior version bled past
       the frame edge; only INSET box-shadow is allowed
     - Inset gold rim + brightness pulse on the glyph
     - Neighbour cells dim to 0.30 for cluster contrast
   The result is a contained "lit-cell" pulse that reads on luminance and
   a soft inner rim, with zero overflow. */
.gridHost.is-winsym-cycling .cell,
.gridHost.is-winsym-cycling text {
  opacity: 0.30;
  transition: opacity 140ms ease;
}
.gridHost.is-winsym-cycling .cell--winsym,
.gridHost.is-winsym-cycling text.cell--winsym {
  opacity: 1 !important;
  animation: winsym-pulse 500ms ease-in-out 1;
  transform: none;
  border-radius: 6px;       /* corner-rounded so the inset rim matches the cell */
}
@keyframes winsym-pulse {
  0%   { filter: brightness(1.00);
         box-shadow: inset 0 0 0 0 rgba(255, 196, 90, 0); }
  35%  { filter: brightness(1.28);
         box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.92),
                     inset 0 0 8px  rgba(255, 170, 60, 0.55); }
  70%  { filter: brightness(1.14);
         box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.62),
                     inset 0 0 6px  rgba(255, 170, 60, 0.32); }
  100% { filter: brightness(1.00);
         box-shadow: inset 0 0 0 0 rgba(255, 196, 90, 0); }
}
@media (prefers-reduced-motion: reduce) {
  .gridHost.is-winsym-cycling .cell--winsym,
  .gridHost.is-winsym-cycling text.cell--winsym {
    animation: none;
    filter: brightness(1.15);
    box-shadow: inset 0 0 0 2px rgba(255, 196, 90, 0.85);
  }
}
.grow-tag {
  position: absolute;
  top: 10px;
  right: 14px;
  font-size: 0.6rem;
  color: var(--accent);
  opacity: 0.55;
  background: transparent;
  border: none;
  padding: 0;
  letter-spacing: 1.5px;
  text-transform: uppercase;
}

${emitFreeSpinsCSS(resolveFreeSpinsConfig(model))}

/* Dev-mode FS trigger — pinned bottom-left of the viewport, outside the
   normal hub grid so it can't disturb the production layout. Always-on
   during development; production builds simply omit the button element.
   Responsive: scales with viewport via clamp(), uses safe-area insets so
   it survives notch / home-indicator on mobile, and stays clearly visible
   (opacity 0.85 baseline, 1.0 on hover) on every screen size. */
.dev-fs-btn {
  position: fixed;
  /* Pin top-right corner. Why not bottom-left: hub icon (hamburger) sits in
     the bottom-left of every layout; on tablet/phone the hub even collapses
     to a 2-row stack — anything fixed bottom-left collides. Top-right is
     empty across all viewports (header title is centered, sideHud is right
     of frame but well below top edge), and the FS HUD is centered (top, not
     top-right) so the two never overlap even during FS_ACTIVE. */
  top:   max(10px, env(safe-area-inset-top, 10px));
  right: max(10px, env(safe-area-inset-right, 10px));
  z-index: 2147483000;
  /* Fluid sizing — from 56×34 on phones up to 78×42 on desktop. Compact
     enough to never crowd the header/title row. */
  min-width: 56px;
  min-height: 34px;
  width:  clamp(56px, 5.5vw, 78px);
  height: clamp(34px, 3.6vw, 42px);
  padding: 0 clamp(8px, 1vw, 14px);
  border-radius: 12px;
  border: 2px dashed rgba(255, 214, 110, 0.85);
  background: linear-gradient(180deg, rgba(40, 30, 16, 0.9), rgba(15, 10, 6, 0.95));
  color: #ffe6a8;
  font-family: inherit;
  font-size: clamp(0.7rem, 1.2vw, 0.95rem);
  font-weight: 800;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  text-shadow: 0 1px 2px rgba(0, 0, 0, 0.8);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  /* High baseline visibility — always discoverable on any backdrop. */
  opacity: 0.92;
  box-shadow:
    0 4px 14px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(255, 214, 110, 0.25),
    inset 0 1px 0 rgba(255, 230, 168, 0.18);
  transition: opacity 0.15s ease-out, transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.dev-fs-btn:hover {
  opacity: 1;
  transform: translateY(-1px);
  box-shadow:
    0 6px 18px rgba(0, 0, 0, 0.6),
    0 0 0 1px rgba(255, 214, 110, 0.55),
    0 0 16px rgba(255, 214, 110, 0.35),
    inset 0 1px 0 rgba(255, 230, 168, 0.25);
}
.dev-fs-btn:active { transform: translateY(0); }
.dev-fs-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
  transform: none;
  box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4);
}
/* Tablet — header text shrinks a touch, button stays clear of it. */
@media (max-width: 820px) {
  .dev-fs-btn {
    top:   max(8px, env(safe-area-inset-top, 8px));
    right: max(8px, env(safe-area-inset-right, 8px));
  }
}
/* Phone — title is centered at ~1rem, button stays in opposite corner. */
@media (max-width: 620px) {
  .dev-fs-btn {
    min-width: 48px;
    min-height: 30px;
    font-size: 0.65rem;
    padding: 0 8px;
    top:   max(6px, env(safe-area-inset-top, 6px));
    right: max(6px, env(safe-area-inset-right, 6px));
  }
}
</style></head><body>

${emitFreeSpinsHudMarkup(resolveFreeSpinsConfig(model))}
${emitFreeSpinsToastMarkup(resolveFreeSpinsConfig(model))}

<div class="stage">
  <div class="header">
    <div class="title">${escapeHtml(model.name)}</div>
    ${emitStageBadgeMarkup(resolveStageBadgeConfig(model))}
    <div class="sub">${escapeHtml(layoutSub)}</div>
  </div>
  <div class="play">
    <div class="leftSpacer" aria-hidden="true"></div>
    <div class="frame" id="frameHost">
      <div class="gridHost" id="gridHost" data-kind="${shape.kind}">
        <!-- Payline overlay — populated at runtime per winning-line cycle
             step. Sits above the grid (z-index 6) so polylines render
             over the reels without intercepting pointer events. SVG
             viewBox is sized to the gridHost client rect on every frame
             so cell coordinates stay accurate after layout changes. -->
        <svg class="payline-overlay" id="paylineOverlay" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"></svg>
      </div>
    </div>
    <aside class="sideHud" aria-label="Game Controls">
      <button class="spinBtn" id="spinBtn" aria-label="Spin" type="button">
        <!-- Industry-standard circular spin / refresh icon — two opposing
             arrows wrapping in a circle. Used by most major slot vendors
             on the primary SPIN CTA. -->
        <svg viewBox="0 0 32 32" aria-hidden="true">
          <path d="M5.6 17.4a10.5 10.5 0 0 0 18.7 5.2"/>
          <path d="M26.4 14.6A10.5 10.5 0 0 0 7.7 9.4"/>
          <polyline points="24.3,22.6 24.3,16.6 18.3,16.6"/>
          <polyline points="7.7,9.4 7.7,15.4 13.7,15.4"/>
        </svg>
      </button>
      <button class="autoBtn" id="autoBtn" aria-label="Auto" type="button">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><polygon points="10 8 16 12 10 16 10 8" fill="currentColor"/></svg>
      </button>
    </aside>
  </div>
  <div class="hub">
    <button class="iconBtn" aria-label="Menu" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="4" y1="6" x2="20" y2="6"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="18" x2="20" y2="18"/></svg>
    </button>
    <div class="statBox statBox--balance">
      <div class="statBox__label">BAL</div>
      <div class="statBox__value" id="bal">1000.00</div>
    </div>
    <div class="statBox statBox--status">
      <div class="statBox__label">STATUS</div>
      <div class="statBox__value" id="status">PRESS SPIN</div>
    </div>
    <div class="betGroup">
      <button class="betStep" aria-label="bet -" type="button">−</button>
      <div class="statBox statBox--bet">
        <div class="statBox__label">BET</div>
        <div class="statBox__value" id="bet">1.00</div>
      </div>
      <button class="betStep" aria-label="bet +" type="button">+</button>
    </div>
    <button class="iconBtn" aria-label="Sound" type="button">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"/></svg>
    </button>
  </div>
</div>

<!-- Dev-only Free-Spins trigger. Pinned bottom-left of the viewport — visible
     in every template (even with FS disabled in the GDD) so QA can click
     directly into the FS round without grinding scatter hits. Disabled when
     FS is not in the parsed model. -->
<button class="dev-fs-btn" id="devFsBtn" type="button"
        aria-label="Dev: Trigger Free Spins"
        title="DEV — force Free Spins entry">FS</button>

${emitFreeSpinsOverlayMarkup(resolveFreeSpinsConfig(model))}

<script>
  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const SHAPE = ${JSON.stringify(shape)};
  const FREESPINS = ${JSON.stringify(model.freeSpins || { enabled: false })};
  /* Per-symbol registry — drives win-cycle event generation. See
     SYMBOL_REGISTRY construction in buildSlotHTML.mjs for the source. */
  const SYMBOL_REGISTRY = ${JSON.stringify(SYMBOL_REGISTRY)};
  /* Payline pool — int[reels] per line, value = rowIdx at reel i.
     Empty for cluster-pays grids (cluster, megaclusters, hex, etc).
     When non-empty, the win cycle runs in line-pays mode (per-line
     event). When empty, it falls back to per-symbol cluster mode. */
  const PAYLINE_POOL = ${JSON.stringify(PAYLINE_POOL)};
  const REELS = SHAPE.reels;
  const ROWS  = SHAPE.rows;

  const grid = document.getElementById("gridHost");
  const frame = document.getElementById("frameHost");

  /* Deterministic symbol fill — repeatable layout per fixture for snapshots */
  function symAt(i) { return POOL[i % POOL.length]; }

  function makeCell(text, extraClass = "") {
    const el = document.createElement("div");
    el.className = "cell" + (extraClass ? " " + extraClass : "");
    el.textContent = text || "?";
    return el;
  }

  /* Compute the side length so a (cols x rowsCount) grid of square cells
     with the given gap between them fits inside frame inner box. The grid is
     centered automatically by .gridHost flex layout. */
  function cellSize(cols, rowsCount, gap = 6) {
    /* frame already has padding=var(--frame-inset); use clientWidth/Height
       which exclude padding. */
    const innerW = grid.clientWidth || frame.clientWidth;
    const innerH = grid.clientHeight || frame.clientHeight;
    const cellW = (innerW - gap * Math.max(0, cols - 1)) / cols;
    const cellH = (innerH - gap * Math.max(0, rowsCount - 1)) / rowsCount;
    return Math.max(20, Math.floor(Math.min(cellW, cellH)));
  }

  /* Track per-reel strips for the spin engine. Populated for every
     uniform-column-grid shape kind so the rectangular reel engine
     (windup → accel → steady → decel → cushion bounce) drives every
     reel-like shape identically.

     UNIFORM_REEL_KINDS lists shapes that share a flat REELS×ROWS column
     layout — all of them now build the same RECT_REELS array of reelCol
     strips. Cluster's 7×7 looks like 7 stacked-symbol columns spinning,
     same beat as rectangular's 5×3 — just larger. */
  const UNIFORM_REEL_KINDS = new Set([
    'rectangular',
    'cluster',
    'megaclusters',
    'lock_respin',
    'expanding',
    'infinity',
    /* Wave J1 — variable_reel (per-reel row counts, e.g. 6×[2,5,7,7,5,2]).
       Shares the rectangular spin engine but each column has its own
       visibleRows and is center-aligned in the grid host. */
    'variable_reel',
  ]);
  let RECT_REELS = null;
  let RECT_SIDE = 0;

  function buildReelColumns(host, cols, rowsCountOrArray, side, extraCellClass) {
    /* Shared reel-strip column builder. Used by every uniform-reel shape.
       Each column contains a reelStrip div with visibleRows + 2 cells
       (1 buffer above + 1 buffer below the visible window). Rotation of
       these cells during spin is what creates the infinite-scroll
       illusion in onTickAll().

       rowsCountOrArray:
         number  — uniform: every reel has the same row count (rectangular,
                   cluster, megaclusters, lock_respin, expanding, infinity)
         array   — per-reel: column c has rowsArray[c] visible rows
                   (variable_reel, e.g. [2,5,7,7,5,2]). The reel is
                   center-aligned in the grid host with a CSS gridRow offset
                   so the diamond / hourglass silhouette renders correctly. */
    RECT_REELS = [];
    RECT_SIDE = side;
    const rowsArray = Array.isArray(rowsCountOrArray)
      ? rowsCountOrArray
      : Array.from({ length: cols }, () => rowsCountOrArray);
    const maxRows = rowsArray.reduce((m, r) => Math.max(m, r), 0);
    let symIdx = 0;
    for (let c = 0; c < cols; c++) {
      const visibleRows = rowsArray[c];
      const reelH = visibleRows * side + (visibleRows - 1) * 6;
      const rowOffset = Math.floor((maxRows - visibleRows) / 2); // center-align
      const col = document.createElement("div");
      col.className = "reelCol";
      col.style.width = side + "px";
      col.style.height = reelH + "px";
      col.style.gridColumn = (c + 1) + " / " + (c + 2);
      col.style.gridRow = (rowOffset + 1) + " / span " + visibleRows;

      const strip = document.createElement("div");
      strip.className = "reelStrip";
      const stripCells = visibleRows + 2;
      const cellRefs = [];
      for (let r = 0; r < stripCells; r++) {
        const cell = makeCell(symAt(symIdx++), extraCellClass);
        cell.style.width = side + "px";
        cell.style.height = side + "px";
        cell.style.fontSize = (side * 0.32) + "px";
        cell.style.flex = "0 0 auto";
        strip.appendChild(cell);
        cellRefs.push(cell);
      }
      const cellStep = side + 6;
      strip.style.transform = "translateY(" + (-cellStep) + "px)";
      col.appendChild(strip);
      host.appendChild(col);
      RECT_REELS.push({
        col, strip, side, cellStep,
        cells: cellRefs,
        visibleRows,                /* per-reel — engine reads this, not ROWS */
        offsetPx: 0,
        spinning: false,
        stopping: false,
        stopRequested: false,
        stopRequestTime: 0,
        targetY: -cellStep,
        rotationCount: 0,
        minRotations: 8,
        stopDelayMs: 0,
      });
    }
  }

  function renderRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = side + "px";  // single row of reel columns

    if (UNIFORM_REEL_KINDS.has(SHAPE.kind)) {
      const extraClass = (SHAPE.kind === 'lock_respin') ? 'lockable' : '';
      /* For variable_reel each column has its own visibleRows (e.g.
         [2,5,7,7,5,2]) — we pass the array straight to buildReelColumns
         which center-aligns each column inside a ROWS-tall track. Every
         other uniform kind passes a scalar so all reels share ROWS. */
      let perReelRows = ROWS;
      if (SHAPE.kind === 'variable_reel' && Array.isArray(SHAPE.columns)) {
        perReelRows = SHAPE.columns.map(c => c.rows || ROWS);
        /* Variable reels need the host to render as ROWS-tall stacked rows
           so the center-aligned columns have somewhere to anchor. */
        host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
      }
      buildReelColumns(host, REELS, perReelRows, side, extraClass);
      if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
        const tag = document.createElement("div");
        tag.className = "grow-tag";
        tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
        frame.appendChild(tag);
      }
      grid.appendChild(host);
      return;
    }

    /* Irregular shapes (hex / diamond / pyramid / cross / l_shape) — they
       don't share the rectangular column layout, so they keep the legacy
       static-cell render. runOneBaseSpin dispatches to runStaticReroll for
       these. (variable_reel used to live here but Wave J1 moved it onto
       the uniform reel engine with per-column visibleRows.) */
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

  /* ─── Reel spin engine (rectangular only) ──────────────────────────────
     Mirrors the reference base game onTick + reel cell rotation. Symbols
     are ALWAYS visible during spin because we rotate cells in the strip
     rather than translating beyond the visible window:

        every frame: offsetPx += speedPxPerFrame
        when offsetPx >= cellStep:
          • offsetPx -= cellStep
          • pop bottom cell, unshift to top, randomize the top cell symbol
          • re-render strip with cells at indexes [0..n-1]
          • rotation count++
        strip.transform.y = round(offsetPx - cellStep)
          (oscillates between -cellStep and 0, exposing the next cell as
           the top one slides off-mask above)

     On stop request:
        • spin keeps rotating until rotationCount >= minRotations AND
          enough time has passed for this reel's stop-delay (stagger)
        • transition to "stopping" — strip eases towards targetY with
          a soft cushion bounce on land (6px overshoot, ~2 bounces)
        • final visible 3 cells are the new outcome

     Timing constants mirror SPIN_PROFILE_NORMAL from WoO timing.ts. */
  /* Industry-reference cadence (S-AVP / classic 5-reel cabinet timing).
     Each reel: windup → accel → steady spin → DECEL (perceivable slow-
     down before the snap) → snap onto symbols → subtle cushion bounce.
     Reels stop one-by-one with a 320ms gap = classic cabinet beat
     (slightly longer than mobile-arcade quickplay).
     Land timing from SPIN click:
       reel 1 :  ~1.40s   (windup 100 + accel 120 + steady 830 + decel 350)
       reel 2 :  ~1.72s
       reel 3 :  ~2.04s
       reel 4 :  ~2.36s
       reel 5 :  ~2.68s
     Total spin ~2.7s — matches the reference base-game cadence. */
  ${emitSpinTempoRuntime(resolveSpinTempoConfig(model))}

  /* Public state of the engine */
  let spinTicker = null;
  let spinStartTime = 0;
  let allReelsActive = false;

  /* Force-trigger flag — when set before a spin, the stop-symbol commit
     guarantees N scatters across the first N reels, mirroring "you spun
     into a feature". The DEV FS button uses this so the player sees the
     real reel-stop sequence (with anticipation slowdown on the final
     scatter-carrying reels) before the intro placard appears. */
  let FORCE_TRIGGER = null;   /* { scatterCount: 3 } | null */

  function randomSym() { return POOL[Math.floor(Math.random() * POOL.length)]; }

  function rotateStripDown(reel) {
    /* Pop bottom cell DOM node, unshift to top, randomize its symbol.
       This mimics WoO's reel.cells.pop() / unshift() rotation. */
    const last = reel.cells.pop();
    reel.cells.unshift(last);
    last.textContent = randomSym();
    /* Re-attach in new order */
    for (let i = 0; i < reel.cells.length; i++) {
      reel.strip.appendChild(reel.cells[i]);
    }
    reel.rotationCount++;
  }

  ${emitAnticipationRuntime(resolveAnticipationConfig(model))}

  function commitStopSymbols(reel, reelIdx) {
    /* On stop: ensure the next visibleRows cells (indexes 1..visibleRows)
       get a fresh, settled outcome. The top buffer (index 0) and bottom
       buffer (last) are kept for the cushion bounce. visibleRows is
       per-reel — uniform shapes always equal ROWS, variable_reel varies
       per column (e.g. 2/5/7/7/5/2). */
    const vis = reel.visibleRows || ROWS;
    for (let i = 1; i <= vis; i++) {
      reel.cells[i].textContent = randomSym();
    }
    /* If we're forcing a feature trigger, plant a scatter on the centre row
       of the first N reels so handlePostSpin counts the right number. The
       scatter goes on the middle visible row for max readability. */
    if (FORCE_TRIGGER && reelIdx < FORCE_TRIGGER.scatterCount) {
      const trig = (FREESPINS.triggerSymbol || "S");
      const midRow = Math.max(1, Math.ceil(vis / 2));
      reel.cells[midRow].textContent = trig;
    }
  }

  /* onSettled (optional) fires once when every reel has fully stopped and
     bounced. Used by the FS auto-spin loop to chain spins back-to-back, and
     by the post-spin scatter-detection hook to evaluate FS triggers. */
  function startSpinAll(onSettled) {
    if (!RECT_REELS || allReelsActive) return;
    allReelsActive = true;
    spinStartTime = performance.now();
    const spinBtn = document.getElementById("spinBtn");
    const statusEl = document.getElementById("status");
    spinBtn.classList.add("is-spinning");
    /* Don't overwrite FS-specific status messages (e.g. "FS · 3 / 14") that
       the FSM may have set just before kicking the spin. */
    if (!statusEl.textContent.startsWith("FS")) {
      statusEl.textContent = "SPINNING";
    }

    /* Arm each reel — apply blur to visible cells, set spinning flag,
       schedule the BASE stop time (no anticipation yet). Anticipation is
       added DYNAMICALLY in onTickAll() once we know how many scatters have
       already landed on stopped reels.
       Per-reel handle (reel.stopTimerId) lets us cancel & re-schedule when
       we need to extend a reel's hold time after the previous one stops. */
    RECT_REELS.forEach((reel, idx) => {
      reel.spinning = true;
      reel.stopping = false;
      reel.stopRequested = false;
      reel.rotationCount = 0;
      reel.offsetPx = 0;
      reel.anticipating = false;
      /* Clean leftover anticipation state from the previous spin so a
         late-fired glow timer can't flash the wheel on the next round
         and so the class doesn't persist across spins. */
      if (reel.glowTimerId) { clearTimeout(reel.glowTimerId); reel.glowTimerId = null; }
      reel.col.classList.remove("reelCol--anticipating");
      reel.scheduledStopAt = performance.now() +
        SPIN_PROFILE.windupMs + SPIN_PROFILE.accelMs +
        SPIN_PROFILE.steadyMs + idx * SPIN_PROFILE.staggerMs;
      reel.cells.forEach(c => c.classList.add("is-blurring"));

      const initialDelay = reel.scheduledStopAt - performance.now();
      reel.stopTimerId = setTimeout(() => {
        reel.stopRequested = true;
        reel.stopRequestTime = performance.now();
      }, Math.max(0, initialDelay));
    });

    if (!spinTicker) {
      const tick = () => {
        const stillActive = onTickAll();
        if (stillActive) {
          spinTicker = requestAnimationFrame(tick);
        } else {
          spinTicker = null;
          allReelsActive = false;
          spinBtn.classList.remove("is-spinning");
          if (!statusEl.textContent.startsWith("FS")) {
            statusEl.textContent = "PRESS SPIN";
          }
          if (typeof onSettled === "function") {
            /* Small breath so the eye sees the symbols land before any
               follow-up trigger animation kicks. */
            setTimeout(onSettled, 80);
          }
        }
      };
      spinTicker = requestAnimationFrame(tick);
    }
  }

  function onTickAll() {
    const baseSpeed = Math.max(20, RECT_SIDE * 0.25);
    let anyActive = false;
    const now = performance.now();

    for (const reel of RECT_REELS) {
      if (reel.spinning) {
        anyActive = true;
        const reelElapsed = now - spinStartTime;

        /* Acceleration ramp: 0.3 → 1.0 over accelMs */
        let speedPxPerFrame = baseSpeed;
        if (reelElapsed < SPIN_PROFILE.accelMs) {
          const p = Math.max(0, reelElapsed / SPIN_PROFILE.accelMs);
          speedPxPerFrame = baseSpeed * (0.3 + 0.7 * p);
        }

        reel.offsetPx += speedPxPerFrame;

        /* When we've moved a full cell, rotate */
        while (reel.offsetPx >= reel.cellStep) {
          reel.offsetPx -= reel.cellStep;
          rotateStripDown(reel);

          /* Check stop transition */
          if (reel.stopRequested) {
            const stopElapsed = now - reel.stopRequestTime;
            if (reel.rotationCount >= reel.minRotations && stopElapsed >= reel.stopDelayMs) {
              reel.spinning = false;
              reel.stopping = true;
              reel.stopStartMs = now;
              /* Pass the reel index so commitStopSymbols can decide whether
                 to plant a forced-trigger scatter on this reel. */
              const reelIdx = RECT_REELS.indexOf(reel);
              commitStopSymbols(reel, reelIdx);
              reel.col.classList.remove("reelCol--anticipating");
              /* targetY = -cellStep (resting position with top buffer above) */
              reel.targetY = -reel.cellStep;
              /* Dynamic anticipation: now that THIS reel has its final
                 symbols, check how many scatters are visible across every
                 stopped reel. If we're one short of the trigger threshold,
                 every still-spinning reel gets a slow-down hold. */
              maybeArmAnticipation();
            }
          }
        }

        /* Visual position: y oscillates between -cellStep and 0 */
        const rawY = reel.offsetPx - reel.cellStep;
        reel.strip.style.transform = "translateY(" + Math.round(rawY) + "px)";
      } else if (reel.stopping) {
        anyActive = true;
        const easingSpeed = SPIN_PROFILE.decelEasingSpeed || 0.18;
        const snapThreshold = 0.6;
        const currentY = parseFloat(reel.strip.style.transform.replace(/[^\-0-9.]/g, "")) || 0;
        const delta = reel.targetY - currentY;

        if (Math.abs(delta) <= snapThreshold) {
          /* Snap aligned */
          reel.strip.style.transform = "translateY(" + reel.targetY + "px)";
          reel.stopping = false;
          reel.stopped = true;
          reel.cells.forEach(c => c.classList.remove("is-blurring"));

          /* Cushion bounce */
          if (SPIN_PROFILE.bouncePx > 0) {
            reel.bouncing = true;
            reel.bounceT = 0;
            reel.bounceIteration = 0;
            reel.bouncePhase = 'drop';
            reel.bounceBaseY = reel.targetY;
            reel.bouncePx = SPIN_PROFILE.bouncePx;
          }
        } else {
          /* Ease toward target */
          let step = delta * easingSpeed;
          if (Math.abs(step) < 0.5 && Math.abs(delta) > snapThreshold) {
            step = delta > 0 ? 1 : -1;
          }
          reel.strip.style.transform = "translateY(" + Math.round(currentY + step) + "px)";
        }
      } else if (reel.bouncing) {
        anyActive = true;
        reel.bounceT++;
        const t = reel.bounceT;
        const iter = reel.bounceIteration;
        const baseY = reel.bounceBaseY;
        const currentAmp = reel.bouncePx * Math.pow(SPIN_PROFILE.bounceDecay, iter);

        if (currentAmp < 0.5 || iter >= SPIN_PROFILE.bounceCount) {
          reel.strip.style.transform = "translateY(" + baseY + "px)";
          reel.bouncing = false;
        } else {
          const dropFrames = Math.max(4, Math.round(6 - iter * 1.0));
          const returnFrames = Math.max(5, Math.round(9 - iter * 1.5));
          let offset = 0;
          if (reel.bouncePhase === 'drop') {
            const dp = Math.min(1, t / dropFrames);
            const eased = 1 - Math.pow(1 - dp, SPIN_PROFILE.bounceElasticity);
            offset = currentAmp * eased;
            if (t >= dropFrames) { reel.bouncePhase = 'return'; reel.bounceT = 0; }
          } else {
            const rp = Math.min(1, t / returnFrames);
            const eased = rp < 0.5 ? 2 * rp * rp : 1 - Math.pow(-2 * rp + 2, 2) / 2;
            offset = currentAmp * (1 - eased);
            if (t >= returnFrames) {
              reel.bounceIteration = iter + 1;
              reel.bouncePhase = 'drop';
              reel.bounceT = 0;
            }
          }
          reel.strip.style.transform = "translateY(" + Math.round(baseY + offset) + "px)";
        }
      }
    }
    return anyActive;
  }

  /* ─── User-driven spin entry (player click on the SPIN button) ─────────
     During FS_ACTIVE the spin loop is driven by the FSM, not by the player,
     so we ignore clicks. During FS_INTRO / FS_OUTRO the placard CTA owns
     the input, so we ignore clicks as well. */
  const spinButton = document.getElementById("spinBtn");
  if (spinButton) {
    spinButton.addEventListener("click", () => {
      if (FSM.phase !== "BASE") return;
      runOneBaseSpin();
    });
  }

  function runOneBaseSpin() {
    /* Clear any leftover win-combo highlight from the previous spin so the
       grid reads as "neutral, about to spin" instead of "stuck on a win".
       cancelWinSymCycle bumps the cycle token so any in-flight setTimeout
       from the previous spin's playWinSymCycle no-ops on its next tick. */
    cancelWinSymCycle();
    /* Every uniform-column-grid shape (rectangular / cluster / megaclusters
       / lock_respin / expanding / infinity / variable_reel) uses the same
       reel spin engine — windup → accel → steady → decel → cushion bounce,
       identical cadence across shapes. variable_reel rides the same engine
       but with per-column visibleRows (Wave J1). Irregular shapes (hex /
       diamond / pyramid / cross / l_shape) and SVG kinds (wheel / crash /
       plinko / radial / slingo) fall through to runStaticReroll. */
    if (UNIFORM_REEL_KINDS.has(SHAPE.kind) && RECT_REELS) {
      startSpinAll(() => handlePostSpin(/* during FS */ false));
    } else {
      runStaticReroll(() => handlePostSpin(false));
    }
  }

  /* ─── Static-grid reroll path (every non-rectangular kind) ───────────────
     The base-game template doesn't ship a per-kind spin animation for hex /
     wheel / cluster / plinko / etc. — those just blink to a fresh random
     symbol set with a quick fade. Good enough for the FS visual flow (the
     real per-kind spin animations land in the per-kind engine packages). */
  function runStaticReroll(onSettled) {
    /* SVG-based kinds (wheel/crash) keep their symbols inside <text> nodes
       rather than .cell divs. Selector covers both so wheel scatter detection
       works on top of the same reroll path. */
    const cellsAll = grid.querySelectorAll(".cell, text");
    if (cellsAll.length === 0) {
      if (typeof onSettled === "function") setTimeout(onSettled, 60);
      return;
    }

    /* HTML grids with a clean REELS×ROWS column shape get the rectangular-
       style sequential reveal: column-by-column landing with optional
       anticipation glow when the scatter ladder is one short of the trigger.
       SVG / irregular grids fall back to the original blink-reroll. */
    const COL_KINDS = new Set([
      'cluster', 'megaclusters', 'lock_respin', 'expanding', 'infinity',
    ]);
    const isColumnGrid = COL_KINDS.has(SHAPE.kind) && REELS > 0;

    const trig = (FREESPINS.triggerSymbol || "S");
    const forceN = FORCE_TRIGGER ? FORCE_TRIGGER.scatterCount : 0;

    if (!isColumnGrid) {
      /* Legacy two-phase blink: blur → swap → clear blur. Used for SVG and
         irregular HTML grids (hex / diamond / pyramid / cross / l_shape /
         variable_reel / radial / slingo / plinko / wheel / crash). */
      cellsAll.forEach(c => c.classList.add("is-blurring"));
      setTimeout(() => {
        cellsAll.forEach((c, i) => {
          c.textContent = (i < forceN) ? trig : (randomSym() || "?");
        });
        setTimeout(() => {
          cellsAll.forEach(c => c.classList.remove("is-blurring"));
          if (typeof onSettled === "function") onSettled();
        }, 220);
      }, 220);
      return;
    }

    /* ── Sequential column reveal for cell-grid shapes ─────────────────────
       Row-major DOM order → column index = i % REELS. We compute the new
       symbol for every cell up front, then reveal columns left-to-right
       with a per-column stagger that matches the rectangular SPIN_PROFILE
       (decel ~350ms, stagger ~320ms). Anticipation glow fires column-by-
       column once the threshold-1 ladder gate is met. */
    const htmlCells = Array.from(grid.querySelectorAll(".cell"));
    const cols = REELS;
    const colCells = Array.from({ length: cols }, () => []);
    htmlCells.forEach((c, i) => colCells[i % cols].push(c));

    /* Resolve the future symbol for every cell now so we can both render
       and count scatters without a second pass. */
    const resolved = htmlCells.map((_, i) =>
      (i < forceN) ? trig : (randomSym() || "?")
    );
    const upperTrig = trig.toUpperCase();

    /* Init: blur every cell (mirrors the "all spinning" state). */
    htmlCells.forEach(c => c.classList.add("is-blurring"));

    /* GDD threshold + ladder topRung (same logic as maybeArmAnticipation). */
    const threshold = (FREESPINS.triggerCounts && FREESPINS.triggerCounts[0]) ||
                      (FREESPINS.awards && FREESPINS.awards[0] && FREESPINS.awards[0].count) || 3;
    const topRung = (FREESPINS.awards || []).reduce(
      (m, a) => Math.max(m, a.count), threshold);
    const countMode = (FREESPINS.countMode === 'any') ? 'any' : 'perReel';

    /* Cadence tuned for the static-cell path so a 35-spin FS round stays
       inside the QA harness 120s wall-clock budget while still reading
       as a deliberate column-by-column landing. Rectangular SPIN_PROFILE
       (320ms stagger, 600ms anticipation hold) is unchanged. */
    const STAGGER = 200;
    const HOLD_BASE = 400;
    let scattersSoFar = 0;
    let anticipationArmed = false;
    let elapsed = 220; /* initial pre-roll so the blur is visible first */

    function revealColumn(c) {
      /* Land every cell in column c with its resolved symbol. */
      for (const cell of colCells[c]) {
        const i = htmlCells.indexOf(cell);
        cell.textContent = resolved[i];
        cell.classList.remove("is-blurring");
        cell.classList.remove("cell--anticipating");
      }
      /* Update scattersSoFar — perReel collapse: column adds 0 or 1. */
      const hitsInCol = colCells[c].reduce(
        (n, cell) => n + ((cell.textContent || "").toUpperCase() === upperTrig ? 1 : 0), 0);
      scattersSoFar += (countMode === 'any') ? hitsInCol : (hitsInCol > 0 ? 1 : 0);

      /* Re-evaluate the anticipation gate AFTER this column landed. */
      const remaining = cols - (c + 1);
      const gate = Math.max(1, threshold - 1);
      const stillNeedsTrigger = scattersSoFar + remaining >= threshold;
      const armNow = scattersSoFar >= gate && stillNeedsTrigger && scattersSoFar < topRung;
      if (armNow) {
        anticipationArmed = true;
        /* Glow every still-blurring column (those that haven't revealed yet). */
        for (let nc = c + 1; nc < cols; nc++) {
          for (const cell of colCells[nc]) cell.classList.add("cell--anticipating");
        }
      } else if (anticipationArmed && !armNow) {
        /* Gate dropped (math reachability lost OR topRung locked) — clear glow. */
        anticipationArmed = false;
        for (let nc = c + 1; nc < cols; nc++) {
          for (const cell of colCells[nc]) cell.classList.remove("cell--anticipating");
        }
      }
    }

    /* Pre-compute cumulative scatter count after each column lands, so we
       know exactly when the anticipation gate trips and can space the
       reveals with the correct +HOLD_BASE injection. Deterministic — same
       prediction the revealColumn() runtime check uses. */
    const cumulativeAfter = new Array(cols).fill(0);
    {
      let acc = 0;
      for (let c = 0; c < cols; c++) {
        let hits = 0;
        for (let ri = 0; ri < colCells[c].length; ri++) {
          const i = c + ri * cols;
          if ((resolved[i] || "").toUpperCase() === upperTrig) hits++;
        }
        acc += (countMode === 'any') ? hits : (hits > 0 ? 1 : 0);
        cumulativeAfter[c] = acc;
      }
    }

    /* Schedule the column reveals. Stagger STAGGER between non-anticipating
       columns; +HOLD_BASE injected once the ladder gate trips so the next
       column inherits the same "still going" beat the rectangular path
       gives reel B / C / D / E after the first anticipating reel. */
    const gate = Math.max(1, threshold - 1);
    let cursor = elapsed;
    for (let c = 0; c < cols; c++) {
      const colIdx = c;
      const fireAt = cursor;
      setTimeout(() => revealColumn(colIdx), fireAt);
      cursor += STAGGER;
      if (c < cols - 1) {
        const cumNow = cumulativeAfter[c];
        const futureRemaining = cols - (c + 1);
        const armed = cumNow >= gate &&
                      (cumNow + futureRemaining >= threshold) &&
                       cumNow < topRung;
        if (armed) cursor += HOLD_BASE;
      }
    }

    /* Final settle — onSettled fires after the last reveal + a brief
       breath so handlePostSpin sees the fully-rendered state. */
    setTimeout(() => {
      if (typeof onSettled === "function") onSettled();
    }, cursor + 80);
    return;
  }

  ${emitTriggerCountingRuntime(resolveTriggerCountingConfig(model))}

  /* ── Placeholder win-combo highlight ─────────────────────────────────────
     No math yet, so we fake the "winning combination" by picking the most-
     frequent non-scatter symbol on the grid (must occur ≥ 3 times) and
     marking those cells .is-win while the parent .grid carries
     .has-winselection (which dims every other cell via CSS). About one
     spin in three is a "loss" with no highlight at all, so the player gets
     visual variance instead of every spin lighting up. Cleared at the start
     of every new spin and at FS phase boundaries. */
  function clearWinHighlight() {
    grid.classList.remove("has-winselection");
    grid.classList.remove("is-winsym-cycling");
    grid.querySelectorAll(".cell.is-win, text.is-win").forEach(c => c.classList.remove("is-win"));
    grid.querySelectorAll(".cell--winsym, text.cell--winsym").forEach(c => c.classList.remove("cell--winsym"));
    /* Drop any leftover payline SVG so the next spin's neutral state
       reads clean (no ghost line bleeding into the windup frame). */
    if (typeof clearPaylineOverlay === 'function') clearPaylineOverlay();
  }
  /* Detect candidate win combos on the settled grid. Placeholder math:
     every non-scatter symbol with count >= 3 becomes one combo. Sorted
     by count desc and capped to MAX_COMBOS so the cycle stays inside a
     few seconds (no math layer yet — when real evaluator lands this
     function is the swap point). */
  /* ── detectWinCombos — per-symbol event generation ─────────────────────
     Ultimate behaviour (Boki rule): every HP/MP/LP symbol with >= 3
     visible hits becomes its OWN event in the cycle. Wild substitutes —
     wild cells join EVERY regular event's cell list (lit alongside the
     real symbol). Scatter NEVER participates (trigger-only).

     Returns array of events:
       [{ symbol, tier: 'HP'|'MP'|'LP', cells: [...] }, ...]
     Sorted: HP first, then MP, then LP. Hard cap on event count so the
     cycle never blows the per-spin time budget (industry parity: WoO
     small-win caps the line bouquet around 6-8 entries). */
  ${emitDetectWinCombosRuntime(resolveWinPresentationConfig(model))}
  ${emitPaylineOverlayRuntime()}
  ${emitWinPresentationRuntime(resolveWinPresentationConfig(model))}

  ${emitScatterCelebrationRuntime(resolveScatterCelebrationConfig(model))}

  ${emitPostSpinRuntime(resolvePostSpinConfig(model))}

  const devFsBtn   = document.getElementById("devFsBtn");
  const statusElGlobal = document.getElementById("status");
  ${emitStageBadgeRuntime(resolveStageBadgeConfig(model))}
  ${emitFreeSpinsRuntime(resolveFreeSpinsConfig(model))}

  /* Expose FREESPINS / SHAPE / RECT_REELS / payline + win probes on window
     for the QA harness (Playwright eval). FSM is already exposed by the
     freeSpins block. */
  if (typeof window !== "undefined") {
    window.FREESPINS = FREESPINS;
    window.SHAPE = SHAPE;
    Object.defineProperty(window, 'RECT_REELS', {
      configurable: true,
      get: () => RECT_REELS,
    });
    window.PAYLINE_POOL = PAYLINE_POOL;
    window.SYMBOL_REGISTRY = SYMBOL_REGISTRY;
    window.applyWinHighlight = applyWinHighlight;
    window.detectLineWins = detectLineWins;
    window.drawPaylineOverlay = drawPaylineOverlay;
  }

  /* Dev-only FS trigger — runs a real spin with the scatter outcome forced
     so the player sees the FULL trigger sequence: reels rotate, scatters
     land one by one with anticipation slowdown on the trigger reel, brief
     settle pause, THEN the cinematic intro placard fades in. This mirrors
     what an organic feature hit looks like — exactly the "you spun into a
     bonus" moment a player remembers.

     Implementation: sets FORCE_TRIGGER flag, kicks runOneBaseSpin(), which
     uses the normal spin engine + handlePostSpin. The scatter detection in
     handlePostSpin sees the planted scatters and naturally fires intro. */
  if (devFsBtn) {
    devFsBtn.disabled = !FREESPINS.enabled;
    devFsBtn.addEventListener("click", () => {
      if (FSM.phase !== "BASE" || !FREESPINS.enabled) return;
      const first = (FREESPINS.awards && FREESPINS.awards[0]) || { count: 3, spins: 10 };
      /* Disable both buttons immediately so a stray double-tap can't queue
         a second spin behind this one. They get re-enabled on FSM_enterBase
         (or by handlePostSpin if FS doesn't trigger for some reason). */
      devFsBtn.disabled = true;
      if (spinButton) spinButton.disabled = true;
      FORCE_TRIGGER = { scatterCount: first.count };
      runOneBaseSpin();
    });
  }

  function renderVariableReel() {
    const host = document.createElement("div");
    host.className = "grid-vrl";
    const maxRows = Math.max(...SHAPE.columns.map(c => c.rows));
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
    /* tile size derived from frame dimensions */
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
    /* board takes 5 rows, strip is 1 row; reserve 6 row-units total with gap */
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
    /* Spacing only — visual separator removed for the flat look. */
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
    /* Compute each side's max cell so it fits entirely in the available
       half-width AND the full inner height. Subgrid B has more rows so its
       cell will be smaller — this is desired for Colossal asymmetric dual. */
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
    ensurePaylineOverlay();
    switch (SHAPE.kind) {
      case "rectangular":
      case "cluster":
      case "lock_respin":
      case "megaclusters":
      case "infinity":
      case "expanding":
      /* Wave J1: variable_reel now uses the rectangular reel engine via
         per-reel visibleRows in buildReelColumns (handled inside renderRect
         when SHAPE.kind === 'variable_reel'). */
      case "variable_reel":
        return renderRect();
      case "diamond":
      case "pyramid":
        return renderVariableReel();
      case "cross":
      case "l_shape":
        return renderMaskedRect();
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
</script>
</body></html>`;
}
