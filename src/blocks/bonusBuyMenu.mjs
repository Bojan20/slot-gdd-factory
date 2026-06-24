/**
 * src/blocks/bonusBuyMenu.mjs
 *
 * Wave LEGO-BUY (4 / 8) — Multi-tier bonus buy menu.
 *
 * @module bonusBuyMenu
 *
 * Purpose:
 *   When GDD declares `bonus_buy_menu` (or `bonus_buy.tiers[]`), this block
 *   replaces the single-cost `bonusBuy` button with a dropdown / sheet that
 *   exposes several buy tiers (e.g. Standard FS @ 75×, Super FS @ 200×,
 *   Mega FS @ 500×). Each tier carries its own `costX`, `forceScatters`,
 *   `fsMode` payload so the math layer can branch on the chosen mode.
 *   The block is mutually exclusive with `bonusBuy.mjs` — orchestrator
 *   prefers the menu when both resolve enabled.
 *
 * Industry-reference (vendor-neutral):
 *   Multi-tier "buy ladder" is the post-2023 industry convention for slots
 *   that ship multiple bonus modes (e.g. "Bonus Hunt 80× / Super Bonus
 *   200× / Mega Bonus 500×"). Tier counts of 2–5 are standard; tier names
 *   carry meaningful UX weight (Standard / Super / Mega / Ultra). The
 *   block models the visual + control surface only — real-cash deduction
 *   + per-tier RTP balance land with PAR hot-swap (Phase 2).
 *
 * Public API:
 *   defaultConfig()                       → frozen safe defaults (1 sample tier)
 *   resolveConfig(model)                  → merge defaults with GDD override
 *   emitBonusBuyMenuCSS(cfg)              → CSS string (button + menu sheet)
 *   emitBonusBuyMenuMarkup(cfg)           → HTML string (button + menu host)
 *   emitBonusBuyMenuRuntime(cfg)          → runtime JS string for orchestrator
 *   BONUS_BUY_BANNED_JURISDICTIONS        → re-exported hard-ban list
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onFsTrigger (disable while in bonus)
 *                onFsEnd     (re-enable on bonus end)
 *   emits:       onBonusBuyMenuOpened   { tierCount }
 *                onBonusBuyMenuClosed   { reason }
 *                onBonusBuyMenuTierSelected { tierId, costX, forceScatters, fsMode }
 *
 * a11y / perf:
 *   • Trigger is a real <button> with aria-haspopup="menu" + aria-expanded.
 *   • Menu uses role="menu" / role="menuitem"; Arrow / Home / End / Esc nav.
 *   • Trapped focus while open; restored on close.
 *   • Optional `confirmMessage` GDD knob → confirm() per tier commit.
 *   • Tokens hoisted (0 magic numbers); honors prefers-reduced-motion.
 *   • Re-arm guard (`rearmMs`) prevents double-pick spam.
 *   • Hard-disabled under UKGC / SE / DE / NL (same matrix as bonusBuy).
 *
 * Mutex with `bonusBuy.mjs`:
 *   Orchestrator wires bonusBuy XOR bonusBuyMenu — never both. When the
 *   menu is enabled (tiers.length >= 2), bonusBuy block must self-disable
 *   to avoid duplicate side-mounted controls. Runtime exposes
 *   `window.__BONUS_BUY_MENU_ACTIVE__ = true` for orchestrator coordination.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';
import { BONUS_BUY_BANNED_JURISDICTIONS } from './bonusBuy.mjs';

/* Design tokens — 0 magic numbers in emitted CSS. */
const MENU_TOKENS = Object.freeze({
  zIndexBtn:      55,
  zIndexSheet:    56,
  zIndexBackdrop: 54,
  sheetWidth:     260,
  sheetMobileVw:  92,
  itemPadV:       16,  /* D-6 WCAG 2.5.5: row total height ≥ 44px (16+16+content) */
  itemPadH:       14,
  itemGap:        6,
  borderRadius:   14,
  rowRadius:      10,
  fontRem:        0.82,
  costFontRem:    0.7,
  mobileFontRem:  0.72,
  mobileBreak:    620,
  fadeMs:         180,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,23}$/i;
const MODE_RE = /^[a-z][a-z0-9_-]{0,23}$/i;

/** Frozen sample tier — gives the disabled block a sane shape to clone. */
function _sampleTier() {
  return Object.freeze({
    id: 'standard',
    label: 'STANDARD FS',
    costX: 75,
    forceScatters: 4,
    fsMode: 'standard',
    color: '#ff5050',
    colorDark: '#b03030',
  });
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'BUY BONUS',
    /* Tiers carry the per-pick payload. Order = display order. */
    tiers: Object.freeze([_sampleTier()]),
    rearmMs: 1200,
    confirmMessage: '',
    /* Trigger appearance — reused even when sheet is closed. */
    triggerColor:     '#ff5050',
    triggerColorDark: '#b03030',
    triggerShadowRGB: '255,80,80',
  });
}

/* Jurisdiction resolver — local copy of bonusBuy's logic so the menu
 * block is jurisdiction-aware even when bonusBuy itself is disabled. */
function _resolveJurisdiction(model) {
  const m  = (model && model.bonusBuyMenu) || (model && model.bonusBuy) || {};
  const rg = (model && model.responsibleGambling) || {};
  const reg = (model && model.regulator) || {};
  let j = null;
  if (typeof m.jurisdiction  === 'string') j = m.jurisdiction.toUpperCase();
  if (typeof rg.jurisdiction === 'string') j = rg.jurisdiction.toUpperCase();
  if (typeof reg.profile     === 'string') j = reg.profile.toUpperCase();
  return j;
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

function _validateTier(raw, idx) {
  const sample = _sampleTier();
  const t = {
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `tier${idx + 1}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 24)
      ? raw.label : sample.label,
    costX: _clampInt(raw.costX, 1, 10000, sample.costX),
    forceScatters: _clampInt(raw.forceScatters, 3, 12, sample.forceScatters),
    fsMode: MODE_RE.test(String(raw && raw.fsMode || '')) ? String(raw.fsMode) : 'standard',
    color:     (typeof raw.color === 'string'     && HEX_RE.test(raw.color))     ? raw.color     : sample.color,
    colorDark: (typeof raw.colorDark === 'string' && HEX_RE.test(raw.colorDark)) ? raw.colorDark : sample.colorDark,
  };
  return Object.freeze(t);
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('bonusBuyMenu', defaultConfig(), model) };
  cfg.tiers = cfg.tiers.slice(); // unfreeze for working copy
  const m = model.bonusBuyMenu || {};

  /* Wave LEGO-BUY parity fix — explicit `enabled: true` from GDD must
   * STILL go through gridProfile veto. Otherwise wheel/crash/plinko/
   * radial would honor a misguided GDD opt-in that the topology cannot
   * meaningfully render. Symmetric with the feature auto-enable path. */
  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('bonusBuyMenu', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.rearmMs)) cfg.rearmMs = _clampInt(m.rearmMs, 100, 10000, cfg.rearmMs);
  if (typeof m.confirmMessage === 'string' && m.confirmMessage.length <= 200) {
    /* FIX-8 H2 (Fable Copilot HIGH #2, 2026-06-19) — XSS filter.
     * Runtime bakes BBM_CONFIRM = JSON.stringify(confirmMessage) INSIDE
     * a <script> block. If GDD author lands a confirmMessage that
     * contains "</script>" (or "<!--" / "-->" comment digraphs), the
     * JSON.stringify-d output breaks out of the script context. Strip
     * the offending digraphs at resolveConfig time so the value is
     * always safe to inline. Defense-in-depth: also Unicode-escape
     * leading "<" to "<" via downstream JSON.stringify replacer
     * (handled in emit). */
    cfg.confirmMessage = m.confirmMessage
      .replace(/<\/script/gi, '<\\/script')
      .replace(/<!--/g, '<!\\-\\-')
      .replace(/-->/g, '-\\-\\>');
  }
  if (typeof m.triggerColor     === 'string' && HEX_RE.test(m.triggerColor))     cfg.triggerColor     = m.triggerColor;
  if (typeof m.triggerColorDark === 'string' && HEX_RE.test(m.triggerColorDark)) cfg.triggerColorDark = m.triggerColorDark;
  if (typeof m.triggerShadowRGB === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.triggerShadowRGB)) {
    cfg.triggerShadowRGB = m.triggerShadowRGB;
  }

  /* Tier list — accept up to 5 (industry max), de-dupe ids. */
  if (Array.isArray(m.tiers) && m.tiers.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < m.tiers.length && out.length < 5; i++) {
      const t = _validateTier(m.tiers[i] || {}, i);
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      out.push(t);
    }
    if (out.length > 0) cfg.tiers = out;
  }

  /* UQ-DEEP-Z fix (Boki 2026-06-24): ban-precedence — ako GDD eksplicitno
   * bani bonus buy, ni menu varijanta ne sme da pucanje. Mirror bonusBuy.mjs
   * fix. */
  const banDetected = !!(model.confidence && model.confidence._derivedBy &&
                         model.confidence._derivedBy.bonusBuy === 'gdd-explicit-ban-detected');
  if (banDetected || m.enabled === false) {
    cfg.enabled = false;
  }
  /* Auto-enable when GDD declares the feature OR a bonus_buy feature
   * arrives with a tiers[] array (modern multi-mode GDD). Wheel / crash /
   * plinko / radial veto via gridProfile is honored. */
  if (!banDetected && m.enabled !== false && Array.isArray(model.features)) {
    const hasMenu = model.features.some(f =>
      f.kind === 'bonus_buy_menu' ||
      (f.kind === 'bonus_buy' && Array.isArray(f.tiers) && f.tiers.length >= 2)
    );
    if (hasMenu) {
      const ctxOverride = applyGridProfile('bonusBuyMenu', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
      // Hoist tiers from feature payload if config did not specify any.
      if ((!m.tiers || m.tiers.length === 0)) {
        for (const f of model.features) {
          if (Array.isArray(f.tiers) && f.tiers.length >= 2) {
            cfg.tiers = f.tiers.slice(0, 5).map((t, i) => _validateTier(t || {}, i));
            break;
          }
        }
      }
    }
  }

  /* Single-tier degeneracy: menu collapses to bonusBuy duties, so we
   * self-disable to honor the mutex (orchestrator falls back to bonusBuy). */
  if (cfg.enabled && cfg.tiers.length < 2) {
    cfg.enabled = false;
    cfg.collapsedToSingleTier = true;
  }

  /* Jurisdiction gate — runs LAST so it overrides every other enable
   * path. UKGC / SE / DE / NL hard-disable the menu just like bonusBuy. */
  const jurisdiction = _resolveJurisdiction(model);
  if (jurisdiction && BONUS_BUY_BANNED_JURISDICTIONS.indexOf(jurisdiction) !== -1) {
    cfg.enabled = false;
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = true;
  } else if (jurisdiction) {
    cfg.jurisdiction = jurisdiction;
    cfg.bannedByJurisdiction = false;
  }

  cfg.tiers = Object.freeze(cfg.tiers);
  return cfg;
}

export { BONUS_BUY_BANNED_JURISDICTIONS };

export function emitBonusBuyMenuCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = MENU_TOKENS;
  return `
/* ─── bonus buy menu ─────────────────────────────────────────────── */
/* Multi-tier buy ladder — trigger pinned LEFT MIDDLE same dock as
   bonusBuy (Boki direktiva 09.06.2026 — no overlap with reels / header).
   Sheet opens to the right of the trigger; menu items are full-width
   rows with tier label + cost. Apple HIG font floor (≥ 11px) honored. */
.bonus-buy-menu-btn {
  position: fixed;
  top: 50%;
  left: max(14px, env(safe-area-inset-left, 14px));
  transform: translateY(-50%);
  z-index: ${T.zIndexBtn};
  background: linear-gradient(135deg, ${cfg.triggerColor}, ${cfg.triggerColorDark});
  color: #fff;
  border: 2px solid rgba(255,255,255,.4);
  border-radius: ${T.borderRadius}px;
  padding: 0.7rem 0.55rem;
  font-size: ${T.fontRem}rem;
  font-weight: 900;
  letter-spacing: 0.18em;
  cursor: pointer;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  min-height: 120px;
  max-width: 44px;
  box-shadow: 0 4px 18px rgba(${cfg.triggerShadowRGB},.5),
              inset 0 1px 0 rgba(255,255,255,.4);
  transition: transform ${T.fadeMs}ms, box-shadow ${T.fadeMs}ms, opacity ${T.fadeMs}ms;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6px;
}
.bonus-buy-menu-btn:hover  { transform: translateY(-50%) translateX(2px); }
.bonus-buy-menu-btn:active { transform: translateY(-50%) translateX(0); }
.bonus-buy-menu-btn[aria-expanded="true"] { box-shadow: 0 6px 22px rgba(${cfg.triggerShadowRGB},.85); }
.bonus-buy-menu-btn[disabled] { opacity: 0.5; cursor: not-allowed; }
.bonus-buy-menu-btn .caret {
  display: block;
  font-size: ${T.costFontRem}rem;
  opacity: 0.85;
  margin-top: 4px;
}

.bonus-buy-menu-backdrop {
  position: fixed; inset: 0;
  z-index: ${T.zIndexBackdrop};
  background: rgba(0,0,0,.45);
  opacity: 0;
  pointer-events: none;
  transition: opacity ${T.fadeMs}ms ease;
}
.bonus-buy-menu-backdrop[data-open="true"] {
  opacity: 1; pointer-events: auto;
}

.bonus-buy-menu-sheet {
  position: fixed;
  top: 50%;
  left: calc(max(14px, env(safe-area-inset-left, 14px)) + 60px);
  transform: translateY(-50%) scale(0.96);
  z-index: ${T.zIndexSheet};
  width: ${T.sheetWidth}px;
  max-width: ${T.sheetMobileVw}vw;
  background: rgba(20,18,30,.96);
  border: 1px solid rgba(255,255,255,.16);
  border-radius: ${T.borderRadius}px;
  box-shadow: 0 18px 48px rgba(0,0,0,.55);
  padding: 8px;
  opacity: 0;
  pointer-events: none;
  transition: opacity ${T.fadeMs}ms ease, transform ${T.fadeMs}ms ease;
  display: flex; flex-direction: column; gap: ${T.itemGap}px;
}
.bonus-buy-menu-sheet[data-open="true"] {
  opacity: 1; transform: translateY(-50%) scale(1);
  pointer-events: auto;
}

.bonus-buy-menu-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: ${T.itemPadV}px ${T.itemPadH}px;
  border-radius: ${T.rowRadius}px;
  background: linear-gradient(135deg, var(--bbm-row-color, ${cfg.triggerColor}),
                              var(--bbm-row-color-dark, ${cfg.triggerColorDark}));
  color: #fff;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  border: none;
  text-align: left;
  outline: none;
  transition: filter ${T.fadeMs}ms ease, transform ${T.fadeMs}ms ease;
}
.bonus-buy-menu-row:focus-visible {
  box-shadow: 0 0 0 3px #ffe066;
}
.bonus-buy-menu-row:hover { filter: brightness(1.12); transform: translateX(2px); }
.bonus-buy-menu-row .cost {
  display: inline-block;
  font-size: ${T.costFontRem}rem;
  font-weight: 700;
  opacity: 0.92;
  letter-spacing: 0.04em;
  margin-left: 10px;
}

@media (max-width: ${T.mobileBreak}px) {
  .bonus-buy-menu-btn {
    top: max(10px, env(safe-area-inset-top, 10px));
    left: max(8px, env(safe-area-inset-left, 8px));
    transform: none;
    writing-mode: horizontal-tb;
    min-height: 0; max-width: none;
    padding: 0.45rem 0.7rem;
    font-size: ${T.mobileFontRem}rem;
    letter-spacing: 0.04em;
  }
  .bonus-buy-menu-sheet {
    top: max(54px, env(safe-area-inset-top, 54px));
    left: 50%; transform: translateX(-50%) scale(0.96);
  }
  .bonus-buy-menu-sheet[data-open="true"] { transform: translateX(-50%) scale(1); }
}

@media (prefers-reduced-motion: reduce) {
  .bonus-buy-menu-btn,
  .bonus-buy-menu-sheet,
  .bonus-buy-menu-row,
  .bonus-buy-menu-backdrop { transition: none !important; }
}
`;
}

export function emitBonusBuyMenuMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const rows = cfg.tiers.map((t, i) => `
    <button class="bonus-buy-menu-row"
            role="menuitem"
            tabindex="${i === 0 ? '0' : '-1'}"
            data-tier-id="${escapeAttr(t.id)}"
            data-cost-x="${t.costX}"
            data-force-scatters="${t.forceScatters}"
            data-fs-mode="${escapeAttr(t.fsMode)}"
            style="--bbm-row-color:${escapeAttr(t.color)};--bbm-row-color-dark:${escapeAttr(t.colorDark)};">
      <span class="label">${escapeHtml(t.label)}</span>
      <span class="cost">${t.costX}× BET</span>
    </button>`).join('');
  return `<button id="bonusBuyMenuBtn" class="bonus-buy-menu-btn" type="button"
        aria-haspopup="menu" aria-expanded="false" aria-controls="bonusBuyMenuSheet"
        aria-label="Open buy bonus menu (${cfg.tiers.length} tiers)">
  ${escapeHtml(cfg.label)}
  <span class="caret" aria-hidden="true">▾</span>
</button>
<div id="bonusBuyMenuBackdrop" class="bonus-buy-menu-backdrop" data-open="false" aria-hidden="true"></div>
<div id="bonusBuyMenuSheet" class="bonus-buy-menu-sheet" data-open="false"
     role="menu" aria-labelledby="bonusBuyMenuBtn">${rows}
</div>`;
}

export function emitBonusBuyMenuRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* bonusBuyMenu: disabled */`;
  /* FIX-8 H2: defense-in-depth — after JSON.stringify, replace bare "<"
   * with the JSON-safe Unicode escape "\\u003c" so even a sneaky pre-
   * existing "<" cannot break out of script context. */
  const CONFIRM = cfg.confirmMessage
    ? JSON.stringify(cfg.confirmMessage).replace(/</g, '\\u003c')
    : 'null';
  return `/* ─── bonus buy menu runtime ─────────────────────────────────── */
const BBM_REARM_MS = ${cfg.rearmMs};
const BBM_CONFIRM  = ${CONFIRM};
const BBM_TIER_COUNT = ${cfg.tiers.length};

if (typeof window !== 'undefined') window.__BONUS_BUY_MENU_ACTIVE__ = true;

/* FIX-8 H1 (Fable Copilot HIGH #1, 2026-06-19) — HMR sentinel.
 * Without this guard, every hot-reload re-runs the IIFE and stacks
 * a fresh HookBus.on('onFsTrigger'|'onFsEnd') listener pair → after
 * N reloads, FS trigger disables the button N times (no-op for end-
 * user, but the listener queue grows unbounded and onFsEnd no-op
 * re-fires the rearm timer every cycle, causing race). Sentinel is
 * mandated by senior-grade rule_einstein_genius + Fable byte-safety. */
if (typeof window !== 'undefined' && window.__BBM_WIRED__) {
  /* Re-bake landed but listeners already wired — bail to avoid double-
   * subscribe. State (__BONUS_BUY_MENU_ACTIVE__) reset above is safe
   * because the orchestrator owns mutex semantics, not this block. */
} else {
  if (typeof window !== 'undefined') window.__BBM_WIRED__ = true;

(function wireBonusBuyMenu(){
  const btn      = document.getElementById('bonusBuyMenuBtn');
  const sheet    = document.getElementById('bonusBuyMenuSheet');
  const backdrop = document.getElementById('bonusBuyMenuBackdrop');
  if (!btn || !sheet || !backdrop) return;

  const rows = Array.prototype.slice.call(sheet.querySelectorAll('.bonus-buy-menu-row'));
  if (rows.length === 0) return;

  let lastFocus = null;

  function openMenu() {
    if (typeof FSM !== 'undefined' && FSM.phase !== 'BASE') return;
    if (btn.hasAttribute('disabled')) return;
    lastFocus = document.activeElement;
    btn.setAttribute('aria-expanded', 'true');
    sheet.setAttribute('data-open', 'true');
    backdrop.setAttribute('data-open', 'true');
    backdrop.setAttribute('aria-hidden', 'false');
    rows[0].focus();
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onBonusBuyMenuOpened', { tierCount: BBM_TIER_COUNT });
    }
  }

  function closeMenu(reason) {
    btn.setAttribute('aria-expanded', 'false');
    sheet.setAttribute('data-open', 'false');
    backdrop.setAttribute('data-open', 'false');
    backdrop.setAttribute('aria-hidden', 'true');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) { /* lost-host guard */ }
    }
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onBonusBuyMenuClosed', { reason: reason || 'user' });
    }
  }

  btn.addEventListener('click', () => {
    if (btn.getAttribute('aria-expanded') === 'true') closeMenu('toggle');
    else openMenu();
  });
  backdrop.addEventListener('click', () => closeMenu('backdrop'));

  function pickTier(row) {
    const tierId        = row.getAttribute('data-tier-id');
    const costX         = parseInt(row.getAttribute('data-cost-x'), 10);
    const forceScatters = parseInt(row.getAttribute('data-force-scatters'), 10);
    const fsMode        = row.getAttribute('data-fs-mode');
    if (BBM_CONFIRM && !window.confirm(BBM_CONFIRM)) return;
    // Engine contract — same plant shape as bonusBuy.mjs, plus mode tag.
    var _plant = { scatterCount: forceScatters, fsMode: fsMode, tierId: tierId };
    if (typeof window !== 'undefined') window.FORCE_TRIGGER = _plant;
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onBonusBuyMenuTierSelected', {
        tierId: tierId, costX: costX, forceScatters: forceScatters, fsMode: fsMode
      });
    }
    closeMenu('selected');
    if (typeof runOneBaseSpin === 'function') runOneBaseSpin();
    btn.setAttribute('disabled', 'disabled');
    setTimeout(function(){ btn.removeAttribute('disabled'); }, BBM_REARM_MS);
  }

  rows.forEach(function(row, idx){
    row.addEventListener('click', function(){ pickTier(row); });
    row.addEventListener('keydown', function(e){
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pickTier(row); return; }
      let next = idx;
      if (e.key === 'ArrowDown') next = (idx + 1) % rows.length;
      else if (e.key === 'ArrowUp') next = (idx - 1 + rows.length) % rows.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End')  next = rows.length - 1;
      else if (e.key === 'Escape') { e.preventDefault(); closeMenu('escape'); return; }
      else return;
      e.preventDefault();
      rows.forEach(function(r){ r.setAttribute('tabindex', '-1'); });
      rows[next].setAttribute('tabindex', '0');
      rows[next].focus();
    });
  });

  /* FIX-8 H1 (Fable MED #3, 2026-06-19) — typeof guard parity. */
  if (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function') {
    HookBus.on('onFsTrigger', function(){
      btn.setAttribute('disabled', 'disabled');
      if (btn.getAttribute('aria-expanded') === 'true') closeMenu('fs_start');
    });
    (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsEnd', function(){ btn.removeAttribute('disabled'); }) : void 0);
  }
})();

}  /* end __BBM_WIRED__ guard */
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
