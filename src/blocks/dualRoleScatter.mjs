/**
 * src/blocks/dualRoleScatter.mjs
 *
 * Wave H10 — Dual-Role Scatter (scatter that doubles as wild or pay).
 *
 * Industry baseline (vendor-neutral):
 *   Many modern games extend the classic scatter so the symbol carries TWO
 *   semantic roles in different contexts:
 *
 *     • Primary role : SCATTER — triggers FS / bonus when N+ land on the grid
 *     • Secondary    : WILD    — substitutes for any tier (HP/MP/LP) inside
 *                                 a winning combination if cfg.mode='wild'
 *                       — OR    PAY     — pays its own paytable line credit
 *                                 if cfg.mode='pay' when ≥ 3 land on grid
 *
 *   This block ANNOUNCES the dual role activation via HookBus so downstream
 *   blocks (winPresentation, paylineOverlay, paytable, audio) can decorate
 *   appropriately. It is a pure OBSERVER — does NOT mutate evaluation logic.
 *
 *   Why a separate block?
 *     • Single source of truth for "which symbol is the dual-role scatter".
 *     • LEGO discipline: a per-game extractor in parser.mjs writes
 *       `model.dualRoleScatter = { symbol, mode }` and the block reads it.
 *     • Vendor-neutral default config: no specific game scatter required.
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitDualRoleScatterCSS(cfg)
 *   emitDualRoleScatterMarkup(cfg)       → empty (decoration via runtime)
 *   emitDualRoleScatterRuntime(cfg)
 *
 * Lifecycle:
 *   subscribes:
 *     postSpin          → scan grid for scatter cells, annotate role,
 *                         emit per landed scatter
 *     onTumbleStep      → re-scan after cascade (scatters can land again)
 *     onFsTrigger       → emit role='scatter' for trigger-count cells
 *   emits:
 *     onDualRoleActivated { reel, row, sym, role: 'wild'|'pay'|'scatter' }
 *
 * a11y:
 *   - Cell decoration adds aria-label suffix "(scatter, wild role)".
 *   - prefers-reduced-motion kills the dual-role pulse.
 *
 * Vendor-neutral. No game / studio strings.
 *
 * @module dualRoleScatter
 */

const MODES = new Set(['wild', 'pay', 'scatter']);
const BOUNDS = Object.freeze({
  pulseMs:    [120, 1500],
  zIndex:     [10, 99],
  minLanded:  [1, 12],
});

function _clamp(v, [lo, hi], fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}
function _safe(v, max, fb) {
  if (typeof v !== 'string') return fb;
  const s = v.replace(/[<>"'`]/g, '').slice(0, max);
  return s.length ? s : fb;
}

export function defaultConfig() {
  return Object.freeze({
    enabled:        false,
    symbol:         'S',        /* scatter symbol code */
    secondaryRole:  'wild',     /* 'wild' | 'pay' | 'scatter' (off) */
    minLanded:      1,
    badgeText:      '★',
    badgeColor:     '#03110a',
    badgeBg:        '#ffd84d',
    pulseMs:        420,
    zIndex:         17,
    /* When true, emits 'scatter' role on onFsTrigger as well so audit
     * blocks can record the FS-trigger trio. */
    emitScatterRoleOnFsTrigger: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = (model && model.dualRoleScatter) || {};
  const auto = !!model.dualRoleScatter;
  if (typeof m.enabled === 'boolean') cfg.enabled = m.enabled;
  else if (auto) cfg.enabled = true;

  cfg.symbol = _safe(m.symbol, 12, cfg.symbol);
  if (typeof m.secondaryRole === 'string' && MODES.has(m.secondaryRole)) cfg.secondaryRole = m.secondaryRole;

  cfg.minLanded  = _clamp(m.minLanded,  BOUNDS.minLanded,  cfg.minLanded);
  cfg.pulseMs    = _clamp(m.pulseMs,    BOUNDS.pulseMs,    cfg.pulseMs);
  cfg.zIndex     = _clamp(m.zIndex,     BOUNDS.zIndex,     cfg.zIndex);

  cfg.badgeText  = _safe(m.badgeText, 4, cfg.badgeText);
  cfg.badgeColor = _safe(m.badgeColor, 32, cfg.badgeColor);
  cfg.badgeBg    = _safe(m.badgeBg,    32, cfg.badgeBg);

  if (typeof m.emitScatterRoleOnFsTrigger === 'boolean') cfg.emitScatterRoleOnFsTrigger = m.emitScatterRoleOnFsTrigger;
  return cfg;
}

export function emitDualRoleScatterCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* dualRoleScatter — Wave H10 */
  .symbol-cell .dual-role-badge {
    position: absolute;
    top: 4px;
    left: 4px;
    z-index: ${cfg.zIndex};
    width: 18px;
    height: 18px;
    border-radius: 9px;
    background: ${cfg.badgeBg};
    color: ${cfg.badgeColor};
    font-size: 11px;
    font-weight: 800;
    line-height: 18px;
    text-align: center;
    pointer-events: none;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.45);
    display: none;
  }
  .symbol-cell .dual-role-badge[data-active="true"] {
    display: inline-block;
    animation: dual-role-pulse ${cfg.pulseMs}ms ease-out;
  }
  @keyframes dual-role-pulse {
    0%   { transform: scale(0.6); opacity: 0.0; }
    50%  { transform: scale(1.35); opacity: 1.0; }
    100% { transform: scale(1.0); opacity: 1.0; }
  }
  @media (prefers-reduced-motion: reduce) {
    .symbol-cell .dual-role-badge[data-active="true"] { animation: none; }
  }
  `;
}

export function emitDualRoleScatterMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<!-- dualRoleScatter decorates .symbol-cell at runtime -->`;
}

export function emitDualRoleScatterRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
  /* ── dualRoleScatter BLOCK — Wave H10 ─────────────────────────────── */
  (function () {
    if (typeof window === 'undefined' || !window.HookBus) return;
    var SYM = ${JSON.stringify(cfg.symbol)};
    var ROLE = ${JSON.stringify(cfg.secondaryRole)};
    var MIN = ${cfg.minLanded};
    var BADGE = ${JSON.stringify(cfg.badgeText)};
    var EMIT_FS_SCATTER = ${JSON.stringify(cfg.emitScatterRoleOnFsTrigger)};

    function decorateCell(cell) {
      if (!cell || cell.nodeType !== 1) return;
      var sym = cell.getAttribute('data-sym') || cell.getAttribute('data-symbol') || '';
      var match = sym === SYM;
      var existing = cell.querySelector('.dual-role-badge');
      if (!match) {
        if (existing) existing.setAttribute('data-active', 'false');
        return;
      }
      if (!existing) {
        existing = document.createElement('span');
        existing.className = 'dual-role-badge';
        existing.textContent = BADGE;
        cell.appendChild(existing);
      }
      existing.setAttribute('data-active', 'true');
      var label = cell.getAttribute('aria-label') || '';
      cell.setAttribute('aria-label', (label ? label + ' ' : '') + '(scatter, ' + ROLE + ' role)');
    }

    function scanGrid(role, source) {
      if (typeof document === 'undefined') return;
      var cells = document.querySelectorAll('.symbol-cell');
      var landed = [];
      for (var i = 0; i < cells.length; i++) {
        var c = cells[i];
        var s = c.getAttribute && (c.getAttribute('data-sym') || c.getAttribute('data-symbol') || '');
        if (s === SYM) {
          decorateCell(c);
          var reel = parseInt(c.getAttribute('data-reel') || '-1', 10);
          var row  = parseInt(c.getAttribute('data-row') || '-1', 10);
          landed.push({ reel: reel, row: row, sym: s });
        }
      }
      if (landed.length >= MIN) {
        for (var k = 0; k < landed.length; k++) {
          try { window.HookBus.emit('onDualRoleActivated', { reel: landed[k].reel, row: landed[k].row, sym: SYM, role: role, source: source }); } catch (_) {}
        }
      }
      return landed.length;
    }

    window.HookBus.on('postSpin',     function () { scanGrid(ROLE, 'postSpin'); });
    window.HookBus.on('onTumbleStep', function () { scanGrid(ROLE, 'onTumbleStep'); });
    window.HookBus.on('onFsTrigger',  function () {
      if (EMIT_FS_SCATTER) scanGrid('scatter', 'onFsTrigger');
    });

    /* External API for force / dev / test. */
    window.dualRoleScan = function (role) { return scanGrid(role || ROLE, 'api'); };
  })();
  `;
}
