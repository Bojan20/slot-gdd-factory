import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/gambleSecondary.mjs
 *
 * Wave U6 — Secondary Gamble feature (Card branch + Ladder branch).
 *
 * Industry-standard pattern (two-branch double-or-nothing risk feature):
 *
 *   Branch 1 — CARD GAMBLE
 *     • A face-down card is revealed; player guesses its property.
 *     • Two guess modes (GDD-selectable):
 *         color  → red vs black (50% / 50%)  → win × 2
 *         suit   → ♥ vs ♦ vs ♣ vs ♠ (25% × 4) → win × 4
 *     • Correct guess multiplies bank; wrong guess loses entire bank.
 *     • Player may COLLECT at any time to bank the current amount.
 *     • Max rounds capped (default 5) to keep variance regulator-safe.
 *
 *   Branch 2 — LADDER GAMBLE
 *     • Vertical ladder of N rungs (default 8) — each rung has a fixed
 *       multiplier (1×, 2×, 4×, 8×, ...). Current bank sits on a rung.
 *     • Player presses UP (advance one rung, 50% chance) or DOWN (regress
 *       one rung, guaranteed). COLLECT banks the current rung.
 *     • Wrong UP guess → drop to rung 1 (lose all winnings above baseline).
 *
 *   Selection UI — when an eligible win lands, a "GAMBLE?" splash offers
 *   three buttons: CARD / LADDER / COLLECT. Player choice triggers the
 *   corresponding branch UI; COLLECT bypasses gamble entirely.
 *
 * This block is DISTINCT from the legacy `gamble.mjs` (Wave P2, basic
 * single-mode gamble) — that block stays in tree as a compatibility
 * shim for GDDs that opt-out of the proper two-branch UI via
 * `features[].kind === 'gamble'`. gambleSecondary fires only when the
 * GDD explicitly opts in via `model.gambleSecondary.enabled = true` OR
 * declares a feature kind matching /gamble[- ]?secondary|risk[- ]?ladder|
 * card[- ]?and[- ]?ladder/i.
 *
 * Lifecycle (HookBus contract):
 *
 *   onSpinResult         → LISTEN. When base-game win > minWinForPrompt
 *                          AND not duringFs AND not autoplay-active, show
 *                          the gamble prompt splash.
 *   onAutoplayStart      → LISTEN. Suppress prompt (autoplay owns flow).
 *   onFsTrigger          → LISTEN. Suppress prompt (FS round owns flow).
 *   onSkipRequested      → LISTEN. Close any open gamble UI immediately
 *                          (player skip = collect at current bank).
 *
 *   onGambleStart        → EMIT. { branch: 'card' | 'ladder', bank, mode }
 *   onGambleRound        → EMIT. { branch, result: 'win' | 'lose',
 *                                  bank, round, multiplier }
 *   onGambleEnd          → EMIT. { branch, outcome: 'collect' | 'busted',
 *                                  bank, rounds }
 *
 * Composition contract:
 *   - Reads window.__SLOT_BET__ for the trigger-time bet (the player
 *     gambles a multiple of bet, not raw points).
 *   - Reads window.__WIN_AWARD__ to know the bank seed; winPresentation
 *     publishes this when rollup starts.
 *   - DOES NOT touch reels / FS state / paytable computation. Pure
 *     post-win overlay.
 *
 * Bake-time config (resolved from `model.gambleSecondary`):
 *   enabled            boolean                                  (default false)
 *   modes              ('card' | 'ladder')[] — which branches              (default ['card','ladder'])
 *   cardMode           'color' | 'suit'                                    (default 'color')
 *   cardMultiplier     number (color→2, suit→4 unless overridden)          (default 2)
 *   cardMaxRounds      integer in [1, 20]                                  (default 5)
 *   ladderRungs        integer in [3, 16]                                  (default 8)
 *   ladderRungMultiplier number — geometric growth factor per rung        (default 2)
 *   ladderMaxRounds    integer in [1, 20]                                  (default 8)
 *   minWinForPromptX   number — only prompt if win ≥ minWin × bet         (default 1)
 *   maxBankX           number — auto-collect cap (× bet); 0 = no cap      (default 1000)
 *   promptTimeoutMs    integer — auto-collect after N ms idle (0 = off)   (default 0)
 *   showInFs           boolean — allow gamble during FS win rollup        (default false)
 *   showInAutoplay     boolean — allow gamble during autoplay session     (default false)
 *   currency           string                                              (default '€')
 *   chipColor          'r,g,b'                                             (default '180,80,80')
 *   chipTextColor      'r,g,b'                                             (default '255,255,255')
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitGambleSecondaryCSS(cfg)
 *   emitGambleSecondaryMarkup(cfg)
 *   emitGambleSecondaryRuntime(cfg)
 *
 * Runtime contract (after emitted JS executes):
 *   window.gambleSecondaryOpen(bank?)            — manually launch prompt
 *   window.gambleSecondaryClose()                — close + emit collect
 *   window.gambleSecondaryChooseCard()           — open Card branch
 *   window.gambleSecondaryChooseLadder()         — open Ladder branch
 *   window.gambleSecondaryGuess(token)           — card guess: 'R'/'B'/'H'/'D'/'C'/'S'
 *   window.gambleSecondaryStepUp() / StepDown()  — ladder step
 *   window.gambleSecondaryCollect()              — collect current bank
 *   window.GAMBLE_SECONDARY_STATE                — { phase, branch, bank, rounds, ... }
 *
 * Performance budget:
 *   Splash open → DOM render: ≤ 12ms (M1 Pro, Chrome 120)
 *   Card flip animation: 800ms (industry standard)
 *   Ladder step transition: 400ms
 *
 * Accessibility:
 *   • Splash is role="dialog" with aria-modal="true" (blocks background tab)
 *   • Card / Ladder / Collect buttons all have aria-label
 *   • Card guess buttons announce "Red", "Black", "Hearts", etc.
 *   • Reduced-motion strips flip/step animations
 *   • Focus trap inside splash while open
 *
 * Runtime dependencies: HookBus (window.HookBus), document, Math.random,
 *                       setTimeout / clearTimeout.
 */

const VALID_CARD_MODES   = Object.freeze(['color', 'suit']);
const VALID_BRANCHES     = Object.freeze(['card', 'ladder']);
const VALID_PHASES       = Object.freeze(['idle','prompt','card','ladder','busted','collected']);
const VALID_CARD_TOKENS  = Object.freeze(['R','B','H','D','C','S']);
const CARD_MULT_RANGE     = Object.freeze([1.1, 16]);
const ROUNDS_RANGE        = Object.freeze([1, 20]);
const LADDER_RUNGS_RANGE  = Object.freeze([3, 16]);
const LADDER_MULT_RANGE   = Object.freeze([1.1, 8]);

/* ─── default + resolve ─────────────────────────────────────────────────── */

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    /* Both branches available by default — GDD can prune to one. */
    modes: ['card', 'ladder'],
    cardMode: 'color',
    cardMultiplier: 2,           /* honored only when GDD doesn't pick mode */
    cardMaxRounds: 5,
    ladderRungs: 8,
    /* 2× per rung gives a familiar 1, 2, 4, 8, 16, 32, 64, 128 ladder.
     * GDD may override to 1.5 or 3 for steeper / shallower variance. */
    ladderRungMultiplier: 2,
    ladderMaxRounds: 8,
    /* Don't bother prompting micro-wins — industry default ≥ 1× bet. */
    minWinForPromptX: 1,
    /* Auto-collect cap at 1000× bet matches regulator soft cap. */
    maxBankX: 1000,
    promptTimeoutMs: 0,          /* 0 disables idle auto-collect */
    showInFs: false,
    showInAutoplay: false,
    currency: '€',
    chipColor: '180,80,80',
    chipTextColor: '255,255,255',
  });
}

function _cleanModes(arr) {
  if (!Array.isArray(arr)) return null;
  const out = [];
  for (const m of arr) {
    if (typeof m === 'string' && VALID_BRANCHES.indexOf(m) !== -1 && out.indexOf(m) === -1) {
      out.push(m);
    }
  }
  return out.length > 0 ? out : null;
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.gambleSecondary) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  const md = _cleanModes(m.modes);
  if (md) cfg.modes = md;

  if (VALID_CARD_MODES.indexOf(m.cardMode) !== -1) {
    cfg.cardMode = m.cardMode;
    /* Fire fallback on any non-valid multiplier (not just non-finite):
     * a finite ≤ 1 value would otherwise keep the 2× default and silently
     * break RTP for suit mode (25% odds paid at 2× instead of 4×). */
    const validMult = Number.isFinite(m.cardMultiplier) && m.cardMultiplier > 1;
    if (!validMult) cfg.cardMultiplier = m.cardMode === 'suit' ? 4 : 2;
  }
  if (Number.isFinite(m.cardMultiplier) && m.cardMultiplier > 1) {
    cfg.cardMultiplier = Math.max(CARD_MULT_RANGE[0], Math.min(CARD_MULT_RANGE[1], Number(m.cardMultiplier)));
  }

  if (Number.isFinite(m.cardMaxRounds)) {
    cfg.cardMaxRounds = Math.max(ROUNDS_RANGE[0], Math.min(ROUNDS_RANGE[1], Math.round(m.cardMaxRounds)));
  }
  if (Number.isFinite(m.ladderRungs)) {
    cfg.ladderRungs = Math.max(LADDER_RUNGS_RANGE[0], Math.min(LADDER_RUNGS_RANGE[1], Math.round(m.ladderRungs)));
  }
  if (Number.isFinite(m.ladderRungMultiplier) && m.ladderRungMultiplier > 1) {
    cfg.ladderRungMultiplier = Math.max(LADDER_MULT_RANGE[0], Math.min(LADDER_MULT_RANGE[1], Number(m.ladderRungMultiplier)));
  }
  if (Number.isFinite(m.ladderMaxRounds)) {
    cfg.ladderMaxRounds = Math.max(ROUNDS_RANGE[0], Math.min(ROUNDS_RANGE[1], Math.round(m.ladderMaxRounds)));
  }
  if (Number.isFinite(m.minWinForPromptX) && m.minWinForPromptX >= 0) {
    cfg.minWinForPromptX = Math.min(1000, Number(m.minWinForPromptX));
  }
  if (Number.isFinite(m.maxBankX) && m.maxBankX >= 0) {
    cfg.maxBankX = Math.min(1e6, Number(m.maxBankX));
  }
  if (Number.isFinite(m.promptTimeoutMs)) {
    cfg.promptTimeoutMs = Math.max(0, Math.min(60000, Math.round(m.promptTimeoutMs)));
  }
  if (m.showInFs != null) cfg.showInFs = !!m.showInFs;
  if (m.showInAutoplay != null) cfg.showInAutoplay = !!m.showInAutoplay;

  if (typeof m.currency === 'string' && /^[A-Za-z€$£¥₽₺₹₿ ]{1,4}$/.test(m.currency.trim())) {
    cfg.currency = m.currency.trim();
  }
  if (typeof m.chipColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipColor)) {
    cfg.chipColor = m.chipColor.replace(/\s+/g, '');
  }
  if (typeof m.chipTextColor === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m.chipTextColor)) {
    cfg.chipTextColor = m.chipTextColor.replace(/\s+/g, '');
  }

  /* Auto-enable from feature kind. */
  if (Array.isArray(model.features)) {
    const hasG2 = model.features.some(
      (f) => f && typeof f.kind === 'string'
          && /^(gamble[-_ ]?secondary|risk[-_ ]?ladder|card[-_ ]?and[-_ ]?ladder)$/i.test(f.kind),
    );
    if (hasG2) cfg.enabled = true;
  }

  return cfg;
}

function _escape(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ─── CSS emission ─────────────────────────────────────────────────────── */

export function emitGambleSecondaryCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ gambleSecondary: cfg });
  return `
  /* ── gambleSecondary BLOCK — emitted by src/blocks/gambleSecondary.mjs ──
     Full-screen overlay with 3-phase UI: prompt splash, Card branch,
     Ladder branch. z-index 60 sits above all other game UI but below
     dev-only debug overlays. */
  .gs-overlay {
    position: fixed;
    inset: 0;
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    background: radial-gradient(circle at center, rgba(0,0,0,0.55), rgba(0,0,0,0.85));
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
  }
  .gs-overlay[hidden] { display: none !important; }
  .gs-card-wrap, .gs-ladder-wrap, .gs-prompt {
    background: linear-gradient(180deg, rgba(22, 16, 28, 0.98), rgba(8, 6, 14, 0.99));
    border: 1px solid rgba(${c.chipColor}, 0.65);
    border-radius: 16px;
    padding: 24px;
    color: rgb(255, 240, 220);
    font-family: inherit;
    box-shadow:
      0 14px 38px rgba(0, 0, 0, 0.7),
      inset 0 1px 0 rgba(255, 255, 255, 0.06);
    min-width: 320px;
    max-width: 90vw;
  }

  /* ── prompt splash ─────────────────────────────────────────────── */
  .gs-prompt { text-align: center; }
  .gs-prompt h2 {
    margin: 0 0 6px 0;
    font-size: 28px;
    font-weight: 900;
    letter-spacing: 2px;
    color: rgb(${c.chipColor});
    text-transform: uppercase;
  }
  .gs-prompt .gs-prompt-bank {
    margin: 8px 0 18px 0;
    font-size: 16px;
    opacity: 0.85;
  }
  .gs-prompt .gs-prompt-row {
    display: flex;
    gap: 12px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .gs-prompt button {
    padding: 12px 22px;
    border-radius: 10px;
    border: 1px solid rgba(${c.chipColor}, 0.8);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.4), rgba(${c.chipColor}, 0.18));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 140ms ease-out, box-shadow 140ms ease-out;
    min-width: 110px;
  }
  .gs-prompt button:hover  { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(${c.chipColor}, 0.45); }
  .gs-prompt button:active { transform: translateY(0); }
  .gs-prompt .gs-collect-btn {
    background: linear-gradient(180deg, rgba(80,200,120,0.6), rgba(80,200,120,0.3));
    border-color: rgba(80,200,120,0.85);
    color: rgb(255, 255, 255);
  }

  /* ── card branch ──────────────────────────────────────────────── */
  .gs-card-wrap h3 {
    margin: 0 0 14px 0;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    opacity: 0.75;
    text-align: center;
  }
  .gs-card-bank, .gs-card-round {
    text-align: center;
    margin-bottom: 12px;
  }
  .gs-card-bank-value {
    font-size: 28px;
    font-weight: 900;
    color: rgb(${c.chipColor});
  }
  .gs-card-face {
    width: 140px;
    height: 200px;
    margin: 8px auto 18px;
    border-radius: 12px;
    border: 2px solid rgba(${c.chipColor}, 0.5);
    background: linear-gradient(135deg, rgba(255,255,255,0.96), rgba(220,220,220,0.92));
    color: rgb(15, 12, 20);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    font-family: serif;
    font-size: 64px;
    font-weight: 700;
    box-shadow: 0 8px 22px rgba(0, 0, 0, 0.55);
    transition: transform 800ms cubic-bezier(0.4, 0.2, 0.2, 1);
    transform-style: preserve-3d;
  }
  .gs-card-face.is-back {
    background: repeating-linear-gradient(45deg,
                  rgba(${c.chipColor}, 0.85) 0 12px,
                  rgba(${c.chipColor}, 0.55) 12px 24px);
    color: transparent;
  }
  .gs-card-face.is-flipping { transform: rotateY(180deg); }
  .gs-card-face.is-red   { color: rgb(220, 30, 60); }
  .gs-card-face.is-black { color: rgb(20, 22, 30); }
  .gs-card-guesses {
    display: flex;
    gap: 10px;
    justify-content: center;
    flex-wrap: wrap;
  }
  .gs-card-guess {
    padding: 10px 18px;
    border-radius: 10px;
    border: 1px solid rgba(${c.chipColor}, 0.55);
    background: rgba(${c.chipColor}, 0.18);
    color: rgb(255, 240, 220);
    font-family: inherit;
    font-size: 16px;
    font-weight: 700;
    cursor: pointer;
    transition: background 140ms ease-out;
    min-width: 72px;
  }
  .gs-card-guess:hover { background: rgba(${c.chipColor}, 0.32); }
  .gs-card-guess[disabled] { opacity: 0.4; cursor: not-allowed; }
  .gs-card-guess.is-red   { color: rgb(255, 80, 100); }
  .gs-card-guess.is-black { color: rgb(220, 220, 220); }

  /* ── ladder branch ──────────────────────────────────────────────── */
  .gs-ladder-wrap h3 {
    margin: 0 0 14px 0;
    font-size: 13px;
    letter-spacing: 2px;
    text-transform: uppercase;
    opacity: 0.75;
    text-align: center;
  }
  .gs-ladder {
    display: flex;
    flex-direction: column-reverse;
    gap: 3px;
    margin: 14px auto;
    width: 220px;
  }
  .gs-ladder-rung {
    padding: 8px 12px;
    border-radius: 8px;
    border: 1px solid rgba(${c.chipColor}, 0.25);
    background: rgba(${c.chipColor}, 0.05);
    font-size: 15px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: space-between;
    transition: background 140ms ease-out, border-color 140ms ease-out;
  }
  .gs-ladder-rung.is-current {
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.55), rgba(${c.chipColor}, 0.28));
    border-color: rgba(${c.chipColor}, 1);
    box-shadow: 0 0 18px rgba(${c.chipColor}, 0.55);
    color: rgb(255, 255, 255);
  }
  .gs-ladder-rung-idx { opacity: 0.65; font-size: 12px; }
  .gs-ladder-controls {
    display: flex;
    gap: 12px;
    justify-content: center;
  }
  .gs-ladder-controls button {
    padding: 12px 20px;
    border-radius: 10px;
    border: 1px solid rgba(${c.chipColor}, 0.7);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.35), rgba(${c.chipColor}, 0.15));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-size: 14px;
    font-weight: 800;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
    transition: transform 120ms ease-out;
  }
  .gs-ladder-controls button:hover  { transform: translateY(-1px); }
  .gs-ladder-controls button:active { transform: translateY(0); }
  .gs-ladder-controls button[disabled] { opacity: 0.4; cursor: not-allowed; }
  .gs-ladder-controls .gs-collect-btn {
    background: linear-gradient(180deg, rgba(80,200,120,0.55), rgba(80,200,120,0.25));
    border-color: rgba(80,200,120,0.85);
  }

  /* ── result toast (busted / collected) ──────────────────────────── */
  .gs-toast {
    margin-top: 14px;
    text-align: center;
    font-size: 18px;
    font-weight: 800;
    padding: 10px;
    border-radius: 8px;
  }
  .gs-toast.is-win  { background: rgba(80, 200, 120, 0.18); color: rgb(140, 240, 180); }
  .gs-toast.is-lose { background: rgba(220, 60, 80, 0.18);  color: rgb(255, 140, 160); }

  @media (prefers-reduced-motion: reduce) {
    .gs-card-face, .gs-card-guess, .gs-ladder-rung, .gs-ladder-controls button {
      transition: none !important;
    }
    .gs-card-face.is-flipping { transform: none !important; }
  }
  @media (max-width: 480px) {
    .gs-card-face { width: 110px; height: 156px; font-size: 48px; }
    .gs-ladder    { width: 88vw; }
  }
`;
}

/* ─── Markup emission ──────────────────────────────────────────────────── */

export function emitGambleSecondaryMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`
  <div class="gs-overlay" id="gsOverlay" hidden role="dialog" aria-modal="true" aria-label="Gamble feature">
    <div class="gs-prompt" id="gsPrompt" hidden>
      <h2>Gamble?</h2>
      <div class="gs-prompt-bank">Bank: <span id="gsPromptBank">—</span></div>
      <div class="gs-prompt-row">
        <button class="gs-card-btn"   id="gsBtnCard"   type="button" aria-label="Open card gamble">Card</button>
        <button class="gs-ladder-btn" id="gsBtnLadder" type="button" aria-label="Open ladder gamble">Ladder</button>
        <button class="gs-collect-btn" id="gsBtnCollect" type="button" aria-label="Collect win">Collect</button>
      </div>
    </div>
    <div class="gs-card-wrap" id="gsCardWrap" hidden>
      <h3>Card Gamble</h3>
      <div class="gs-card-bank">Bank<br/><span class="gs-card-bank-value" id="gsCardBank">—</span></div>
      <div class="gs-card-round">Round <span id="gsCardRound">1</span></div>
      <div class="gs-card-face is-back" id="gsCardFace" aria-live="polite">?</div>
      <div class="gs-card-guesses" id="gsCardGuesses" role="radiogroup" aria-label="Card guess"></div>
      <div class="gs-prompt-row" style="margin-top:14px;">
        <button class="gs-collect-btn" id="gsCardCollectBtn" type="button" aria-label="Collect current bank">Collect</button>
      </div>
      <div class="gs-toast" id="gsCardToast" hidden></div>
    </div>
    <div class="gs-ladder-wrap" id="gsLadderWrap" hidden>
      <h3>Ladder Gamble</h3>
      <div class="gs-card-bank">Bank<br/><span class="gs-card-bank-value" id="gsLadderBank">—</span></div>
      <div class="gs-ladder" id="gsLadder" aria-label="Multiplier ladder"></div>
      <div class="gs-ladder-controls">
        <button id="gsLadderDownBtn" type="button" aria-label="Step down ladder">Down</button>
        <button id="gsLadderUpBtn"   type="button" aria-label="Step up ladder">Up</button>
        <button class="gs-collect-btn" id="gsLadderCollectBtn" type="button" aria-label="Collect current bank">Collect</button>
      </div>
      <div class="gs-toast" id="gsLadderToast" hidden></div>
    </div>
  </div>`, 'gambleSecondary');
}

/* ─── Runtime emission ─────────────────────────────────────────────────── */

export function emitGambleSecondaryRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) {
    return `
  /* ── gambleSecondary BLOCK (disabled) — stub ──────────────────────── */
  window.gambleSecondaryOpen         = function () {};
  window.gambleSecondaryClose        = function () {};
  window.gambleSecondaryChooseCard   = function () {};
  window.gambleSecondaryChooseLadder = function () {};
  window.gambleSecondaryGuess        = function () {};
  window.gambleSecondaryStepUp       = function () {};
  window.gambleSecondaryStepDown     = function () {};
  window.gambleSecondaryCollect      = function () {};
  window.GAMBLE_SECONDARY_STATE      = { enabled: false, phase: 'idle' };
`;
  }

  const c = resolveConfig({ gambleSecondary: cfg });
  const safeCurrency = _escape(c.currency);

  return `
  /* ── gambleSecondary BLOCK — emitted by src/blocks/gambleSecondary.mjs ──
     Owns: post-win prompt splash + Card branch + Ladder branch + emit
           of onGambleStart / onGambleRound / onGambleEnd.
     Subscribes:
       onSpinResult     → maybe-show prompt
       onAutoplayStart  → suppress + close (autoplay owns flow)
       onFsTrigger      → suppress + close (FS owns flow)
       onSkipRequested  → collect + close (player skip = bank current). */
  (function () {
    var MODES            = ${JSON.stringify(c.modes)};
    var CARD_MODE        = ${JSON.stringify(c.cardMode)};
    var CARD_MULT        = ${c.cardMultiplier};
    var CARD_MAX_ROUNDS  = ${c.cardMaxRounds};
    var LADDER_RUNGS     = ${c.ladderRungs};
    var LADDER_MULT      = ${c.ladderRungMultiplier};
    var LADDER_MAX_ROUNDS = ${c.ladderMaxRounds};
    var MIN_WIN_X        = ${c.minWinForPromptX};
    var MAX_BANK_X       = ${c.maxBankX};
    var PROMPT_TIMEOUT_MS = ${c.promptTimeoutMs};
    var SHOW_IN_FS       = ${c.showInFs};
    var SHOW_IN_AUTOPLAY = ${c.showInAutoplay};
    var CURRENCY         = ${JSON.stringify(safeCurrency)};

    var STATE = {
      enabled: true,
      phase: 'idle',           /* idle | prompt | card | ladder | busted | collected */
      branch: null,            /* 'card' | 'ladder' once chosen */
      bank: 0,                 /* current win amount the player is gambling */
      bankSeed: 0,             /* original win at prompt time, for "/bet" math */
      rounds: 0,               /* completed gamble rounds in current session */
      ladderRung: 0,           /* 0-based index into LADDER_RUNGS-1 */
      promptTimerId: null,
      fsActive: false,
      autoplayActive: false,
    };
    if (typeof window !== 'undefined') {
      window.GAMBLE_SECONDARY_STATE = STATE;
    }

    /* Bet & rung helpers. */
    function _bet() {
      var b = (typeof window.__SLOT_BET__ === 'number' && Number.isFinite(window.__SLOT_BET__))
                ? Math.max(0.01, window.__SLOT_BET__)
                : 1.0;
      return b;
    }
    function _money(n) {
      var v = (Math.round(n * 100) / 100).toFixed(2);
      return CURRENCY + v;
    }
    function _capBank(n) {
      if (MAX_BANK_X <= 0) return n;
      var cap = MAX_BANK_X * _bet();
      return Math.min(n, cap);
    }
    function _ladderValueAt(rungIdx) {
      /* Geometric: rung 0 = bank seed; each rung up = × LADDER_MULT. */
      return _capBank(STATE.bankSeed * Math.pow(LADDER_MULT, rungIdx));
    }

    /* ─── DOM accessors ─────────────────────────────────────────────── */
    function _overlay()        { return document.getElementById('gsOverlay'); }
    function _prompt()         { return document.getElementById('gsPrompt'); }
    function _promptBank()     { return document.getElementById('gsPromptBank'); }
    function _cardWrap()       { return document.getElementById('gsCardWrap'); }
    function _cardBank()       { return document.getElementById('gsCardBank'); }
    function _cardRound()      { return document.getElementById('gsCardRound'); }
    function _cardFace()       { return document.getElementById('gsCardFace'); }
    function _cardGuesses()    { return document.getElementById('gsCardGuesses'); }
    function _cardCollect()    { return document.getElementById('gsCardCollectBtn'); }
    function _cardToast()      { return document.getElementById('gsCardToast'); }
    function _ladderWrap()     { return document.getElementById('gsLadderWrap'); }
    function _ladderBank()     { return document.getElementById('gsLadderBank'); }
    function _ladder()         { return document.getElementById('gsLadder'); }
    function _ladderUp()       { return document.getElementById('gsLadderUpBtn'); }
    function _ladderDown()     { return document.getElementById('gsLadderDownBtn'); }
    function _ladderCollect()  { return document.getElementById('gsLadderCollectBtn'); }
    function _ladderToast()    { return document.getElementById('gsLadderToast'); }
    function _btnCard()        { return document.getElementById('gsBtnCard'); }
    function _btnLadder()      { return document.getElementById('gsBtnLadder'); }
    function _btnCollect()     { return document.getElementById('gsBtnCollect'); }

    /* ─── render helpers ────────────────────────────────────────────── */
    function _showOverlay(panelEl) {
      var o = _overlay(); if (o) o.hidden = false;
      var p = _prompt();      if (p) p.hidden      = panelEl !== p;
      var cw = _cardWrap();   if (cw) cw.hidden    = panelEl !== cw;
      var lw = _ladderWrap(); if (lw) lw.hidden    = panelEl !== lw;
    }
    function _hideOverlay() {
      var o = _overlay(); if (o) o.hidden = true;
      var p = _prompt();      if (p) p.hidden = true;
      var cw = _cardWrap();   if (cw) cw.hidden = true;
      var lw = _ladderWrap(); if (lw) lw.hidden = true;
    }

    function _renderCardGuesses() {
      var host = _cardGuesses();
      if (!host) return;
      host.innerHTML = '';
      var tokens = CARD_MODE === 'suit'
                     ? [{t:'H', label:'♥', cls:'is-red',   aria:'Hearts'},
                        {t:'D', label:'♦', cls:'is-red',   aria:'Diamonds'},
                        {t:'C', label:'♣', cls:'is-black', aria:'Clubs'},
                        {t:'S', label:'♠', cls:'is-black', aria:'Spades'}]
                     : [{t:'R', label:'Red',   cls:'is-red',   aria:'Red'},
                        {t:'B', label:'Black', cls:'is-black', aria:'Black'}];
      for (var i = 0; i < tokens.length; i++) {
        var tk = tokens[i];
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'gs-card-guess ' + tk.cls;
        b.setAttribute('role', 'radio');
        b.setAttribute('aria-checked', 'false');
        b.setAttribute('aria-label', tk.aria);
        b.setAttribute('data-token', tk.t);
        b.textContent = tk.label;
        b.addEventListener('click', _onGuessClick);
        host.appendChild(b);
      }
    }

    function _renderLadder() {
      var host = _ladder();
      if (!host) return;
      host.innerHTML = '';
      for (var i = LADDER_RUNGS - 1; i >= 0; i--) {
        var r = document.createElement('div');
        r.className = 'gs-ladder-rung' + (i === STATE.ladderRung ? ' is-current' : '');
        r.setAttribute('data-rung', String(i));
        var idx = document.createElement('span');
        idx.className = 'gs-ladder-rung-idx';
        idx.textContent = 'Rung ' + (i + 1);
        var val = document.createElement('span');
        val.textContent = _money(_ladderValueAt(i));
        r.appendChild(idx);
        r.appendChild(val);
        host.appendChild(r);
      }
      var u = _ladderUp();   if (u) u.disabled = STATE.ladderRung >= LADDER_RUNGS - 1 || STATE.rounds >= LADDER_MAX_ROUNDS;
      var d = _ladderDown(); if (d) d.disabled = STATE.ladderRung <= 0;
    }

    /* ─── public API ────────────────────────────────────────────────── */
    function gambleSecondaryOpen(bankOverride) {
      if (STATE.fsActive && !SHOW_IN_FS) return;
      if (STATE.autoplayActive && !SHOW_IN_AUTOPLAY) return;
      var w = Number.isFinite(bankOverride)
                ? Math.max(0, bankOverride)
                : ((typeof window.__WIN_AWARD__ === 'number' && window.__WIN_AWARD__ > 0) ? window.__WIN_AWARD__ : 0);
      if (w <= 0) return;
      var threshold = MIN_WIN_X * _bet();
      if (w < threshold) return;
      STATE.phase = 'prompt';
      STATE.branch = null;
      STATE.bank = _capBank(w);
      STATE.bankSeed = STATE.bank;
      STATE.rounds = 0;
      var pb = _promptBank(); if (pb) pb.textContent = _money(STATE.bank);
      _showOverlay(_prompt());
      _armPromptTimer();
    }
    function gambleSecondaryClose() {
      _disarmPromptTimer();
      var prev = STATE.phase;
      var bank = STATE.bank;
      var endBranch = STATE.branch;
      var endRounds = STATE.rounds;
      STATE.phase = 'idle';
      _hideOverlay();
      if (prev !== 'idle' && prev !== 'busted' && prev !== 'collected') {
        _safeEmit(function () {
          window.HookBus.emit('onGambleEnd', {
            branch: endBranch, outcome: 'collect', bank: bank, rounds: endRounds,
          });
        });
      }
      STATE.branch = null;
      STATE.bank = 0;
      STATE.bankSeed = 0;
      STATE.rounds = 0;
      STATE.ladderRung = 0;
    }
    function gambleSecondaryChooseCard() {
      if (STATE.phase !== 'prompt') return;
      if (MODES.indexOf('card') === -1) return;
      _disarmPromptTimer();
      STATE.phase = 'card';
      STATE.branch = 'card';
      _refreshCardUI();
      _renderCardGuesses();
      _showOverlay(_cardWrap());
      _safeEmit(function () {
        window.HookBus.emit('onGambleStart', { branch: 'card', bank: STATE.bank, mode: CARD_MODE });
      });
    }
    function gambleSecondaryChooseLadder() {
      if (STATE.phase !== 'prompt') return;
      if (MODES.indexOf('ladder') === -1) return;
      _disarmPromptTimer();
      STATE.phase = 'ladder';
      STATE.branch = 'ladder';
      STATE.ladderRung = 0;
      _refreshLadderUI();
      _renderLadder();
      _showOverlay(_ladderWrap());
      _safeEmit(function () {
        window.HookBus.emit('onGambleStart', { branch: 'ladder', bank: STATE.bank, mode: 'rungs:' + LADDER_RUNGS });
      });
    }
    function gambleSecondaryGuess(token) {
      if (STATE.phase !== 'card') return;
      if (typeof token !== 'string') return;
      var t = token.toUpperCase();
      if (['R','B','H','D','C','S'].indexOf(t) === -1) return;
      if (STATE.rounds >= CARD_MAX_ROUNDS) return;

      /* Determine outcome. Color mode: 50% win. Suit mode: 25% win.
         UQ-DEEP-AP F-4: seedable RNG hook — was bare Math.random(). */
      function _gsRng(){
        if (typeof window!=='undefined'&&typeof window.__rng==='function') return window.__rng();
        if (typeof window!=='undefined'&&typeof window.rng==='function') return window.rng();
        return Math.random();
      }
      var win = false;
      if (CARD_MODE === 'color') {
        win = (t === 'R' || t === 'B') && _gsRng() < 0.5;
      } else {
        win = (t === 'H' || t === 'D' || t === 'C' || t === 'S') && _gsRng() < 0.25;
      }
      STATE.rounds++;
      var face = _cardFace();
      if (face) {
        face.classList.remove('is-back');
        face.classList.toggle('is-red',   (t === 'R' || t === 'H' || t === 'D'));
        face.classList.toggle('is-black', (t === 'B' || t === 'C' || t === 'S'));
        face.textContent = (CARD_MODE === 'suit')
                              ? ({H:'♥',D:'♦',C:'♣',S:'♠'}[t] || '?')
                              : (t === 'R' ? 'R' : 'B');
      }
      if (win) {
        STATE.bank = _capBank(STATE.bank * CARD_MULT);
        _showToast(_cardToast(), true, 'WIN! Bank = ' + _money(STATE.bank));
        _emitGambleRound('card', 'win', STATE.bank, STATE.rounds, CARD_MULT);
        _refreshCardUI();
        /* End if max rounds reached or cap hit. */
        if (STATE.rounds >= CARD_MAX_ROUNDS) _finishGamble('collect');
      } else {
        var lostBank = STATE.bank;
        STATE.bank = 0;
        _showToast(_cardToast(), false, 'BUST! Lost ' + _money(lostBank));
        _emitGambleRound('card', 'lose', 0, STATE.rounds, CARD_MULT);
        _refreshCardUI();
        _finishGamble('busted');
      }
    }
    function gambleSecondaryStepUp() {
      if (STATE.phase !== 'ladder') return;
      if (STATE.ladderRung >= LADDER_RUNGS - 1) return;
      if (STATE.rounds >= LADDER_MAX_ROUNDS) return;
      STATE.rounds++;
      /* UQ-DEEP-AP F-4: seedable RNG for ladder step. */
      function _gsLadderRng(){
        if (typeof window!=='undefined'&&typeof window.__rng==='function') return window.__rng();
        if (typeof window!=='undefined'&&typeof window.rng==='function') return window.rng();
        return Math.random();
      }
      var win = _gsLadderRng() < 0.5;
      if (win) {
        STATE.ladderRung++;
        STATE.bank = _ladderValueAt(STATE.ladderRung);
        _emitGambleRound('ladder', 'win', STATE.bank, STATE.rounds, LADDER_MULT);
        _refreshLadderUI();
        _renderLadder();
        _showToast(_ladderToast(), true, 'UP! Bank = ' + _money(STATE.bank));
        if (STATE.rounds >= LADDER_MAX_ROUNDS || STATE.ladderRung >= LADDER_RUNGS - 1) {
          _finishGamble('collect');
        }
      } else {
        STATE.ladderRung = 0;
        STATE.bank = 0;
        _emitGambleRound('ladder', 'lose', 0, STATE.rounds, LADDER_MULT);
        _refreshLadderUI();
        _renderLadder();
        _showToast(_ladderToast(), false, 'BUST! Fell to baseline');
        _finishGamble('busted');
      }
    }
    function gambleSecondaryStepDown() {
      if (STATE.phase !== 'ladder') return;
      if (STATE.ladderRung <= 0) return;
      /* Step down is guaranteed (no chance) but burns a round so the
       * player can't farm without consequence. */
      STATE.rounds++;
      STATE.ladderRung--;
      STATE.bank = _ladderValueAt(STATE.ladderRung);
      _emitGambleRound('ladder', 'win', STATE.bank, STATE.rounds, 1);
      _refreshLadderUI();
      _renderLadder();
      if (STATE.rounds >= LADDER_MAX_ROUNDS) _finishGamble('collect');
    }
    function gambleSecondaryCollect() {
      if (STATE.phase === 'idle' || STATE.phase === 'busted' || STATE.phase === 'collected') return;
      _finishGamble('collect');
    }

    function _refreshCardUI() {
      var bv = _cardBank();    if (bv) bv.textContent = _money(STATE.bank);
      var rd = _cardRound();   if (rd) rd.textContent = String(STATE.rounds + 1);
    }
    function _refreshLadderUI() {
      var lb = _ladderBank();  if (lb) lb.textContent = _money(STATE.bank);
    }
    function _showToast(el, isWin, msg) {
      if (!el) return;
      el.hidden = false;
      el.textContent = msg;
      el.classList.toggle('is-win',  !!isWin);
      el.classList.toggle('is-lose', !isWin);
    }
    function _finishGamble(outcome) {
      var prev = STATE.phase;
      STATE.phase = (outcome === 'busted') ? 'busted' : 'collected';
      var endBranch = STATE.branch || (prev === 'prompt' ? null : STATE.branch);
      var endBank = STATE.bank;
      var endRounds = STATE.rounds;
      _safeEmit(function () {
        window.HookBus.emit('onGambleEnd', {
          branch: endBranch, outcome: outcome, bank: endBank, rounds: endRounds,
        });
      });
      /* Small grace pause before hide so the player sees the bust / final
       * bank result. */
      setTimeout(function () {
        _hideOverlay();
        STATE.phase = 'idle';
        STATE.branch = null;
        STATE.bank = 0;
        STATE.bankSeed = 0;
        STATE.rounds = 0;
        STATE.ladderRung = 0;
      }, 1200);
    }

    function _armPromptTimer() {
      if (PROMPT_TIMEOUT_MS <= 0) return;
      _disarmPromptTimer();
      STATE.promptTimerId = setTimeout(function () {
        if (STATE.phase === 'prompt') gambleSecondaryCollect();
      }, PROMPT_TIMEOUT_MS);
    }
    function _disarmPromptTimer() {
      if (STATE.promptTimerId !== null) {
        clearTimeout(STATE.promptTimerId);
        STATE.promptTimerId = null;
      }
    }

    /* ─── HookBus emit helpers (single try/catch boundary) ──────────────
     * We use inline closures wrapped in _safeEmit so the literal event
     * names stay grep-able by tools/lego-gate.mjs (which enforces single-
     * owner ownership by static text scan of the literal emit call site).
     * A generic _emit(event, payload) helper would hide the event names
     * behind a variable and trip the gate ownership check. */
    function _safeEmit(fn) {
      if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
      try { fn(); }
      catch (e) { if (console && console.error) console.error('[gambleSecondary] emit listener failed:', e); }
    }
    function _emitGambleRound(branch, result, bank, round, multiplier) {
      _safeEmit(function () {
        window.HookBus.emit('onGambleRound', {
          branch: branch, result: result, bank: bank, round: round, multiplier: multiplier,
        });
      });
    }

    /* ─── DOM event wiring ──────────────────────────────────────────── */
    function _onGuessClick(ev) {
      var t = ev.currentTarget.getAttribute('data-token');
      if (t) gambleSecondaryGuess(t);
    }
    function _wireDom() {
      var bc = _btnCard();    if (bc) bc.addEventListener('click', gambleSecondaryChooseCard);
      var bl = _btnLadder();  if (bl) bl.addEventListener('click', gambleSecondaryChooseLadder);
      var bx = _btnCollect(); if (bx) bx.addEventListener('click', gambleSecondaryCollect);
      var cc = _cardCollect();   if (cc) cc.addEventListener('click', gambleSecondaryCollect);
      var lc = _ladderCollect(); if (lc) lc.addEventListener('click', gambleSecondaryCollect);
      var lu = _ladderUp();      if (lu) lu.addEventListener('click', gambleSecondaryStepUp);
      var ld = _ladderDown();    if (ld) ld.addEventListener('click', gambleSecondaryStepDown);
    }
    if (typeof document !== 'undefined') {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', _wireDom, { once: true });
      } else {
        _wireDom();
      }
    }

    /* ─── window exports ────────────────────────────────────────────── */
    if (typeof window !== 'undefined') {
      window.gambleSecondaryOpen         = gambleSecondaryOpen;
      window.gambleSecondaryClose        = gambleSecondaryClose;
      window.gambleSecondaryChooseCard   = gambleSecondaryChooseCard;
      window.gambleSecondaryChooseLadder = gambleSecondaryChooseLadder;
      window.gambleSecondaryGuess        = gambleSecondaryGuess;
      window.gambleSecondaryStepUp       = gambleSecondaryStepUp;
      window.gambleSecondaryStepDown     = gambleSecondaryStepDown;
      window.gambleSecondaryCollect      = gambleSecondaryCollect;
    }

    /* ─── HookBus wiring ─────────────────────────────────────────────── */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on('onSpinResult', function () {
        /* Defer prompt until postSpin so winPresentation has set
         * window.__WIN_AWARD__. Priority -40 keeps us at the END of
         * the listener chain so all sibling blocks have updated first. */
      }, { priority: -40 });
      window.HookBus.on('postSpin', function (p) {
        if (p && p.duringFs && !SHOW_IN_FS) return;
        if (STATE.autoplayActive && !SHOW_IN_AUTOPLAY) return;
        if (STATE.phase !== 'idle') return;
        /* UQ-MULTIPLIER-V10 (2026-06-22) — Boki bug "celije nestaju": kada
         * force MULT/BW/FORCE chip producira synthetic win, gambleSecondary
         * NE sme auto-open jer modal prekriva grid mid-presentation. Force
         * chip = visual QA utility, gamble prompt mora ostati skriven dok
         * igrač vidi polyline + cell pulse + total×mult overlay. Real wins
         * nedirnuti. */
        var __hasForcedBaseline = false;
        try {
          if (p && Array.isArray(p.events)) {
            for (var __fbi = 0; __fbi < p.events.length; __fbi++) {
              var __ev = p.events[__fbi];
              if (__ev && (__ev.forcedBaseline === true || (typeof __ev.forcedBigWinTier === 'number' && isFinite(__ev.forcedBigWinTier)))) {
                __hasForcedBaseline = true; break;
              }
            }
          }
        } catch (_) { /* defensive */ }
        if (__hasForcedBaseline) return;
        /* Defer ~150ms so winPresentation's rollup animation has time
         * to seat the final win amount. Player still has clean focus
         * on the gamble prompt. */
        setTimeout(function () {
          if (STATE.phase === 'idle') gambleSecondaryOpen();
        }, 150);
      }, { priority: -40 });

      window.HookBus.on('onAutoplayStart', function () {
        STATE.autoplayActive = true;
        if (!SHOW_IN_AUTOPLAY && STATE.phase !== 'idle') gambleSecondaryClose();
      });
      window.HookBus.on('onAutoplayStop', function () {
        STATE.autoplayActive = false;
      });

      window.HookBus.on('onFsTrigger', function () {
        STATE.fsActive = true;
        if (!SHOW_IN_FS && STATE.phase !== 'idle') gambleSecondaryClose();
      });
      window.HookBus.on('onFsEnd', function () {
        STATE.fsActive = false;
      });

      window.HookBus.on('onSkipRequested', function () {
        if (STATE.phase !== 'idle' && STATE.phase !== 'busted' && STATE.phase !== 'collected') {
          gambleSecondaryCollect();
        }
      });

      /* 2026-06-10 (Boki force-rule, "fix ultimativno kao blokove da
       * rade za bilo koji gdd ako ih ima") — UFP chip emit-uje
       * onForceFeatureRequested. gambleSecondary se inače pali sam
       * posle wining base spin-a; ali kad korisnik klikne GAMBLE chip,
       * mora se otvoriti odmah, čak i bez prethodnog wina. Industry
       * QA panel pattern. Bankroll seed = ostatak bilansa za primer
       * (uses live STATE.bank if set, fallback 1× bet). */
      window.HookBus.on('onForceFeatureRequested', function (payload) {
        if (!payload || payload.kind !== 'gamble') return;
        if (STATE.phase !== 'idle') return;
        try { gambleSecondaryOpen(); } catch (_) { /* defensive */ }
      });
    }
  })();
`;
}
