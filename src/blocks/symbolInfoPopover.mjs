/**
 * Slot GDD Factory · symbolInfoPopover BLOCK
 *
 * Wave V7 — tap / hover a grid cell → small popover with that symbol's
 * tier + label + (placeholder) payout hint. Closes on outside tap,
 * Escape, or new spin. Mobile-first: 44×44 hit target, viewport-aware
 * positioning, prefers-reduced-motion gates fade-in.
 *
 * Why a separate block (not paytable extension):
 *   `paytable.mjs` opens a full modal — too heavy for "what symbol is
 *   this?" inspection mid-game. The popover is a 90×ish floating chip
 *   over the tapped cell; reading it doesn't break flow. Both can
 *   coexist (paytable still owns the global "i" chip → full table).
 *
 * GDD-driven config (consumed from `model.symbolInfoPopover`):
 *   enabled         boolean                                     (default true)
 *   autoHideMs      number ms (≥ 400, ≤ 8000)                   (default 2400)
 *   accentColor     "r,g,b"                                     (default "255,214,110")
 *   bgColor         "r,g,b" with alpha-friendly value           (default "10,12,18")
 *   textColor       "r,g,b"                                     (default "245,242,228")
 *   showTierBadge   boolean                                     (default true)
 *   showPayoutHint  boolean — "pays X×bet for K-of-kind"        (default true)
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitSymbolInfoPopoverCSS(cfg)
 *   emitSymbolInfoPopoverMarkup(cfg)      → invisible host div
 *   emitSymbolInfoPopoverRuntime(cfg, model)
 *
 * Runtime contract (after emitted JS executes):
 *   showSymbolInfo(cellEl) / hideSymbolInfo()
 *   SYMBOL_INFO_POPOVER_STATE on window (debug introspection)
 *
 * HookBus events subscribed:
 *   preSpin           → hide popover (no stale popover into next spin)
 *   onFsTrigger       → hide popover (FS placard owns the screen)
 *   onFsEnd           → hide popover
 *
 * Runtime dependencies: HookBus, document, window.matchMedia.
 *
 * Boki rule (28.05.2026): "treba mi 'wave V7' — tap symbol → mini paytable
 * popover. Nikad nije bilo, želim da igrač može da pita 'koji je ovo
 * simbol?' bez da zatvori spin loop". This block satisfies that
 * directly — single-tap reveal, autoHide, no spin-loop interference.
 */

const DEFAULTS = Object.freeze({
  enabled: true,
  autoHideMs: 2400,
  accentColor: '255,214,110',
  bgColor: '10,12,18',
  textColor: '245,242,228',
  showTierBadge: true,
  showPayoutHint: true,
  payoutHints: {},
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

function isValidRGB(s) {
  if (typeof s !== 'string') return false;
  const parts = s.split(',').map((p) => p.trim());
  if (parts.length !== 3) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

export function resolveConfig(model) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.symbolInfoPopover) || {};

  if (src.enabled === false) cfg.enabled = false;
  if (typeof src.autoHideMs === 'number' && Number.isFinite(src.autoHideMs)) {
    // Out-of-range autoHideMs falls back to the default (2400ms) rather
    // than silently clamping. Clamping would mask a GDD typo (e.g. `240`
    // ms is far too fast for screen-reader announce + read time;
    // `99999` is sloppy big-number that should round-trip-warn into the
    // default safe band). See test "autoHideMs bounded 400..8000".
    const v = Math.floor(src.autoHideMs);
    if (v >= 400 && v <= 8000) cfg.autoHideMs = v;
  }
  if (isValidRGB(src.accentColor)) cfg.accentColor = src.accentColor;
  if (isValidRGB(src.bgColor)) cfg.bgColor = src.bgColor;
  if (isValidRGB(src.textColor)) cfg.textColor = src.textColor;
  if (src.showTierBadge === false) cfg.showTierBadge = false;
  if (src.showPayoutHint === false) cfg.showPayoutHint = false;
  if (src.payoutHints && typeof src.payoutHints === 'object' && !Array.isArray(src.payoutHints)) {
    cfg.payoutHints = { ...src.payoutHints };
  }
  return cfg;
}

export function emitSymbolInfoPopoverCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolInfoPopover: cfg });
  if (!c.enabled) {
    return '\n/* symbolInfoPopover BLOCK (disabled by GDD) — no CSS emitted */\n';
  }
  return `
/* ── symbolInfoPopover BLOCK — emitted by src/blocks/symbolInfoPopover.mjs
   GDD knobs (baked at build time):
     enabled        = ${c.enabled}
     autoHideMs     = ${c.autoHideMs}
     accent / bg / text = ${c.accentColor} / ${c.bgColor} / ${c.textColor}
   Mobile-first chip floating above the tapped cell. */
.symbolInfoPopover {
  position: fixed;
  display: none;
  z-index: 60;
  min-width: 96px;
  max-width: 180px;
  padding: 8px 10px;
  background: rgba(${c.bgColor}, 0.96);
  color: rgb(${c.textColor});
  border: 1px solid rgba(${c.accentColor}, 0.55);
  border-radius: 8px;
  box-shadow: 0 4px 14px rgba(0, 0, 0, 0.45),
              0 0 0 1px rgba(${c.accentColor}, 0.25);
  font: 500 11px/1.3 system-ui, sans-serif;
  pointer-events: none;
  opacity: 0;
  transform: translateY(-4px);
  transition: opacity 140ms ease, transform 140ms ease;
}
.symbolInfoPopover.is-open {
  display: block;
  opacity: 1;
  transform: translateY(-8px);
}
.symbolInfoPopover .sip-tier {
  display: inline-block;
  padding: 1px 6px;
  margin-right: 4px;
  border-radius: 4px;
  background: rgba(${c.accentColor}, 0.18);
  color: rgb(${c.accentColor});
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.6px;
}
.symbolInfoPopover .sip-label {
  font-weight: 600;
}
.symbolInfoPopover .sip-hint {
  display: block;
  margin-top: 4px;
  font-size: 10px;
  color: rgba(${c.textColor}, 0.72);
}
@media (prefers-reduced-motion: reduce) {
  .symbolInfoPopover { transition: none; }
}
`;
}

export function emitSymbolInfoPopoverMarkup(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolInfoPopover: cfg });
  if (!c.enabled) return '';
  /* Hidden host div appended once; popover content is rewritten on each
     show. Keeping a single DOM node beats reflowing the document tree
     each tap. */
  /* WCAG 4.1.3 — popover innerHTML is rewritten on every tap to expose
     the symbol's tier + payout. role="status" + aria-live="polite" so
     SR users hear the chip content when it appears. role="tooltip" is
     kept for AT semantics around the anchored cell. */
  return `
  <div class="symbolInfoPopover" id="symbolInfoPopover" role="tooltip" aria-live="polite" aria-hidden="true"></div>`;
}

export function emitSymbolInfoPopoverRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ symbolInfoPopover: cfg });
  if (!c.enabled) {
    return `
  /* ── symbolInfoPopover BLOCK (disabled by GDD) — no runtime ──────── */
  window.showSymbolInfo  = function () {};
  window.hideSymbolInfo  = function () {};
  window.SYMBOL_INFO_POPOVER_STATE = { enabled: false };
`;
  }
  return `
  /* ── symbolInfoPopover BLOCK — emitted by src/blocks/symbolInfoPopover.mjs
     GDD knobs:
       autoHideMs     = ${c.autoHideMs}
       showTierBadge  = ${c.showTierBadge}
       showPayoutHint = ${c.showPayoutHint}
     Owns: #symbolInfoPopover floating chip. Subscribes preSpin /
     onFsTrigger / onFsEnd to hide stale popover. */
  const SYMBOL_INFO_POPOVER_AUTO_HIDE_MS = ${c.autoHideMs};
  let _sipTimer = null;
  let _sipLastCell = null;
  const SIP_VIEWPORT_PAD = 8;
  const SIP_CELL_GAP = 4;
  const SIP_PAYOUT_HINTS = ${JSON.stringify(c.payoutHints)};

  function _sipEl() {
    return (typeof document !== 'undefined')
      ? document.getElementById('symbolInfoPopover')
      : null;
  }

  function _sipTierOf(symbol) {
    if (typeof SYMBOL_REGISTRY === 'undefined' || !SYMBOL_REGISTRY) return null;
    if (typeof SYMBOL_REGISTRY.tierOf === 'function') return SYMBOL_REGISTRY.tierOf(symbol);
    for (const tier of Object.keys(SYMBOL_REGISTRY)) {
      const list = Array.isArray(SYMBOL_REGISTRY[tier]) ? SYMBOL_REGISTRY[tier] : [];
      if (list.some(s => (s.glyph || s.code || s) === symbol)) return tier;
    }
    return null;
  }

  function _sipPayoutHint(symbol) {
    if (!${c.showPayoutHint}) return '';
    const tier = _sipTierOf(symbol);
    if (!tier) return '';
    return SIP_PAYOUT_HINTS[tier] || '';
  }

  function _sipPositionFor(el) {
    const rect = el.getBoundingClientRect();
    const popover = _sipEl();
    if (!popover) return;
    const popW = popover.offsetWidth;
    const popH = popover.offsetHeight;
    const wantedLeft = rect.left + rect.width / 2 - popW / 2;
    const clampedLeft = Math.max(SIP_VIEWPORT_PAD, Math.min(window.innerWidth - popW - SIP_VIEWPORT_PAD, wantedLeft));
    const top = Math.max(SIP_VIEWPORT_PAD, rect.top - popH - SIP_CELL_GAP);
    popover.style.left = clampedLeft + 'px';
    popover.style.top  = top + 'px';
  }

  function showSymbolInfo(cellEl) {
    const popover = _sipEl();
    if (!popover || !cellEl) return;
    const symbol = (cellEl.textContent || '').trim();
    if (!symbol) return;
    const tier = _sipTierOf(symbol);
    const hint = _sipPayoutHint(symbol);

    /* Security fix 2026-06-17 (agent-found XSS via symbol cell text):
       previously concatenated symbol+tier+hint directly into innerHTML,
       which let a malicious GDD with HTML-char symbol codes
       (e.g. "<img onerror=…>") execute. Now build nodes via createElement
       + textContent so untrusted strings never reach HTML parser. */
    while (popover.firstChild) popover.removeChild(popover.firstChild);
    if (${c.showTierBadge} && tier) {
      const span = document.createElement('span');
      span.className = 'sip-tier';
      span.textContent = tier;
      popover.appendChild(span);
    }
    const labelSpan = document.createElement('span');
    labelSpan.className = 'sip-label';
    labelSpan.textContent = symbol;
    popover.appendChild(labelSpan);
    if (hint) {
      const hintSpan = document.createElement('span');
      hintSpan.className = 'sip-hint';
      hintSpan.textContent = hint;
      popover.appendChild(hintSpan);
    }
    popover.classList.add('is-open');
    popover.setAttribute('aria-hidden', 'false');
    /* Position AFTER content is rendered so popRect dimensions are valid. */
    _sipPositionFor(cellEl);
    _sipLastCell = cellEl;
    if (_sipTimer) clearTimeout(_sipTimer);
    _sipTimer = setTimeout(hideSymbolInfo, SYMBOL_INFO_POPOVER_AUTO_HIDE_MS);
  }

  function hideSymbolInfo() {
    const popover = _sipEl();
    if (!popover) return;
    popover.classList.remove('is-open');
    popover.setAttribute('aria-hidden', 'true');
    if (_sipTimer) { clearTimeout(_sipTimer); _sipTimer = null; }
    _sipLastCell = null;
  }

  /* Delegated click — any .cell tap shows the popover. Second tap on
     the SAME cell hides it (toggle semantic). Outside tap closes. */
  if (typeof document !== 'undefined') {
    document.addEventListener('click', function (e) {
      const cell = e.target && e.target.closest ? e.target.closest('.cell') : null;
      if (cell) {
        if (_sipLastCell === cell) {
          hideSymbolInfo();
        } else {
          showSymbolInfo(cell);
        }
        return;
      }
      /* Outside tap → close. */
      hideSymbolInfo();
    }, { passive: true });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') hideSymbolInfo();
    });
  }

  if (typeof HookBus !== 'undefined') {
    HookBus.on('preSpin',     hideSymbolInfo, { priority: 10 });
    HookBus.on('onFsTrigger', hideSymbolInfo, { priority: 10 });
    HookBus.on('onFsEnd',     hideSymbolInfo, { priority: 10 });
  }

  window.showSymbolInfo = showSymbolInfo;
  window.hideSymbolInfo = hideSymbolInfo;
  window.SYMBOL_INFO_POPOVER_STATE = {
    enabled: true,
    autoHideMs: SYMBOL_INFO_POPOVER_AUTO_HIDE_MS,
    isOpen: function () {
      const p = _sipEl();
      return !!(p && p.classList.contains('is-open'));
    },
  };
`;
}
