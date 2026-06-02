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
  const shape = buildGridShape(model);
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
/* ─── Reel spin engine (rectangular only, for now) ─────────────────── */
.reelCol {
  position: relative;
  overflow: hidden;
  border-radius: var(--cell-radius);
  background: transparent;
}
.reelStrip {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: var(--cell-gap);
  will-change: transform;
}
.cell.is-blurring {
  filter: blur(2.5px) brightness(0.92);
  transition: filter 60ms linear;
}
.spinBtn.is-spinning { pointer-events: none; opacity: 0.78; }
.spinBtn.is-spinning svg { opacity: 0.55; }
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

/* ─── FREE SPINS · cinematic overlay + HUD + visual mode ───────────────────
   Three visual layers, all driven from the same FSM state.

   1. body.fs-mode-<bg>   — full-stage background swap (purple/gold/crimson)
                            + subtle frame-edge halo while FS is active.
   2. .fs-overlay         — full-screen modal placard for intro & outro.
                            Backdrop-blurs the play area behind it; "tap to
                            continue" CTA centered. Hidden in BASE / ACTIVE.
   3. .fs-hud             — sticky HUD pinned above the reel area with 3
                            stat boxes: SPINS · MULT · TOTAL. Hidden in BASE. */

/* Visual-mode body backgrounds (chosen by GDD palette heuristic). */
body.fs-mode-purple { background: #1d1230; }
body.fs-mode-gold   { background: #2a2114; }
body.fs-mode-crimson{ background: #2a0f12; }

body.fs-mode-purple .frame,
body.fs-mode-gold .frame,
body.fs-mode-crimson .frame {
  position: relative;
}
body.fs-mode-purple .frame::after,
body.fs-mode-gold   .frame::after,
body.fs-mode-crimson .frame::after {
  /* Soft cinematic halo around the reel area — colour follows the mode.
     Pure decoration; clipped well inside the frame to avoid edge buzz. */
  content: "";
  position: absolute;
  inset: -8px;
  border-radius: 18px;
  pointer-events: none;
  z-index: 0;
}
body.fs-mode-purple .frame::after { box-shadow: 0 0 90px 8px rgba(173, 109, 255, 0.22) inset; }
body.fs-mode-gold   .frame::after { box-shadow: 0 0 90px 8px rgba(255, 214, 110, 0.20) inset; }
body.fs-mode-crimson .frame::after { box-shadow: 0 0 90px 8px rgba(255, 110, 110, 0.20) inset; }

/* FS HUD — slim horizontal bar pinned to the top of the viewport so it
   never disturbs the .stage grid auto-placement. Hidden by default;
   .fs-hud--active flips it on. */
.fs-hud {
  position: fixed;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  display: none;
  gap: 10px;
  padding: 8px 14px;
  background: rgba(0, 0, 0, 0.5);
  border: 1px solid var(--accent);
  border-radius: 14px;
  z-index: 50;
  font-family: inherit;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}
.fs-hud--active { display: flex; }
.fs-hud__box {
  display: flex;
  flex-direction: column;
  align-items: center;
  min-width: 70px;
}
.fs-hud__label {
  font-size: 0.55rem;
  color: var(--accent);
  opacity: 0.8;
  letter-spacing: 1.4px;
  text-transform: uppercase;
}
.fs-hud__value {
  font-size: 1rem;
  font-weight: 800;
  color: #ffe6a8;
  letter-spacing: 0.4px;
}
.fs-hud__divider {
  width: 1px;
  align-self: stretch;
  background: rgba(201, 162, 39, 0.35);
  margin: 2px 4px;
}

/* FS retrigger toast — bubbles up briefly when an additional FS award
   lands DURING the FS round (scatter re-detection or dev re-trigger). */
.fs-toast {
  position: fixed;
  top: 70px;
  left: 50%;
  transform: translateX(-50%) translateY(-8px);
  padding: 10px 22px;
  background: linear-gradient(180deg, #3a2a14, #1d1208);
  border: 1px solid var(--accent);
  border-radius: 999px;
  color: #ffe6a8;
  font-weight: 800;
  font-size: 0.9rem;
  letter-spacing: 2px;
  text-transform: uppercase;
  z-index: 60;
  opacity: 0;
  pointer-events: none;
  transition: opacity 280ms ease-out, transform 280ms ease-out;
  box-shadow: 0 6px 20px rgba(0, 0, 0, 0.55), 0 0 30px rgba(255, 214, 110, 0.35);
}
.fs-toast--show {
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

/* Full-stage modal placard — intro / outro.
   Backdrop-blurs the play area behind it. Always-on backdrop click is OFF;
   only the CTA dismisses to avoid accidental skip during big-win celebrations. */
.fs-overlay {
  position: fixed;
  inset: 0;
  display: none;
  align-items: center;
  justify-content: center;
  background: rgba(7, 5, 14, 0.55);
  backdrop-filter: blur(10px) saturate(1.1);
  z-index: 200;
  opacity: 0;
  transition: opacity 320ms ease-out;
}
.fs-overlay--show {
  display: flex;
  opacity: 1;
}
.fs-placard {
  width: min(420px, 86vw);
  padding: 32px 28px 26px;
  background: linear-gradient(180deg, #1a1228 0%, #0c0612 100%);
  border: 1px solid var(--accent);
  border-radius: 20px;
  text-align: center;
  box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75),
              inset 0 1px 0 rgba(255, 230, 168, 0.12),
              0 0 80px rgba(173, 109, 255, 0.18);
  transform: translateY(8px) scale(0.96);
  transition: transform 320ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.fs-overlay--show .fs-placard { transform: translateY(0) scale(1); }
body.fs-mode-gold    .fs-placard { box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 230, 168, 0.12), 0 0 80px rgba(255, 214, 110, 0.22); }
body.fs-mode-crimson .fs-placard { box-shadow: 0 30px 100px rgba(0, 0, 0, 0.75), inset 0 1px 0 rgba(255, 230, 168, 0.12), 0 0 80px rgba(255, 110, 110, 0.20); }

.fs-placard__eyebrow {
  font-size: 0.7rem;
  color: var(--accent);
  letter-spacing: 4px;
  text-transform: uppercase;
  opacity: 0.85;
  margin-bottom: 12px;
}
.fs-placard__title {
  font-size: 2rem;
  font-weight: 800;
  color: #ffe6a8;
  line-height: 1.05;
  letter-spacing: 1.5px;
  text-shadow: 0 6px 22px rgba(0, 0, 0, 0.65);
  margin-bottom: 6px;
}
.fs-placard__spins {
  font-size: 3.2rem;
  font-weight: 900;
  color: var(--accent);
  line-height: 1;
  text-shadow: 0 6px 24px rgba(0, 0, 0, 0.6), 0 0 32px rgba(255, 214, 110, 0.5);
  margin: 8px 0 6px;
}
.fs-placard__sub {
  font-size: 0.85rem;
  color: #d4dcef;
  opacity: 0.8;
  margin-bottom: 22px;
}
.fs-placard__cta {
  padding: 12px 28px;
  background: linear-gradient(180deg, #c9a227 0%, #8a6f15 100%);
  color: #1a1208;
  font-weight: 800;
  font-size: 0.9rem;
  letter-spacing: 2.5px;
  text-transform: uppercase;
  border: 1px solid #dbb840;
  border-radius: 999px;
  cursor: pointer;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5),
              inset 0 1px 0 rgba(255, 230, 168, 0.35);
  transition: transform 0.15s ease-out, box-shadow 0.15s ease-out;
}
.fs-placard__cta:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55),
              inset 0 1px 0 rgba(255, 230, 168, 0.45),
              0 0 24px rgba(255, 214, 110, 0.5);
}

/* Dev-mode FS trigger — pinned bottom-left of the viewport, outside the
   normal hub grid so it can't disturb the production layout. Always-on
   during development; production builds simply omit the button element. */
.dev-fs-btn {
  position: fixed;
  bottom: 14px;
  left: 14px;
  z-index: 100;
  width: 56px;
  height: 36px;
  border-radius: 10px;
  border: 1px dashed rgba(201, 162, 39, 0.55);
  background: rgba(0, 0, 0, 0.45);
  color: var(--accent);
  font-size: 0.55rem;
  font-weight: 800;
  letter-spacing: 1.5px;
  text-transform: uppercase;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0.55;
  transition: opacity 0.15s ease-out;
}
.dev-fs-btn:hover { opacity: 1; }
.dev-fs-btn:disabled { opacity: 0.2; cursor: not-allowed; }
</style></head><body>

<!-- Free Spins HUD — rendered always; toggled visible via .fs-hud--active.
     Three stat boxes: spins remaining · current multiplier · cumulative FS total.
     Position: fixed top-center of the viewport, so it never participates in
     the .stage CSS grid auto-placement. -->
<div class="fs-hud" id="fsHud" aria-hidden="true">
  <div class="fs-hud__box">
    <div class="fs-hud__label">Spins</div>
    <div class="fs-hud__value" id="fsHudSpins">0 / 0</div>
  </div>
  <div class="fs-hud__divider"></div>
  <div class="fs-hud__box">
    <div class="fs-hud__label">Mult</div>
    <div class="fs-hud__value" id="fsHudMult">×1</div>
  </div>
  <div class="fs-hud__divider"></div>
  <div class="fs-hud__box">
    <div class="fs-hud__label">Total</div>
    <div class="fs-hud__value" id="fsHudTotal">0.00</div>
  </div>
</div>
<!-- Retrigger / award toast — animates in & out on +N FS event. -->
<div class="fs-toast" id="fsToast" aria-hidden="true">+0 FREE SPINS</div>

<div class="stage">
  <div class="header">
    <div class="title">${escapeHtml(model.name)}</div>
    <div class="sub">${escapeHtml(layoutSub)}</div>
  </div>
  <div class="play">
    <div class="leftSpacer" aria-hidden="true"></div>
    <div class="frame" id="frameHost">
      <div class="gridHost" id="gridHost" data-kind="${shape.kind}"></div>
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

<!-- Free Spins full-stage overlay — intro & outro placards.
     Hidden by default. Layer is on top of EVERYTHING (z-index 200), so it
     reliably blurs the play area + hub during the cinematic moments. -->
<div class="fs-overlay" id="fsOverlay" role="dialog" aria-modal="true" aria-hidden="true">
  <div class="fs-placard">
    <div class="fs-placard__eyebrow" id="fsPlacardEyebrow">YOU TRIGGERED</div>
    <div class="fs-placard__title" id="fsPlacardTitle">FREE SPINS</div>
    <div class="fs-placard__spins" id="fsPlacardSpins">10</div>
    <div class="fs-placard__sub" id="fsPlacardSub">Free Spins begin now.</div>
    <button class="fs-placard__cta" id="fsPlacardCta" type="button">TAP TO BEGIN</button>
  </div>
</div>

<script>
  const POOL = ${JSON.stringify(pool.map(s => s.id))};
  const SHAPE = ${JSON.stringify(shape)};
  const FREESPINS = ${JSON.stringify(model.freeSpins || { enabled: false })};
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

  /* Track per-reel strips for the spin engine. Only populated for the
     "rectangular" kind — other shapes keep the original static render. */
  let RECT_REELS = null;
  let RECT_SIDE = 0;

  function renderRect() {
    const host = document.createElement("div");
    host.className = "grid-rect";
    const side = cellSize(REELS, ROWS);
    host.style.gridTemplateColumns = "repeat(" + REELS + ", " + side + "px)";
    host.style.gridTemplateRows = side + "px";  // single row of reel columns

    /* For rectangular slots we build N "reelCol" columns, each containing
       a vertically scrollable strip of cells. The visible window is exactly
       ROWS cells tall; the strip has extra cells above for spin animation. */
    if (SHAPE.kind === "rectangular") {
      RECT_REELS = [];
      RECT_SIDE = side;
      const reelH = ROWS * side + (ROWS - 1) * 6; // gap = 6 from token
      let symIdx = 0;
      for (let c = 0; c < REELS; c++) {
        const col = document.createElement("div");
        col.className = "reelCol";
        col.style.width = side + "px";
        col.style.height = reelH + "px";
        col.style.gridColumn = (c + 1) + " / " + (c + 2);
        col.style.gridRow = "1 / span " + ROWS;

        const strip = document.createElement("div");
        strip.className = "reelStrip";
        /* Strip carries ROWS + 2 buffer cells (1 above the visible window,
           1 below). During spin we rotate cells (pop bottom, unshift top,
           top gets a fresh random symbol) to create the illusion of an
           infinite scrolling reel — symbols are ALWAYS visible. */
        const stripCells = ROWS + 2;
        const cellRefs = [];
        for (let r = 0; r < stripCells; r++) {
          const cell = makeCell(symAt(symIdx++), "");
          cell.style.width = side + "px";
          cell.style.height = side + "px";
          cell.style.fontSize = (side * 0.32) + "px";
          cell.style.flex = "0 0 auto";
          strip.appendChild(cell);
          cellRefs.push(cell);
        }
        /* Initial position: strip shifted up by one cellStep so the top
           buffer cell sits ABOVE the visible window and the first visible
           row is the second strip cell. WoO trick: this gives us a hidden
           cell above to pop into view during the very first spin tick. */
        const cellStep = side + 6;
        strip.style.transform = "translateY(" + (-cellStep) + "px)";
        col.appendChild(strip);
        host.appendChild(col);
        RECT_REELS.push({
          col, strip, side, cellStep,
          cells: cellRefs,
          offsetPx: 0,         // accumulated scroll distance within current cell
          spinning: false,
          stopping: false,
          stopRequested: false,
          stopRequestTime: 0,
          targetY: -cellStep,  // resting position
          rotationCount: 0,
          minRotations: 8,
          stopDelayMs: 0,
        });
      }
      grid.appendChild(host);
      return;
    }

    /* All other rectangular-like kinds (cluster, lock_respin, megaclusters,
       infinity, expanding) keep the static cell-grid render. */
    host.style.gridTemplateRows = "repeat(" + ROWS + ", " + side + "px)";
    let idx = 0;
    for (let r = 0; r < ROWS; r++) {
      for (let c = 0; c < REELS; c++) {
        host.appendChild(makeCell(symAt(idx), SHAPE.kind === "lock_respin" ? "lockable" : ""));
        idx++;
      }
    }
    if (SHAPE.kind === "expanding" || SHAPE.kind === "infinity") {
      const tag = document.createElement("div");
      tag.className = "grow-tag";
      tag.textContent = SHAPE.kind === "infinity" ? "∞ horizontal" : "expand vertical";
      frame.appendChild(tag);
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
  const SPIN_PROFILE = {
    windupMs: 115, windupFrames: 7, windupPx: 42,
    accelMs: 130, steadyMs: 1350, decelMs: 300,
    staggerMs: 180,
    bouncePx: 6, bounceDecay: 0.3, bounceCount: 2, bounceElasticity: 1.8,
  };

  /* Public state of the engine */
  let spinTicker = null;
  let spinStartTime = 0;
  let allReelsActive = false;

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

  function commitStopSymbols(reel) {
    /* On stop: ensure the next ROWS visible cells (indexes 1..ROWS) get a
       fresh, settled outcome. The top buffer (index 0) and bottom buffer
       (last) are kept for the cushion bounce. */
    for (let i = 1; i <= ROWS; i++) {
      reel.cells[i].textContent = randomSym();
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
       schedule stop-request based on per-reel stagger. */
    RECT_REELS.forEach((reel, idx) => {
      reel.spinning = true;
      reel.stopping = false;
      reel.stopRequested = false;
      reel.rotationCount = 0;
      reel.offsetPx = 0;
      reel.cells.forEach(c => c.classList.add("is-blurring"));

      /* Reel stop is requested after windup + accel + steady + stagger.
         The reel will physically stop when rotationCount >= minRotations
         AND the delay has elapsed. */
      const requestDelay = SPIN_PROFILE.windupMs + SPIN_PROFILE.accelMs +
                           SPIN_PROFILE.steadyMs + idx * SPIN_PROFILE.staggerMs;
      setTimeout(() => {
        reel.stopRequested = true;
        reel.stopRequestTime = performance.now();
      }, requestDelay);
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
              commitStopSymbols(reel);
              /* targetY = -cellStep (resting position with top buffer above) */
              reel.targetY = -reel.cellStep;
            }
          }
        }

        /* Visual position: y oscillates between -cellStep and 0 */
        const rawY = reel.offsetPx - reel.cellStep;
        reel.strip.style.transform = "translateY(" + Math.round(rawY) + "px)";
      } else if (reel.stopping) {
        anyActive = true;
        const easingSpeed = 0.18;
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
    if (SHAPE.kind === "rectangular") {
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
    const cells = grid.querySelectorAll(".cell");
    if (cells.length === 0) {
      if (typeof onSettled === "function") setTimeout(onSettled, 60);
      return;
    }
    /* Phase 1: blur + dim. Phase 2 (after 220ms): swap text. Phase 3 (220ms
       later): clear blur & call onSettled. Total ~440ms — matches the
       cinematic "feel" of a rectangular spin without the 2s windup. */
    cells.forEach(c => c.classList.add("is-blurring"));
    setTimeout(() => {
      cells.forEach(c => { c.textContent = randomSym() || "?"; });
      setTimeout(() => {
        cells.forEach(c => c.classList.remove("is-blurring"));
        if (typeof onSettled === "function") onSettled();
      }, 220);
    }, 220);
  }

  /* Count how many trigger-symbols are visible on the current grid. For
     rectangular kinds we look at the VISIBLE strip rows (indexes 1..ROWS),
     not the buffer cells above/below the mask. Other kinds just count
     across every .cell. */
  function countTriggerSymbols() {
    const id = (FREESPINS.triggerSymbol || "S").toUpperCase();
    if (SHAPE.kind === "rectangular" && RECT_REELS) {
      let n = 0;
      for (const reel of RECT_REELS) {
        for (let i = 1; i <= ROWS; i++) {
          if ((reel.cells[i].textContent || "").toUpperCase() === id) n++;
        }
      }
      return n;
    }
    let n = 0;
    grid.querySelectorAll(".cell").forEach(c => {
      if ((c.textContent || "").toUpperCase() === id) n++;
    });
    return n;
  }

  /* Map a scatter count to the awarded number of spins, using the GDD's
     award table. Returns 0 if the count doesn't trigger anything. */
  function spinsForCount(count) {
    if (!FREESPINS.enabled) return 0;
    /* Match the highest threshold ≤ count. */
    const awards = (FREESPINS.awards || []).slice().sort((a, b) => a.count - b.count);
    let award = 0;
    for (const a of awards) {
      if (count >= a.count) award = a.spins;
    }
    return award;
  }

  /* Post-spin trigger evaluation. Called from both base-game spins and FS
     in-round spins; the duringFs flag decides whether a scatter hit is a
     fresh trigger (BASE) or a retrigger (FS). */
  function handlePostSpin(duringFs) {
    if (!FREESPINS.enabled) {
      /* No FS configured — nothing to do; FSM stays in BASE. */
      if (duringFs) FSM_runNextFsSpin();
      return;
    }
    const scatters = countTriggerSymbols();
    if (!duringFs) {
      const award = spinsForCount(scatters);
      if (award > 0) FSM_enterIntro(award, scatters);
      return;
    }
    /* During FS: check for retrigger. The retrigger threshold is usually
       lower than the initial trigger (e.g. 3S = +5 spins). Hard-cap the
       per-round retrigger count at 3 so a high-density placeholder symbol
       pool can't drive the round to infinity (industry standard upper
       bound — most operators cap retrigger chains at 2–5 per round). */
    const RETRIGGER_CAP = 3;
    if (FREESPINS.retrigger && FREESPINS.retrigger.enabled &&
        scatters >= FREESPINS.retrigger.count &&
        FSM.retrigCount < RETRIGGER_CAP) {
      FSM_handleRetrigger(FREESPINS.retrigger.spins);
    }
    /* Progressive multiplier escalation — bump on every FS spin that doesn't
       blow the cap, regardless of win/loss (this is the most common policy;
       GDD-specific "only on winning spins" can be wired later via the math
       layer). */
    if (FREESPINS.multiplier && FREESPINS.multiplier.type === "progressive") {
      FSM.mult = Math.min(FSM.mult + FREESPINS.multiplier.step, FREESPINS.multiplier.cap);
    }
    /* Placeholder per-spin "win" — pure visual filler until the math layer
       lands. Random 0–25× bet, weighted toward zero so the total looks
       plausible after a 10-spin round. */
    const fakeWin = Math.random() < 0.4 ? +(Math.random() * 25 * (FSM.mult || 1)).toFixed(2) : 0;
    FSM.totalWin += fakeWin;

    FSM.spinsRemaining--;
    FSM_renderHud();

    if (FSM.spinsRemaining <= 0) {
      FSM_enterOutro();
    } else {
      /* Brief breath between FS spins so the player can track the result. */
      setTimeout(FSM_runNextFsSpin, 650);
    }
  }

  /* ─── FSM · phases: BASE → FS_INTRO → FS_ACTIVE → FS_OUTRO → BASE ────── */
  const FSM = {
    phase: "BASE",
    spinsTotal: 0,
    spinsRemaining: 0,
    mult: 1,
    totalWin: 0,
    retrigCount: 0,
  };
  /* Expose FSM and FREESPINS on window so the QA harness (Playwright eval)
     can probe state without scraping DOM text. No-op in production. */
  if (typeof window !== "undefined") {
    window.FSM = FSM;
    window.FREESPINS = FREESPINS;
    window.SHAPE = SHAPE;
  }

  /* Cached DOM handles for the FS UI — looked up once at boot. */
  const fsHud      = document.getElementById("fsHud");
  const fsHudSpins = document.getElementById("fsHudSpins");
  const fsHudMult  = document.getElementById("fsHudMult");
  const fsHudTotal = document.getElementById("fsHudTotal");
  const fsToast    = document.getElementById("fsToast");
  const fsOverlay  = document.getElementById("fsOverlay");
  const fsPlacardEyebrow = document.getElementById("fsPlacardEyebrow");
  const fsPlacardTitle   = document.getElementById("fsPlacardTitle");
  const fsPlacardSpins   = document.getElementById("fsPlacardSpins");
  const fsPlacardSub     = document.getElementById("fsPlacardSub");
  const fsPlacardCta     = document.getElementById("fsPlacardCta");
  const devFsBtn   = document.getElementById("devFsBtn");
  const statusElGlobal = document.getElementById("status");

  function FSM_renderHud() {
    if (!fsHud) return;
    const consumed = FSM.spinsTotal - FSM.spinsRemaining;
    fsHudSpins.textContent = consumed + " / " + FSM.spinsTotal;
    fsHudMult.textContent  = "×" + (FSM.mult || 1);
    fsHudTotal.textContent = FSM.totalWin.toFixed(2);
  }

  function FSM_showFsMode() {
    const mode = (FREESPINS.bgMode || "purple").toLowerCase();
    document.body.classList.remove("fs-mode-purple", "fs-mode-gold", "fs-mode-crimson");
    document.body.classList.add("fs-mode-" + mode);
    fsHud.classList.add("fs-hud--active");
    fsHud.setAttribute("aria-hidden", "false");
  }

  function FSM_hideFsMode() {
    document.body.classList.remove("fs-mode-purple", "fs-mode-gold", "fs-mode-crimson");
    fsHud.classList.remove("fs-hud--active");
    fsHud.setAttribute("aria-hidden", "true");
  }

  function FSM_showOverlay() {
    fsOverlay.classList.add("fs-overlay--show");
    fsOverlay.setAttribute("aria-hidden", "false");
  }
  function FSM_hideOverlay() {
    fsOverlay.classList.remove("fs-overlay--show");
    fsOverlay.setAttribute("aria-hidden", "true");
  }

  function FSM_showToast(text, duration) {
    if (!fsToast) return;
    fsToast.textContent = text;
    fsToast.classList.add("fs-toast--show");
    fsToast.setAttribute("aria-hidden", "false");
    clearTimeout(fsToast._t);
    fsToast._t = setTimeout(() => {
      fsToast.classList.remove("fs-toast--show");
      fsToast.setAttribute("aria-hidden", "true");
    }, duration || 1800);
  }

  function FSM_enterIntro(spinsAwarded, scatterCount) {
    FSM.phase = "FS_INTRO";
    FSM.spinsTotal = spinsAwarded;
    FSM.spinsRemaining = spinsAwarded;
    FSM.mult = (FREESPINS.multiplier && FREESPINS.multiplier.start) || 1;
    FSM.totalWin = 0;
    FSM.retrigCount = 0;

    fsPlacardEyebrow.textContent = scatterCount
      ? scatterCount + " SCATTERS TRIGGERED"
      : "YOU TRIGGERED";
    fsPlacardTitle.textContent   = (FREESPINS.introLabel || "FREE SPINS").toUpperCase();
    fsPlacardSpins.textContent   = String(spinsAwarded);
    fsPlacardSub.textContent     = "Free Spins begin now.";
    fsPlacardCta.textContent     = "TAP TO BEGIN";

    /* Lock UI: block manual spin button + dev FS button while overlay is up. */
    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    statusElGlobal && (statusElGlobal.textContent = "FS · READY");

    FSM_showOverlay();
  }

  function FSM_enterActive() {
    FSM.phase = "FS_ACTIVE";
    FSM_hideOverlay();
    FSM_showFsMode();
    FSM_renderHud();
    spinButton && (spinButton.disabled = true);
    devFsBtn   && (devFsBtn.disabled   = true);
    /* Kick the first spin after a short visual breath so the player tracks
       the transition into FS mode (frame halo, BG swap, HUD appear). */
    setTimeout(FSM_runNextFsSpin, 420);
  }

  function FSM_runNextFsSpin() {
    if (FSM.phase !== "FS_ACTIVE") return;
    statusElGlobal && (statusElGlobal.textContent =
      "FS · " + ((FSM.spinsTotal - FSM.spinsRemaining) + 1) + " / " + FSM.spinsTotal);

    if (SHAPE.kind === "rectangular") {
      startSpinAll(() => handlePostSpin(true));
    } else {
      runStaticReroll(() => handlePostSpin(true));
    }
  }

  function FSM_handleRetrigger(extraSpins) {
    FSM.spinsTotal += extraSpins;
    FSM.spinsRemaining += extraSpins;
    FSM.retrigCount++;
    FSM_renderHud();
    FSM_showToast("+" + extraSpins + " FREE SPINS", 1600);
  }

  function FSM_enterOutro() {
    FSM.phase = "FS_OUTRO";
    fsPlacardEyebrow.textContent = (FREESPINS.outroLabel || "FREE SPINS COMPLETE").toUpperCase();
    fsPlacardTitle.textContent   = "TOTAL WIN";
    fsPlacardSpins.textContent   = FSM.totalWin.toFixed(2);
    fsPlacardSub.textContent     = FSM.retrigCount > 0
      ? FSM.retrigCount + " retrigger" + (FSM.retrigCount === 1 ? "" : "s") +
        " across " + FSM.spinsTotal + " spins."
      : FSM.spinsTotal + " spins played.";
    fsPlacardCta.textContent     = "RETURN TO BASE";
    statusElGlobal && (statusElGlobal.textContent = "FS · COMPLETE");

    FSM_showOverlay();
  }

  function FSM_enterBase() {
    FSM.phase = "BASE";
    FSM_hideOverlay();
    FSM_hideFsMode();
    spinButton && (spinButton.disabled = false);
    devFsBtn   && (devFsBtn.disabled   = !FREESPINS.enabled);
    statusElGlobal && (statusElGlobal.textContent = "PRESS SPIN");
  }

  /* Placard CTA — advances the FSM. Single button drives both intro→active
     and outro→base transitions; behaviour depends on current phase. */
  if (fsPlacardCta) {
    fsPlacardCta.addEventListener("click", () => {
      if (FSM.phase === "FS_INTRO") FSM_enterActive();
      else if (FSM.phase === "FS_OUTRO") FSM_enterBase();
    });
  }

  /* Dev-only FS trigger — fires the lowest-count award from the GDD ladder
     so the FS round actually starts (not just a zero-spin no-op). Disabled
     when the GDD has no FS config. */
  if (devFsBtn) {
    devFsBtn.disabled = !FREESPINS.enabled;
    devFsBtn.addEventListener("click", () => {
      if (FSM.phase !== "BASE" || !FREESPINS.enabled) return;
      const first = (FREESPINS.awards && FREESPINS.awards[0]) || { count: 3, spins: 10 };
      FSM_enterIntro(first.spins, first.count);
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
    switch (SHAPE.kind) {
      case "rectangular":
      case "cluster":
      case "lock_respin":
      case "megaclusters":
      case "infinity":
      case "expanding":
        return renderRect();
      case "variable_reel":
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
