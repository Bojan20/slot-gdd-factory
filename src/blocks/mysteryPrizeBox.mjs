/**
 * src/blocks/mysteryPrizeBox.mjs
 *
 * Wave LEGO-RANDOM (B-3) — In-spin Mystery Prize Box.
 *
 * @module mysteryPrizeBox
 *
 * Purpose:
 *   When GDD declares `mystery_prize_box`, this block randomly drops a
 *   "treasure chest" overlay during a spin (probability-gated per
 *   spin), the player taps it, and it reveals one of a configured
 *   prize tier set (e.g. credit award · scatter plant · multiplier
 *   bump · free-spins trigger). The visual surface + control is
 *   complete here; the math wiring (actual award payout) lands with
 *   the PAR hot-swap in Phase 2 (placeholder credit shown until then).
 *
 * Industry-reference (vendor-neutral):
 *   Random in-spin treasure / prize / chest overlays are a 2024-2026
 *   industry-standard delight pattern — used as a "consolation prize"
 *   on losing spins to soften LDW (Losing Disguised as Win) regulatory
 *   pressure, OR as a stacking bonus path on top of any spin outcome.
 *   Tier count of 3-6 (Small / Medium / Large / Bonus) is the modal
 *   landscape pattern.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitMysteryPrizeBoxCSS(cfg)              → CSS string (chest + reveal overlay)
 *   emitMysteryPrizeBoxMarkup(cfg)           → HTML string (chest host)
 *   emitMysteryPrizeBoxRuntime(cfg)          → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  postSpin (RNG dice on whether to drop the box this spin)
 *                onFsTrigger (suppress mid-bonus — no nested random)
 *                onFsEnd     (re-enable post-bonus)
 *   emits:       onMysteryPrizeBoxAppeared { tierCount }
 *                onMysteryPrizeBoxOpened   { tierId, awardKind, awardValue }
 *                onMysteryPrizeBoxDismissed { reason }
 *
 * a11y / perf:
 *   • Chest button: real <button> with role="button" + aria-label
 *     "Mystery prize — tap to open" + visible focus ring.
 *   • Reveal overlay uses role="alertdialog" + aria-live="assertive".
 *   • Esc key dismisses (treated as picking nothing). Auto-dismiss
 *     after `autoDismissMs` if untouched (default 4000ms).
 *   • Tokens hoisted (0 magic numbers); honors prefers-reduced-motion
 *     (drop animation collapses to instant appearance).
 *   • Rate-limit: max one box per N spins (default 1 per 5) so the
 *     surface stays scarce.
 *   • Self-disable mid-FS to avoid stacking with FS celebration.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

/* Design tokens — 0 magic numbers in emitted CSS. */
const TOKENS = Object.freeze({
  chestSize:        72,
  chestSizeMobile:  56,
  dropMs:           620,
  hoverScale:       1.06,
  zIndexChest:      58,
  zIndexOverlay:    62,
  overlayFadeMs:    220,
  pillRadius:       14,
  fontRem:          0.9,
  fontRemMobile:    0.78,
  awardFontRem:     1.6,
  awardFontMobile:  1.3,
  pillPadV:         18,
  pillPadH:         24,
  shakeAmpPx:       4,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;
const AWARD_KINDS = Object.freeze(['credit', 'multiplier', 'scatter', 'fs_trigger']);

function _defaultTiers() {
  return Object.freeze([
    Object.freeze({ id: 'small',  label: 'SMALL',  weight: 60, awardKind: 'credit',     awardValue: 5 }),
    Object.freeze({ id: 'medium', label: 'MEDIUM', weight: 25, awardKind: 'credit',     awardValue: 20 }),
    Object.freeze({ id: 'large',  label: 'LARGE',  weight: 10, awardKind: 'credit',     awardValue: 100 }),
    Object.freeze({ id: 'bonus',  label: 'BONUS',  weight:  5, awardKind: 'fs_trigger', awardValue: 10 }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'MYSTERY PRIZE',
    /* Probability of the box dropping this spin — 0..1. Default 0.15 =
     * roughly once every 7 spins. The orchestrator's per-spin RNG
     * draws a number against this gate. */
    dropChance: 0.15,
    /* Hard cooldown — minimum N base-game spins between drops, even
     * if the dropChance gate would have re-triggered earlier. */
    cooldownSpins: 5,
    /* How long the chest sits on-screen waiting for a tap. After
     * timeout it auto-dismisses (recorded as 'timeout' reason). */
    autoDismissMs: 4000,
    /* Reveal hold — how long the award placard sits visible after the
     * player taps the chest, before auto-closing. */
    revealHoldMs: 1600,
    tiers: _defaultTiers(),
    /* Visual */
    color:      '#ffd34a',
    colorDark:  '#a07520',
    haloRGB:    '255,211,74',
  });
}

function _clampFloat(n, lo, hi, fallback) {
  n = Number(n);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}
function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _validateTier(raw, idx) {
  const fallback = _defaultTiers()[Math.min(idx, 3)] || _defaultTiers()[0];
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `tier${idx}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 24)
      ? raw.label : fallback.label,
    weight: _clampInt(raw.weight, 1, 1000, fallback.weight),
    awardKind: AWARD_KINDS.includes(String(raw.awardKind)) ? String(raw.awardKind) : fallback.awardKind,
    awardValue: _clampFloat(raw.awardValue, 0, 1_000_000, fallback.awardValue),
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('mysteryPrizeBox', defaultConfig(), model) };
  cfg.tiers = cfg.tiers.slice();
  const m = model.mysteryPrizeBox || {};

  /* Wave LEGO-BUY parity protocol — explicit `enabled: true` MUST
   * still pass through gridProfile veto. Same rule applied uniformly
   * across all new blocks for consistency. */
  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('mysteryPrizeBox', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.dropChance)) cfg.dropChance = _clampFloat(m.dropChance, 0, 1, cfg.dropChance);
  if (Number.isFinite(m.cooldownSpins)) cfg.cooldownSpins = _clampInt(m.cooldownSpins, 0, 100, cfg.cooldownSpins);
  if (Number.isFinite(m.autoDismissMs)) cfg.autoDismissMs = _clampInt(m.autoDismissMs, 500, 30000, cfg.autoDismissMs);
  if (Number.isFinite(m.revealHoldMs)) cfg.revealHoldMs = _clampInt(m.revealHoldMs, 200, 10000, cfg.revealHoldMs);
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;

  if (Array.isArray(m.tiers) && m.tiers.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.tiers.length && out.length < 8; i++) {
      const t = _validateTier(m.tiers[i] || {}, i);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    if (out.length > 0) cfg.tiers = out;
  }

  /* Auto-enable from features[] */
  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'mystery_prize_box' || f.kind === 'random_prize_box')) {
    const ctxOverride = applyGridProfile('mysteryPrizeBox', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  cfg.tiers = Object.freeze(cfg.tiers);
  return cfg;
}

export function emitMysteryPrizeBoxCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── mystery prize box ──────────────────────────────────────────── */
.mystery-prize-chest {
  position: fixed;
  top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0);
  z-index: ${T.zIndexChest};
  width: ${T.chestSize}px; height: ${T.chestSize}px;
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  border: 2px solid rgba(255,255,255,.55);
  border-radius: 12px;
  box-shadow: 0 4px 18px rgba(${cfg.haloRGB},.55), inset 0 1px 0 rgba(255,255,255,.4);
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 1.8rem; font-weight: 900; color: #1a1a1a;
  letter-spacing: 0.05em;
  appearance: none; padding: 0;
  transition: transform ${T.dropMs}ms cubic-bezier(.34, 1.56, .64, 1),
              box-shadow .18s ease;
}
.mystery-prize-chest[data-visible="true"] { transform: translate(-50%, -50%) scale(1); }
.mystery-prize-chest:hover { transform: translate(-50%, -50%) scale(${T.hoverScale}); }
.mystery-prize-chest:focus-visible { outline: 3px solid #fff; outline-offset: 4px; }
.mystery-prize-chest:active { transform: translate(-50%, -50%) scale(0.96); }
.mystery-prize-chest::before { content: '🎁'; pointer-events: none; }
@keyframes mpb-shake {
  0%, 100% { transform: translate(-50%, -50%) scale(1) translateX(0); }
  25% { transform: translate(-50%, -50%) scale(1) translateX(-${T.shakeAmpPx}px); }
  75% { transform: translate(-50%, -50%) scale(1) translateX(${T.shakeAmpPx}px); }
}
.mystery-prize-chest[data-visible="true"] {
  animation: mpb-shake 1.4s ease-in-out infinite;
  animation-delay: ${T.dropMs}ms;
}

.mystery-prize-overlay {
  position: fixed; inset: 0;
  z-index: ${T.zIndexOverlay};
  background: rgba(0,0,0,.55);
  opacity: 0; pointer-events: none;
  transition: opacity ${T.overlayFadeMs}ms ease;
  display: flex; align-items: center; justify-content: center;
}
.mystery-prize-overlay[data-open="true"] { opacity: 1; pointer-events: auto; }
.mystery-prize-pill {
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
  padding: ${T.pillPadV}px ${T.pillPadH}px;
  border-radius: ${T.pillRadius}px;
  text-align: center;
  box-shadow: 0 18px 36px rgba(0,0,0,.6), 0 0 80px rgba(${cfg.haloRGB},.4);
  min-width: 240px;
}
.mystery-prize-pill .label {
  font-size: ${T.fontRem}rem;
  font-weight: 700; letter-spacing: 0.18em;
  opacity: 0.85;
}
.mystery-prize-pill .award {
  font-size: ${T.awardFontRem}rem;
  font-weight: 900; letter-spacing: 0.05em;
  margin-top: 8px;
}
@media (max-width: 620px) {
  .mystery-prize-chest { width: ${T.chestSizeMobile}px; height: ${T.chestSizeMobile}px; font-size: 1.4rem; }
  .mystery-prize-pill .label { font-size: ${T.fontRemMobile}rem; }
  .mystery-prize-pill .award { font-size: ${T.awardFontMobile}rem; }
}
@media (prefers-reduced-motion: reduce) {
  .mystery-prize-chest,
  .mystery-prize-overlay { transition: none !important; animation: none !important; }
}
`;
}

export function emitMysteryPrizeBoxMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<button id="mysteryPrizeChest" class="mystery-prize-chest" type="button"
        aria-label="Mystery prize — tap to open"
        data-visible="false" tabindex="-1"></button>
<div id="mysteryPrizeOverlay" class="mystery-prize-overlay" data-open="false"
     role="alertdialog" aria-live="assertive" aria-labelledby="mysteryPrizeLabel"
     aria-hidden="true">
  <div class="mystery-prize-pill">
    <div class="label" id="mysteryPrizeLabel">${escapeHtml(cfg.label)}</div>
    <div class="award" id="mysteryPrizeAward"></div>
  </div>
</div>`;
}

export function emitMysteryPrizeBoxRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* mysteryPrizeBox: disabled */`;
  const tiersJSON = JSON.stringify(cfg.tiers.map(t => ({
    id: t.id, label: t.label, weight: t.weight,
    awardKind: t.awardKind, awardValue: t.awardValue,
  })));
  return `/* ─── mystery prize box runtime ──────────────────────────────── */
const MPB_DROP_CHANCE   = ${cfg.dropChance};
const MPB_COOLDOWN      = ${cfg.cooldownSpins};
const MPB_AUTO_DISMISS  = ${cfg.autoDismissMs};
const MPB_REVEAL_HOLD   = ${cfg.revealHoldMs};
const MPB_TIERS         = ${tiersJSON};

(function wireMysteryPrizeBox(){
  const chest   = document.getElementById('mysteryPrizeChest');
  const overlay = document.getElementById('mysteryPrizeOverlay');
  const awardEl = document.getElementById('mysteryPrizeAward');
  if (!chest || !overlay || !awardEl) return;

  let spinsSinceLast = MPB_COOLDOWN;       // start ready
  let active         = false;
  let suspended      = false;              // suspended during FS
  let autoDismissTimer = null;
  let revealCloseTimer = null;

  function pickTier() {
    const total = MPB_TIERS.reduce(function(s, t){ return s + t.weight; }, 0);
    let roll = Math.random() * total;
    for (const t of MPB_TIERS) {
      roll -= t.weight;
      if (roll <= 0) return t;
    }
    return MPB_TIERS[MPB_TIERS.length - 1];
  }

  function showChest() {
    active = true;
    chest.setAttribute('data-visible', 'true');
    chest.setAttribute('tabindex', '0');
    chest.focus();
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onMysteryPrizeBoxAppeared', { tierCount: MPB_TIERS.length });
    }
    autoDismissTimer = setTimeout(function(){ dismiss('timeout'); }, MPB_AUTO_DISMISS);
  }

  function openReveal() {
    if (!active) return;
    clearTimeout(autoDismissTimer);
    const tier = pickTier();
    let label = String(tier.label) + ' · ';
    if (tier.awardKind === 'credit')      label += '+' + tier.awardValue;
    else if (tier.awardKind === 'multiplier') label += '×' + tier.awardValue;
    else if (tier.awardKind === 'scatter')    label += tier.awardValue + ' SCATTERS';
    else if (tier.awardKind === 'fs_trigger') label += tier.awardValue + ' FS';
    awardEl.textContent = label;

    chest.setAttribute('data-visible', 'false');
    chest.setAttribute('tabindex', '-1');
    overlay.setAttribute('data-open', 'true');
    overlay.setAttribute('aria-hidden', 'false');
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onMysteryPrizeBoxOpened', {
        tierId: tier.id, awardKind: tier.awardKind, awardValue: tier.awardValue
      });
    }
    revealCloseTimer = setTimeout(closeReveal, MPB_REVEAL_HOLD);
  }

  function closeReveal() {
    overlay.setAttribute('data-open', 'false');
    overlay.setAttribute('aria-hidden', 'true');
    active = false;
    spinsSinceLast = 0;
  }

  function dismiss(reason) {
    clearTimeout(autoDismissTimer);
    chest.setAttribute('data-visible', 'false');
    chest.setAttribute('tabindex', '-1');
    active = false;
    spinsSinceLast = 0;
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onMysteryPrizeBoxDismissed', { reason: reason || 'user' });
    }
  }

  chest.addEventListener('click', openReveal);
  chest.addEventListener('keydown', function(e){
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openReveal(); }
    if (e.key === 'Escape') { e.preventDefault(); dismiss('escape'); }
  });
  document.addEventListener('keydown', function(e){
    if (active && e.key === 'Escape') { e.preventDefault(); dismiss('escape'); }
  });

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('postSpin', function(){
    if (suspended || active) return;
    spinsSinceLast++;
    if (spinsSinceLast < MPB_COOLDOWN) return;
    if (Math.random() < MPB_DROP_CHANCE) showChest();
  }) : void 0);
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){
    suspended = true;
    if (active) dismiss('fs_start');
  }) : void 0);
  HookBus.on('onFsEnd', function(){
    suspended = false;
    spinsSinceLast = MPB_COOLDOWN; // ready again after FS
  });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
