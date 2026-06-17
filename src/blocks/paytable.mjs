import { applyGridProfile } from '../registry/gridProfile.mjs';
import { RAIL_SLOT_OFFSETS, RAIL_Z_INDEX } from '../registry/utilityRail.mjs';

const MODAL_MAX_WIDTH = 720;
const Z_INDEX_MODAL = 40;
const CHIP_LABEL_MAX_LEN = 4;
const ARIA_LABEL_MAX_LEN = 64;
const TIER_COLORS = {
  HP: '255,200,90',
  MP: '126,200,227',
  LP: '210,149,96',
};

/**
 * src/blocks/paytable.mjs
 *
 * Wave U10 — Paytable modal block.
 *
 * Industry-standard pattern (every certified slot ships one):
 *   • An "i" / "?" button somewhere on the hub opens a full-screen modal
 *     that lists every symbol, its payout grid (3-of-a-kind / 4OAK / 5OAK),
 *     wild substitution rules, and a feature summary (FS, multiplier,
 *     gamble, hold-and-win, etc).
 *   • The modal is regulator-mandated for MGA / UKGC / NJ certification —
 *     the player must be able to inspect the math BEFORE wagering.
 *   • Real-cash payouts compose with betSelector: when bet changes, the
 *     "X PER LINE @ €Y" column refreshes automatically (no math here —
 *     pure display of `payout × bet` formatted as currency).
 *
 * Lifecycle (HookBus contract):
 *   onBetChanged → refresh real-cash column if modal currently visible
 *   preSpin      → auto-hide if open (spinning while modal is up = bad UX)
 *   onFsTrigger  → auto-hide (FS overlay owns the screen)
 *   onAutoplayStart → auto-hide (autoplay session takes over)
 *
 * The block does NOT emit any new HookBus events — it's a player-driven UI
 * pane that composes with bet + spin lifecycle but doesn't publish intent.
 *
 * Composition contract:
 *   • Reads `model.symbols.{high,mid,low,specials}` for the symbol roster.
 *   • Reads `model.features[]` for the feature summary.
 *   • Reads `model.paytable` (if present) for explicit per-symbol payouts;
 *     falls back to a neutral linear curve when absent.
 *   • Reads `window.__SLOT_BET__` (Wave U5 betSelector) for real-cash.
 *
 * Bake-time config (resolved from `model.paytable` UI knobs; the math
 * payouts live in `model.paytable.symbols` separately if provided):
 *   { enabled, chipLabel, chipColor, chipTextColor,
 *     modalBgColor, modalAccentColor,
 *     showFeaturesList, showWildRules, showLineMap,
 *     closeOnBackdrop, closeOnEscape, autoHideOnSpin,
 *     ariaLabel }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitPaytableCSS(cfg)
 *   emitPaytableMarkup(cfg, model)
 *   emitPaytableRuntime(cfg, model)
 *
 * Runtime contract (after emitted JS executes):
 *   paytableShow() / paytableHide() / paytableToggle() / paytableIsOpen()
 *   PAYTABLE_STATE on window
 *
 * Runtime dependencies: HookBus, document, requestAnimationFrame.
 */

export function defaultConfig() {
  return Object.freeze({
    /* Industry-default ON — paytable is regulator-mandated for MGA / UKGC
     * / NJ certification (player must inspect math before wagering). The
     * floating "i" chip is the universal opt-out switch; a GDD that wires
     * paytable into a hub-menu instead can disable the standalone trigger
     * via `## Paytable\nenabled: false` or by emitting a `no_paytable`
     * (a.k.a. `paytable_disabled`) feature kind. */
    enabled: true,
    chipLabel: 'i',
    chipColor:     '201,162,39',   /* gold accent */
    chipTextColor: '255,230,168',
    modalBgColor:    '10,12,18',
    modalAccentColor: '201,162,39',
    showFeaturesList: true,
    showWildRules: true,
    showLineMap: false,            /* compact by default; reference games */
    closeOnBackdrop: true,
    closeOnEscape:   true,
    /* Industry default — auto-hide modal on spin so player isn't trying to
     * read the table while reels animate. Set false for landscape/desktop
     * games where players keep reference open during play. */
    autoHideOnSpin: true,
    ariaLabel: 'Open paytable',
  });
}

export function resolveConfig(model = {}) {
  /* Wave UD — baseline → per-kind context override → explicit GDD. */
  const cfg = applyGridProfile('paytable', defaultConfig(), model);
  const m = (model && model.paytable) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;

  if (typeof m.chipLabel === 'string' && m.chipLabel.length > 0 && m.chipLabel.length <= CHIP_LABEL_MAX_LEN) {
    cfg.chipLabel = m.chipLabel;
  }
  for (const key of ['chipColor', 'chipTextColor', 'modalBgColor', 'modalAccentColor']) {
    /* Fable audit (high): the {1,3} digit pattern alone accepts "999,215,80"
     * which is out of the 0..255 RGB channel range. Validate each
     * channel as a byte before committing the value. */
    if (typeof m[key] === 'string' && /^\d{1,3},\s*\d{1,3},\s*\d{1,3}$/.test(m[key])) {
      const channels = m[key].split(',').map(p => parseInt(p.trim(), 10));
      const allBytes = channels.length === 3 && channels.every(n => n >= 0 && n <= 255);
      if (allBytes) cfg[key] = m[key].replace(/\s+/g, '');
    }
  }
  for (const flag of ['showFeaturesList', 'showWildRules', 'showLineMap',
                       'closeOnBackdrop', 'closeOnEscape', 'autoHideOnSpin']) {
    if (m[flag] != null) cfg[flag] = !!m[flag];
  }
  if (typeof m.ariaLabel === 'string' && m.ariaLabel.length > 0 && m.ariaLabel.length <= ARIA_LABEL_MAX_LEN) {
    cfg.ariaLabel = m.ariaLabel;
  }

  /* Auto-disable when GDD explicitly opts out (some pre-release demo
   * builds run without paytable). */
  if (model.features && Array.isArray(model.features)) {
    const explicitlyOff = model.features.some(
      (f) => f && typeof f.kind === 'string' && /^(no[_-]?paytable|paytable[_-]?disabled)$/i.test(f.kind),
    );
    if (explicitlyOff) cfg.enabled = false;
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

/* Industry-baseline neutral payout curve when the GDD doesn't provide
 * explicit `model.paytable.symbols`. Pure display values — NO math
 * computation; these are placeholders shown until the math layer lands.
 * Numbers chosen so HP > MP > LP and 5OAK > 4OAK > 3OAK in geometric
 * progression. */
const DEFAULT_PAYOUTS = Object.freeze({
  HP: { 3: 10, 4: 50, 5: 200 },
  MP: { 3:  5, 4: 25, 5: 100 },
  LP: { 3:  2, 4: 10, 5:  40 },
});

/* Build a symbol roster for the paytable from model.symbols sections.
 * Returns: [{ id, name, tier, payouts:{3,4,5} }, ...] sorted HP → MP → LP. */
function _rosterFromModel(model) {
  const out = [];
  const explicit = (model && model.paytable && model.paytable.symbols) || {};
  const sym = (model && model.symbols) || {};
  const push = (s, tier) => {
    if (!s || typeof s !== 'object') return;
    const id = String(s.id || '').toUpperCase();
    if (!id) return;
    const fromGdd = explicit[id] || explicit[s.id];
    const payouts = { ...DEFAULT_PAYOUTS[tier] };
    if (fromGdd && typeof fromGdd === 'object') {
      const n3 = Number(fromGdd[3]); if (Number.isFinite(n3)) payouts[3] = n3;
      const n4 = Number(fromGdd[4]); if (Number.isFinite(n4)) payouts[4] = n4;
      const n5 = Number(fromGdd[5]); if (Number.isFinite(n5)) payouts[5] = n5;
    }
    out.push({ id, name: String(s.name || id), tier, payouts });
  };
  (sym.high || []).forEach(s => push(s, 'HP'));
  (sym.mid  || []).forEach(s => push(s, 'MP'));
  (sym.low  || []).forEach(s => push(s, 'LP'));
  return out;
}

function _specialsFromModel(model) {
  const sym = (model && model.symbols) || {};
  return (sym.specials || []).map(s => ({
    id: String(s.id || '').toUpperCase(),
    name: String(s.name || s.id || ''),
    kind: String(s.kind || '').toLowerCase(),
  })).filter(x => x.id);
}

function _featuresFromModel(model) {
  if (!model || !Array.isArray(model.features)) return [];
  return model.features
    .filter(f => f && f.kind)
    .map(f => ({
      kind:  String(f.kind),
      label: String(f.label || f.kind),
    }));
}

export function emitPaytableCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ paytable: cfg });
  /* z-index 40: above uiToast (30), force-skip (25), slam-stop (20). The
   * modal is the topmost-priority layer because it pauses the game. */
  return `
  /* ── paytable BLOCK — emitted by src/blocks/paytable.mjs ─────────────
     i-button + full-screen modal overlay with symbol roster, payout grid,
     feature list, and wild-substitution rules. Composes with betSelector
     via window.__SLOT_BET__ for the real-cash column. */
  /* Utility-rail slot 2: bottom-left, second-from-bottom.
     Rail stack (bottom-up): settings (96) → paytable (156) → history (216).
     2026-06-09 — Boki audit: settings (92) + paytable (96) bili na ISTOM
     mestu i preklapali se. Razdvojeno: 60px vertikalni razmak između chip-a. */
  .paytable-btn {
    position: fixed;
    left: max(18px, env(safe-area-inset-left, 18px));
    bottom: calc(max(18px, env(safe-area-inset-bottom, 18px)) + ${RAIL_SLOT_OFFSETS.paytable.desktop}px);
    /* Wave D3 — above .hub (z 30) so the chip is never hidden by hub
       stacking context on mobile. Modals still win at z 40+. */
    z-index: ${RAIL_Z_INDEX};
    /* Wave K5 — WCAG 2.5.5 / Apple HIG 44pt floor. */
    width: 44px; height: 44px;
    border-radius: 50%;
    border: 2px solid rgba(${c.chipColor}, 0.7);
    background: linear-gradient(180deg, rgba(${c.chipColor}, 0.18), rgba(${c.chipColor}, 0.06));
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 18px;
    font-style: italic;
    cursor: pointer;
    /* Wave K5 — kills iOS double-tap zoom on the chip so successive
       taps don't accidentally scale the page. */
    touch-action: manipulation;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.08),
      0 2px 6px rgba(0, 0, 0, 0.45);
    transition: transform 120ms ease-out, opacity 140ms ease-out;
    user-select: none;
    -webkit-tap-highlight-color: transparent;
  }
  @media (max-width: 620px) {
    .paytable-btn {
      left: max(12px, env(safe-area-inset-left, 12px));
      /* Mobile rail: settings (88) → paytable (148) → history (208). */
      bottom: calc(max(12px, env(safe-area-inset-bottom, 12px)) + ${RAIL_SLOT_OFFSETS.paytable.mobile}px);
    }
  }
  .paytable-btn:hover  { transform: scale(1.06); opacity: 0.95; }
  .paytable-btn:active { transform: scale(0.94); }
  .paytable-btn:disabled { opacity: 0.4; cursor: default; }

  .paytable-backdrop {
    position: fixed;
    inset: 0;
    z-index: ${Z_INDEX_MODAL};
    background: rgba(0, 0, 0, 0.72);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    overflow-y: auto;
    animation: paytable-fade-in 180ms ease-out;
  }
  .paytable-backdrop[hidden] { display: none !important; }
  @keyframes paytable-fade-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .paytable-modal {
    background: linear-gradient(180deg, rgba(${c.modalBgColor}, 0.98), rgba(${c.modalBgColor}, 1));
    border: 2px solid rgba(${c.modalAccentColor}, 0.85);
    border-radius: 16px;
    box-shadow:
      0 20px 60px rgba(0, 0, 0, 0.7),
      0 0 32px rgba(${c.modalAccentColor}, 0.25),
      inset 0 1px 0 rgba(255, 255, 255, 0.08);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    max-width: ${MODAL_MAX_WIDTH}px;
    width: 100%;
    max-height: calc(100vh - 48px);
    overflow-y: auto;
    padding: 22px 26px;
  }
  .paytable-modal h2 {
    font-size: 18px;
    letter-spacing: 2px;
    text-transform: uppercase;
    color: rgb(${c.modalAccentColor});
    margin-bottom: 16px;
    text-align: center;
    font-weight: 800;
  }
  .paytable-modal h3 {
    font-size: 12px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    opacity: 0.65;
    margin: 18px 0 8px;
    border-bottom: 1px solid rgba(${c.modalAccentColor}, 0.25);
    padding-bottom: 4px;
  }
  .paytable-grid {
    display: grid;
    grid-template-columns: 32px 1fr repeat(3, 64px);
    gap: 4px 10px;
    align-items: center;
    font-size: 13px;
  }
  .paytable-grid .paytable-head {
    font-size: 10px;
    letter-spacing: 1.5px;
    opacity: 0.6;
    text-transform: uppercase;
    padding-bottom: 4px;
    border-bottom: 1px solid rgba(${c.modalAccentColor}, 0.18);
  }
  .paytable-grid .paytable-id {
    width: 28px; height: 28px;
    border-radius: 6px;
    background: rgba(${c.modalAccentColor}, 0.15);
    border: 1px solid rgba(${c.modalAccentColor}, 0.35);
    color: rgb(${c.modalAccentColor});
    display: flex; align-items: center; justify-content: center;
    font-weight: 800;
    font-size: 13px;
  }
  .paytable-grid .paytable-id.tier-HP { background: rgba(${TIER_COLORS.HP}, 0.18); border-color: rgba(${TIER_COLORS.HP}, 0.5); color: #ffc85a; }
  .paytable-grid .paytable-id.tier-MP { background: rgba(${TIER_COLORS.MP}, 0.18); border-color: rgba(${TIER_COLORS.MP}, 0.5); color: #7ec8e3; }
  .paytable-grid .paytable-id.tier-LP { background: rgba(${TIER_COLORS.LP}, 0.18); border-color: rgba(${TIER_COLORS.LP}, 0.5); color: #d29560; }
  .paytable-grid .paytable-name {
    opacity: 0.85;
  }
  .paytable-grid .paytable-payout {
    text-align: right;
    font-variant-numeric: tabular-nums;
    font-weight: 700;
  }
  .paytable-grid .paytable-payout.zero { opacity: 0.35; }

  .paytable-features {
    display: flex; flex-wrap: wrap; gap: 6px;
    margin-top: 6px;
  }
  .paytable-feature {
    background: rgba(${c.modalAccentColor}, 0.18);
    border: 1px solid rgba(${c.modalAccentColor}, 0.45);
    color: rgb(${c.chipTextColor});
    padding: 4px 10px;
    border-radius: 12px;
    font-size: 11px;
    letter-spacing: 1px;
    text-transform: uppercase;
    font-weight: 700;
  }

  .paytable-wild-note {
    font-size: 12px;
    opacity: 0.7;
    line-height: 1.5;
    margin-top: 4px;
  }

  .paytable-bet-row {
    margin-top: 14px;
    padding: 8px 12px;
    background: rgba(${c.modalAccentColor}, 0.1);
    border-radius: 8px;
    font-size: 12px;
    letter-spacing: 1px;
    text-transform: uppercase;
    text-align: center;
    opacity: 0.85;
  }
  .paytable-bet-row .paytable-bet-value {
    color: rgb(${c.modalAccentColor});
    font-weight: 800;
    font-variant-numeric: tabular-nums;
    margin-left: 8px;
  }

  .paytable-close {
    margin-top: 18px;
    width: 100%;
    padding: 10px 0;
    border-radius: 10px;
    border: 2px solid rgba(${c.modalAccentColor}, 0.8);
    background: rgba(${c.modalAccentColor}, 0.18);
    color: rgb(${c.chipTextColor});
    font-family: inherit;
    font-weight: 800;
    font-size: 13px;
    letter-spacing: 1.5px;
    text-transform: uppercase;
    cursor: pointer;
  }
  .paytable-close:hover { background: rgba(${c.modalAccentColor}, 0.3); }

  @media (max-width: 480px) {
    .paytable-modal { padding: 16px 14px; max-height: calc(100vh - 16px); }
    .paytable-grid {
      grid-template-columns: 28px 1fr repeat(3, 52px);
      gap: 3px 6px;
      font-size: 11px;
    }
    .paytable-grid .paytable-id { width: 24px; height: 24px; font-size: 11px; }
  }

  @media (prefers-reduced-motion: reduce) {
    .paytable-backdrop { animation: none; }
    .paytable-btn { transition: none; }
    .paytable-btn:hover, .paytable-btn:active { transform: none; }
  }
`;
}

export function emitPaytableMarkup(cfg = defaultConfig() /*, model = {} */) {
  if (!cfg.enabled) return '';
  const c = resolveConfig({ paytable: cfg });
  const safeAria  = _escape(c.ariaLabel);
  const safeLabel = _escape(c.chipLabel);
  return `
  <button id="paytableBtn" class="paytable-btn" type="button" aria-label="${safeAria}">${safeLabel}</button>
  <div id="paytableBackdrop" class="paytable-backdrop" hidden role="dialog" aria-modal="true" aria-labelledby="paytableTitle">
    <div id="paytableModal" class="paytable-modal" role="document">
      <h2 id="paytableTitle">Paytable</h2>
      <div id="paytableContent"></div>
      <div id="paytableBetRow" class="paytable-bet-row" hidden>
        Current bet: <span id="paytableBetValue" class="paytable-bet-value">—</span>
      </div>
      <button id="paytableCloseBtn" class="paytable-close" type="button">Close</button>
    </div>
  </div>`;
}

export function emitPaytableRuntime(cfg = defaultConfig(), model = {}) {
  if (!cfg.enabled) {
    return `
  /* ── paytable BLOCK (disabled) — stub ─────────────────────────────── */
  window.paytableShow    = function () {};
  window.paytableHide    = function () {};
  window.paytableToggle  = function () {};
  window.paytableIsOpen  = function () { return false; };
  window.PAYTABLE_STATE  = { enabled: false, open: false };
`;
  }

  const c = resolveConfig({ paytable: cfg });
  const roster   = _rosterFromModel(model);
  const specials = _specialsFromModel(model);
  const features = _featuresFromModel(model);

  return `
  /* ── paytable BLOCK — emitted by src/blocks/paytable.mjs ──────────────
     Owns: paytable modal show/hide + roster render + bet-row refresh.
     Subscribes:
       onBetChanged       → refresh real-cash bet display (if open)
       preSpin            → auto-hide (if autoHideOnSpin)
       onFsTrigger        → auto-hide (FS overlay claims screen)
       onAutoplayStart    → auto-hide (autoplay takes over)
     Emits: nothing — pure UI pane. */
  (function () {
    if (window.__PAYTABLE_WIRED__) return;
    window.__PAYTABLE_WIRED__ = true;

    var ROSTER      = ${JSON.stringify(roster)};
    var SPECIALS    = ${JSON.stringify(specials)};
    var FEATURES    = ${JSON.stringify(features)};
    var SHOW_FEATS  = ${c.showFeaturesList};
    var SHOW_WILD   = ${c.showWildRules};
    var CLOSE_BACKDROP = ${c.closeOnBackdrop};
    var CLOSE_ESC      = ${c.closeOnEscape};
    var AUTO_HIDE      = ${c.autoHideOnSpin};

    var STATE = {
      enabled: true,
      open: false,
      lastFocus: null,
    };
    if (typeof window !== 'undefined') window.PAYTABLE_STATE = STATE;

    function _btn()      { return document.getElementById('paytableBtn'); }
    function _backdrop() { return document.getElementById('paytableBackdrop'); }
    function _content()  { return document.getElementById('paytableContent'); }
    function _betRow()   { return document.getElementById('paytableBetRow'); }
    function _betVal()   { return document.getElementById('paytableBetValue'); }
    function _closeBtn() { return document.getElementById('paytableCloseBtn'); }

    function _escapeHtml(s) {
      return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
    }

    function _getFocusableElements() {
      var modal = document.getElementById('paytableModal');
      if (!modal) return [];
      return Array.from(modal.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter(function (el) {
        return !el.hasAttribute('disabled') && el.offsetParent !== null;
      });
    }

    function _trapTab(ev) {
      if (ev.key !== 'Tab') return;
      var focusables = _getFocusableElements();
      if (focusables.length === 0) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (ev.shiftKey && document.activeElement === first) {
        ev.preventDefault();
        last.focus();
      } else if (!ev.shiftKey && document.activeElement === last) {
        ev.preventDefault();
        first.focus();
      }
    }

    function _renderSymbolGrid() {
      if (!ROSTER || ROSTER.length === 0) {
        return '<div style="opacity:0.5;padding:12px 0;font-size:12px;">No symbols in GDD.</div>';
      }
      var head = '<div class="paytable-head"></div>'
               + '<div class="paytable-head">Symbol</div>'
               + '<div class="paytable-head" style="text-align:right;">3x</div>'
               + '<div class="paytable-head" style="text-align:right;">4x</div>'
               + '<div class="paytable-head" style="text-align:right;">5x</div>';
      var rows = ROSTER.map(function (s) {
        var p3 = s.payouts['3'] || 0;
        var p4 = s.payouts['4'] || 0;
        var p5 = s.payouts['5'] || 0;
        return '<div class="paytable-id tier-' + _escapeHtml(s.tier) + '">' + _escapeHtml(s.id) + '</div>'
             + '<div class="paytable-name">' + _escapeHtml(s.name) + '</div>'
             + '<div class="paytable-payout' + (p3 === 0 ? ' zero' : '') + '">' + (p3 === 0 ? '—' : p3) + '</div>'
             + '<div class="paytable-payout' + (p4 === 0 ? ' zero' : '') + '">' + (p4 === 0 ? '—' : p4) + '</div>'
             + '<div class="paytable-payout' + (p5 === 0 ? ' zero' : '') + '">' + (p5 === 0 ? '—' : p5) + '</div>';
      }).join('');
      return '<div class="paytable-grid">' + head + rows + '</div>';
    }

    function _renderSpecials() {
      if (!SPECIALS || SPECIALS.length === 0) return '';
      var rows = SPECIALS.map(function (s) {
        return '<div class="paytable-feature"><strong>' + _escapeHtml(s.id) + '</strong> · ' + _escapeHtml(s.name) + '</div>';
      }).join('');
      return '<h3>Special Symbols</h3><div class="paytable-features">' + rows + '</div>';
    }

    function _renderFeatures() {
      if (!SHOW_FEATS || !FEATURES || FEATURES.length === 0) return '';
      var chips = FEATURES.map(function (f) {
        return '<div class="paytable-feature">' + _escapeHtml(f.label) + '</div>';
      }).join('');
      return '<h3>Features</h3><div class="paytable-features">' + chips + '</div>';
    }

    function _renderWildNote() {
      if (!SHOW_WILD) return '';
      /* Some GDD parsers populate symbols.specials with id+name only
         (no kind field); detect wild by either explicit kind === wild,
         id W / WILD, or a name containing 'wild' (case-insensitive).
         No backticks here — this comment sits inside an outer template
         literal in emitPaytableRuntime. */
      var wild = SPECIALS.find(function (s) {
        if (!s) return false;
        if (s.kind === 'wild') return true;
        var id = String(s.id || '').toLowerCase();
        if (id === 'w' || id === 'wild') return true;
        var nm = String(s.name || '').toLowerCase();
        return nm.indexOf('wild') !== -1;
      });
      if (!wild) return '';
      return '<h3>Wild Rules</h3><div class="paytable-wild-note">' +
        '<strong>' + _escapeHtml(wild.id) + '</strong> substitutes for all paying symbols. ' +
        'Wild does not substitute for Scatter or feature-trigger symbols. ' +
        'Highest-paying combination is always awarded.' +
        '</div>';
    }

    function _refreshContent() {
      var host = _content();
      if (!host) return;
      host.innerHTML =
        '<h3>Symbol Payouts</h3>' + _renderSymbolGrid() +
        _renderSpecials() +
        _renderWildNote() +
        _renderFeatures();
    }

    function _refreshBetRow() {
      var row = _betRow();
      var val = _betVal();
      if (!row || !val) return;
      var bet = (typeof window.__SLOT_BET__ === 'number' && window.__SLOT_BET__ > 0)
              ? window.__SLOT_BET__
              : null;
      if (bet == null) { row.hidden = true; return; }
      row.hidden = false;
      /* Display in 2-decimal currency form. Currency symbol is left abstract
       * because betSelector controls denomination — render plain number with
       * a leading bullet so the player knows it's "the bet". */
      val.textContent = '• ' + bet.toFixed(2);
    }

    function paytableShow() {
      if (STATE.open) return;
      STATE.lastFocus = (typeof document.activeElement !== 'undefined')
        ? document.activeElement : null;
      _refreshContent();
      _refreshBetRow();
      var bd = _backdrop();
      if (!bd) return;
      bd.hidden = false;
      STATE.open = true;
      /* Sandbox JSDOM stubs that lack addEventListener must still allow the
         block to open — guard before binding the focus trap. */
      if (typeof document.addEventListener === 'function') {
        document.addEventListener('keydown', _trapTab);
      }
      var focusables = _getFocusableElements();
      var firstFocus = focusables.length > 0 ? focusables[0] : _closeBtn();
      if (firstFocus && typeof firstFocus.focus === 'function') {
        try { firstFocus.focus(); } catch (_) {}
      }
    }

    function paytableHide() {
      if (!STATE.open) return;
      var bd = _backdrop();
      if (bd) bd.hidden = true;
      STATE.open = false;
      if (typeof document.removeEventListener === 'function') {
        document.removeEventListener('keydown', _trapTab);
      }
      if (STATE.lastFocus && typeof STATE.lastFocus.focus === 'function') {
        try { STATE.lastFocus.focus(); } catch (_) {}
      }
    }

    function paytableToggle() {
      if (STATE.open) paytableHide();
      else paytableShow();
    }

    function paytableIsOpen() { return !!STATE.open; }

    if (typeof window !== 'undefined') {
      window.paytableShow   = paytableShow;
      window.paytableHide   = paytableHide;
      window.paytableToggle = paytableToggle;
      window.paytableIsOpen = paytableIsOpen;
    }

    function _wireDom() {
      var b = _btn();          if (b) b.addEventListener('click', paytableToggle);
      var c = _closeBtn();     if (c) c.addEventListener('click', paytableHide);
      if (CLOSE_BACKDROP) {
        var bd = _backdrop();
        if (bd) bd.addEventListener('click', function (ev) {
          /* Only close when the click is on the backdrop itself (not the
             modal child). Standard "click-outside" modal pattern. */
          if (ev.target === bd) paytableHide();
        });
      }
      if (CLOSE_ESC) {
        document.addEventListener('keydown', function (ev) {
          if (ev.key === 'Escape' && STATE.open) paytableHide();
        });
      }
    }
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', _wireDom, { once: true });
    } else {
      _wireDom();
    }

    /* HookBus listeners. */
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      /* Refresh bet display when betSelector publishes a change. */
      window.HookBus.on('onBetChanged', function () {
        if (STATE.open) _refreshBetRow();
      });
      /* Auto-hide on game-control events (autoHideOnSpin gated). */
      if (AUTO_HIDE) {
        window.HookBus.on('preSpin',        function () { paytableHide(); });
      }
      window.HookBus.on('onFsTrigger',     function () { paytableHide(); });
      window.HookBus.on('onAutoplayStart', function () { paytableHide(); });
    }
  })();
`;
}
