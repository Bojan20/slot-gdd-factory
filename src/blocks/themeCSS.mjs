/**
 * src/blocks/themeCSS.mjs
 *
 * Wave T-slim — extract of the slot-template "chrome" CSS that previously
 * lived inline in `src/buildSlotHTML.mjs` (lines ~273-555, ≈280 LOC).
 *
 * What this block covers (the parts that are NOT a feature, just the
 * cabinet around the reels):
 *   • CSS reset + :root tokens (palette, gaps, radii, frame shadow)
 *   • body / .stage layout grid (header + play + hub three-row layout)
 *   • .header / .title / .sub
 *   • .play 3-column grid (spin-rail spacers + frame + sideHud)
 *   • .frame container
 *   • .sideHud column with .spinBtn + .autoBtn
 *   • .hub bottom bar (.iconBtn / .statBox / .betGroup / .betStep)
 *   • .gridHost positioning anchor
 *   • Responsive breakpoints at 1100 / 920 / 820 / 620
 *
 * This is NOT a lifecycle block — it has no HookBus listeners. It is pure
 * server-side CSS emission, parameterised on the palette + cell radius.
 * Treated by the LEGO gate the same way as reelEngineCSS.mjs (pure CSS).
 *
 * Bake-time config (resolved from `model.themeCSS`, plus palette default):
 *   palette        { bg0, bg1, accent, text }  hex colors
 *   cellGap        px gap between cells inside the grid       (default 6)
 *   cellRadius     px corner radius on each cell tile         (default 10)
 *   frameRadius    px corner radius on the .frame container   (default 16)
 *   frameInset     px padding inside .frame around the grid   (default 18)
 *                  — industry standard 18px keeps ~1rem
 *                  breathing room between frame edge + cells
 *                  so the reel mask never visually touches the
 *                  cabinet trim under high-zoom displays.
 *   spinRailDesktop  px side-rail width in desktop layout
 *   spinSizeDesktop  px diameter of spin button (desktop)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitThemeCSS(cfg)  → full chrome CSS as a string
 */

const DEFAULT_PALETTE = Object.freeze({
  bg0:    '#05070c',
  bg1:    '#0b0f16',
  accent: '#c9a227',
  text:   '#f2f2f2',
});

export function defaultConfig() {
  return {
    palette: { ...DEFAULT_PALETTE },
    cellGap: 6,
    cellRadius: 10,
    frameRadius: 16,
    frameInset: 18,
  };
}

/* Accept either `model.themeCSS.palette` or fall back to `model.theme.palette`
 * (the existing parser slot) for backward compat. */
export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const src = (model && model.themeCSS) || {};

  /* Pull palette from explicit themeCSS override OR from existing theme array. */
  if (src.palette && typeof src.palette === 'object') {
    if (/^#[0-9a-fA-F]{3,8}$/.test(src.palette.bg0 || ''))    cfg.palette.bg0    = src.palette.bg0;
    if (/^#[0-9a-fA-F]{3,8}$/.test(src.palette.bg1 || ''))    cfg.palette.bg1    = src.palette.bg1;
    if (/^#[0-9a-fA-F]{3,8}$/.test(src.palette.accent || '')) cfg.palette.accent = src.palette.accent;
    if (/^#[0-9a-fA-F]{3,8}$/.test(src.palette.text || ''))   cfg.palette.text   = src.palette.text;
  } else if (model.theme && Array.isArray(model.theme.palette)) {
    const p = model.theme.palette;
    if (typeof p[0] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p[0])) cfg.palette.bg0    = p[0];
    if (typeof p[1] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p[1])) cfg.palette.bg1    = p[1];
    if (typeof p[2] === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(p[2])) cfg.palette.accent = p[2];
  }

  for (const key of ['cellGap', 'cellRadius', 'frameRadius', 'frameInset']) {
    if (Number.isFinite(src[key])) cfg[key] = Math.max(0, Math.min(64, Math.round(src[key])));
  }

  return cfg;
}

export function emitThemeCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ themeCSS: cfg });
  const { bg0, bg1, accent, text } = c.palette;
  return `
  /* ── Chrome theme — emitted by src/blocks/themeCSS.mjs ─────────────── */
  * { box-sizing: border-box; margin: 0; padding: 0; }
  :root {
    --bg0: ${bg0};
    --bg1: ${bg1};
    --accent: ${accent};
    --text: ${text};
    --frame-inset: ${c.frameInset}px;
    --cell-gap: ${c.cellGap}px;
    --cell-radius: ${c.cellRadius}px;
    --frame-radius: ${c.frameRadius}px;
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
  /* SPIN button — industry-reference base-game dimensions (150px desktop),
     3D metal gold border + multi-layer radial gradient. Circular
     "refresh / two arrows" icon used by every major slot vendor. */
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
  .spinBtn.is-spinning { pointer-events: none; opacity: 0.78; }
  .spinBtn.is-spinning svg { opacity: 0.55; }
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
    /* 4 children: menu | balanceHud | betSelector | sound. */
    grid-template-columns: 40px minmax(220px, 2fr) minmax(180px, 1.4fr) 40px;
    align-items: center;
    gap: clamp(6px, 1vw, 12px);
    padding: clamp(6px, 1vw, 10px) clamp(8px, 1.5vw, 16px);
    background: linear-gradient(180deg, rgba(30, 25, 20, 0.7), rgba(10, 8, 6, 0.85));
    border: 1px solid rgba(201, 162, 39, 0.22);
    border-radius: 14px;
    box-shadow: inset 0 1px 0 rgba(255, 230, 168, 0.05), 0 4px 14px rgba(0, 0, 0, 0.45);
  }
  @media (max-width: 820px) {
    .hub {
      grid-template-columns: 36px minmax(170px, 2fr) minmax(140px, 1.3fr) 36px;
      padding: 8px 10px;
      gap: 8px;
    }
  }
  @media (max-width: 620px) {
    .hub {
      /* Stack: row 1 = menu + balance + sound; row 2 = bet selector full
       * width. Keeps every interactive control inside the 390px iPhone
       * viewport without horizontal scroll. */
      grid-template-columns: 32px 1fr 32px;
      grid-template-rows: auto auto;
      grid-template-areas:
        "menu balance sound"
        "bet  bet     bet";
      row-gap: 6px;
      column-gap: 6px;
      padding: 8px;
    }
    .hub > :nth-child(1) { grid-area: menu; }
    .hub > :nth-child(2) { grid-area: balance; justify-self: center; }
    .hub > :nth-child(3) { grid-area: bet;     justify-self: stretch; }
    .hub > :nth-child(4) { grid-area: sound; }
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
    position: relative;
  }
`;
}

/* Dev-tools CSS — .grow-tag indicator + .dev-fs-btn (top-right pinned
 * "force FS" button used only during development; production builds
 * simply don't render the markup). Extracted from inline orchestrator
 * during Wave T-slim. */
export function emitDevToolsCSS() {
  return `
  /* ── Dev-tools CSS — emitted by src/blocks/themeCSS.mjs ─────────────── */
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
  /* Dev-mode FS trigger — pinned top-right of the viewport. Always-on
     during development; production builds simply omit the button element.
     Responsive: scales with viewport via clamp(), safe-area insets for
     notch / home-indicator. */
  .dev-fs-btn {
    position: fixed;
    top:   max(10px, env(safe-area-inset-top, 10px));
    right: max(10px, env(safe-area-inset-right, 10px));
    z-index: 2147483000;
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
  @media (max-width: 820px) {
    .dev-fs-btn {
      top:   max(8px, env(safe-area-inset-top, 8px));
      right: max(8px, env(safe-area-inset-right, 8px));
    }
  }
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
`;
}

/* Grid-shape CSS — pulled out of buildSlotHTML too. Pure CSS, no state. */
export function emitGridShapesCSS() {
  return `
  /* ── Grid-shape layout CSS — emitted by src/blocks/themeCSS.mjs ────── */
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
  .wheel-svg { width: 80%; max-width: 480px; aspect-ratio: 1 / 1; }
`;
}
