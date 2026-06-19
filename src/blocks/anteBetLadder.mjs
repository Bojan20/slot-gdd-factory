/**
 * src/blocks/anteBetLadder.mjs
 *
 * Wave LEGO-BUY (4 / 8) — Multi-tier ante bet ladder (stake escalator).
 *
 * @module anteBetLadder
 *
 * Purpose:
 *   When GDD declares `ante_bet_ladder` (or `ante_bet.tiers[]`), this block
 *   replaces the single boolean `anteBet` toggle with a 2–4 step ladder
 *   (e.g. OFF / +25% / +50% / +100%). Each rung carries its own
 *   `costMultiplier` and `triggerMultiplier` so the math layer can pull
 *   the matching scatter weight from the PAR. Industry reference for
 *   tiered stake escalators is the "spice up the bet" family of features
 *   that segment recreational and bonus-hunter players with the same
 *   feature surface.
 *
 *   Mutually exclusive with `anteBet.mjs` — orchestrator prefers the
 *   ladder when both resolve enabled. Single-tier degeneracy falls back
 *   to anteBet (we self-disable when tier count < 2 effective levels).
 *
 * Industry-reference (vendor-neutral):
 *   Tiered ante bets are an emerging post-2024 industry pattern. Most
 *   shipped ladders use 3 rungs: OFF (1.0×), MID (~1.5×), MAX (2.0×).
 *   Some ship 4 with an entry-level +25% rung. The trigger-probability
 *   multiplier grows roughly linearly with bet (with PAR-side RTP
 *   normalization). The block models the visual + control surface only;
 *   real math binding lands with PAR hot-swap (Phase 2).
 *
 * Public API:
 *   defaultConfig()                       → frozen safe defaults (4 sample rungs)
 *   resolveConfig(model)                  → merge defaults with GDD override
 *   emitAnteBetLadderCSS(cfg)             → CSS string (segmented rail styles)
 *   emitAnteBetLadderMarkup(cfg)          → HTML string (segmented rail)
 *   emitAnteBetLadderRuntime(cfg)         → runtime JS string for orchestrator
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onFsTrigger (lock rail while in bonus)
 *                onFsEnd     (unlock on bonus end)
 *   emits:       onAnteBetLadderChanged { rungId, costMult, triggerMult }
 *
 * a11y / perf:
 *   • role="radiogroup" with role="radio" rungs (industry pattern for
 *     mutually-exclusive multi-value controls). Keyboard: Arrow ←/→,
 *     Home/End to jump.
 *   • Tokens hoisted (0 magic numbers); honors prefers-reduced-motion.
 *   • Selected rung sets aria-checked="true" and updates
 *     `window.ANTE_BET_RUNG_ID` / `window.ANTE_BET_COST_MULT` /
 *     `window.ANTE_BET_TRIGGER_MULT` synchronously for math hook-ups.
 *   • Mutex flag `window.__ANTE_BET_LADDER_ACTIVE__ = true` so the
 *     orchestrator can skip the single-tier `anteBet` block.
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

/* Design tokens — hoisted from CSS for 0 magic numbers. */
const LADDER_TOKENS = Object.freeze({
  topPad:       18,
  topPadMobile: 10,
  zIndex:       60,
  rungPadV:     6,
  rungPadH:     10,
  rungGap:      4,
  borderRadius: 14,
  rungRadius:   10,
  fontRem:      0.74,
  mobileFontRem: 0.66,
  mobileBreak:  620,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const ID_RE  = /^[a-z][a-z0-9_-]{0,15}$/i;

/** Frozen industry-standard 4-rung ladder used as the safe default shape. */
function _defaultRungs() {
  return Object.freeze([
    Object.freeze({ id: 'off', label: 'OFF', costMultiplier: 1.00, triggerMultiplier: 1.0 }),
    Object.freeze({ id: 'low', label: '+25%', costMultiplier: 1.25, triggerMultiplier: 1.5 }),
    Object.freeze({ id: 'mid', label: '+50%', costMultiplier: 1.50, triggerMultiplier: 2.0 }),
    Object.freeze({ id: 'max', label: '+100%', costMultiplier: 2.00, triggerMultiplier: 3.0 }),
  ]);
}

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'ANTE',
    rungs: _defaultRungs(),
    /* Index into rungs[] that is "off" — must always be in range. The
     * runtime never auto-selects anything non-OFF on first paint. */
    defaultRungIndex: 0,
    color:     '#ffe066',
    colorDark: '#b08e22',
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

function _validateRung(raw, idx) {
  const fallback = _defaultRungs()[Math.min(idx, 3)] || _defaultRungs()[0];
  const cost = _clampFloat(raw.costMultiplier, 1.0, 5.0, fallback.costMultiplier);
  return Object.freeze({
    id: ID_RE.test(String(raw && raw.id || '')) ? String(raw.id) : `rung${idx}`,
    label: (typeof raw.label === 'string' && raw.label.length > 0 && raw.label.length <= 16)
      ? raw.label : fallback.label,
    costMultiplier: cost,
    triggerMultiplier: _clampFloat(raw.triggerMultiplier, 1.0, 10.0, fallback.triggerMultiplier),
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('anteBetLadder', defaultConfig(), model) };
  cfg.rungs = cfg.rungs.slice();
  const m = model.anteBetLadder || (model.anteBet && Array.isArray(model.anteBet.tiers) ? model.anteBet : {});

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  const rawRungs = Array.isArray(m.rungs) ? m.rungs : (Array.isArray(m.tiers) ? m.tiers : null);
  if (rawRungs && rawRungs.length > 0) {
    const seen = new Set();
    const out = [];
    for (let i = 0; i < rawRungs.length && out.length < 5; i++) {
      const r = _validateRung(rawRungs[i] || {}, i);
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      out.push(r);
    }
    if (out.length > 0) cfg.rungs = out;
  }

  /* Auto-enable when GDD features hint a ladder shape. */
  if (Array.isArray(model.features)) {
    const hasLadder = model.features.some(f =>
      f.kind === 'ante_bet_ladder' ||
      (f.kind === 'ante_bet' && (
        (Array.isArray(f.tiers) && f.tiers.length >= 2) ||
        (Array.isArray(f.rungs) && f.rungs.length >= 2)
      ))
    );
    if (hasLadder) {
      const ctxOverride = applyGridProfile('anteBetLadder', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
      if ((!rawRungs || rawRungs.length === 0)) {
        for (const f of model.features) {
          const tiers = Array.isArray(f.rungs) ? f.rungs : (Array.isArray(f.tiers) ? f.tiers : null);
          if (tiers && tiers.length >= 2) {
            cfg.rungs = tiers.slice(0, 5).map((r, i) => _validateRung(r || {}, i));
            break;
          }
        }
      }
    }
  }

  /* Single-rung degeneracy: ladder needs ≥ 2 distinct rungs to be
   * meaningful. Otherwise we fall back to the boolean anteBet block. */
  if (cfg.enabled && cfg.rungs.length < 2) {
    cfg.enabled = false;
    cfg.collapsedToSingleRung = true;
  }

  cfg.defaultRungIndex = _clampInt(
    Number.isFinite(m.defaultRungIndex) ? m.defaultRungIndex : 0,
    0,
    Math.max(0, cfg.rungs.length - 1),
    0
  );

  cfg.rungs = Object.freeze(cfg.rungs);
  return cfg;
}

export function emitAnteBetLadderCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = LADDER_TOKENS;
  return `
/* ─── ante bet ladder ────────────────────────────────────────────── */
/* Segmented control pinned TOP-LEFT (same dock as the boolean anteBet
   block — boolean toggle is replaced by the multi-rung rail). */
.ante-bet-ladder {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  left: max(${T.topPad}px, env(safe-area-inset-left, ${T.topPad}px));
  z-index: ${T.zIndex};
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.4rem 0.7rem;
  background: rgba(0,0,0,.6);
  border: 1px solid rgba(255,255,255,.22);
  border-radius: ${T.borderRadius}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: ${cfg.color};
  user-select: none;
}
.ante-bet-ladder .ladder-label {
  font-size: ${T.fontRem}rem;
  opacity: 0.92;
  letter-spacing: 0.1em;
}
.ante-bet-ladder .ladder-rail {
  display: inline-flex;
  gap: ${T.rungGap}px;
  padding: 2px;
  background: rgba(255,255,255,.06);
  border-radius: ${T.rungRadius}px;
}
.ante-bet-ladder .ladder-rung {
  appearance: none;
  border: none;
  background: transparent;
  color: ${cfg.color};
  padding: ${T.rungPadV}px ${T.rungPadH}px;
  border-radius: ${T.rungRadius}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.04em;
  cursor: pointer;
  outline: none;
  transition: background .15s ease, color .15s ease, transform .15s ease;
}
.ante-bet-ladder .ladder-rung:focus-visible {
  box-shadow: 0 0 0 2px #fff;
}
.ante-bet-ladder .ladder-rung[aria-checked="true"] {
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
}
.ante-bet-ladder .ladder-rung:hover:not([aria-checked="true"]) {
  background: rgba(255,255,255,.1);
}
.ante-bet-ladder[data-locked="true"] {
  opacity: 0.5;
  pointer-events: none;
}
@media (max-width: ${T.mobileBreak}px) {
  .ante-bet-ladder {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
    left: max(${T.topPadMobile}px, env(safe-area-inset-left, ${T.topPadMobile}px));
    padding: 0.3rem 0.55rem;
    font-size: ${T.mobileFontRem}rem;
    gap: 0.35rem;
  }
  .ante-bet-ladder .ladder-rung {
    font-size: ${T.mobileFontRem}rem;
    padding: 4px 7px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .ante-bet-ladder .ladder-rung { transition: none; }
}
`;
}

export function emitAnteBetLadderMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const di = cfg.defaultRungIndex;
  const rungs = cfg.rungs.map((r, i) => `
    <button type="button"
            class="ladder-rung"
            role="radio"
            data-rung-id="${escapeAttr(r.id)}"
            data-cost-mult="${r.costMultiplier}"
            data-trigger-mult="${r.triggerMultiplier}"
            data-rung-index="${i}"
            aria-checked="${i === di ? 'true' : 'false'}"
            tabindex="${i === di ? '0' : '-1'}">${escapeHtml(r.label)}</button>`).join('');
  return `<div id="anteBetLadder" class="ante-bet-ladder" data-locked="false" role="group" aria-label="Ante bet ladder">
  <span class="ladder-label">${escapeHtml(cfg.label)}</span>
  <div class="ladder-rail" role="radiogroup" aria-label="Ante bet level">${rungs}
  </div>
</div>`;
}

export function emitAnteBetLadderRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* anteBetLadder: disabled */`;
  return `/* ─── ante bet ladder runtime ────────────────────────────────── */
/**
 * @perf <0.1ms select, no rAF, no allocations on tick.
 */
const ABL_DEFAULT_INDEX = ${cfg.defaultRungIndex};

if (typeof window !== 'undefined') {
  window.__ANTE_BET_LADDER_ACTIVE__ = true;
}

(function wireAnteBetLadder(){
  const host = document.getElementById('anteBetLadder');
  if (!host) return;
  const rungs = Array.prototype.slice.call(host.querySelectorAll('.ladder-rung'));
  if (rungs.length < 2) return;

  function applyRung(idx) {
    const safe = Math.max(0, Math.min(rungs.length - 1, idx));
    rungs.forEach(function(r, i){
      const sel = (i === safe);
      r.setAttribute('aria-checked', sel ? 'true' : 'false');
      r.setAttribute('tabindex', sel ? '0' : '-1');
    });
    const cur = rungs[safe];
    const rungId   = cur.getAttribute('data-rung-id');
    const costMult = parseFloat(cur.getAttribute('data-cost-mult'));
    const trigMult = parseFloat(cur.getAttribute('data-trigger-mult'));
    if (typeof window !== 'undefined') {
      window.ANTE_BET_RUNG_ID      = rungId;
      window.ANTE_BET_COST_MULT    = costMult;
      window.ANTE_BET_TRIGGER_MULT = trigMult;
      // Mirror the legacy boolean for downstream code that still checks it.
      window.ANTE_BET_ON = (rungId !== 'off' && costMult > 1.0);
    }
    if (typeof HookBus !== 'undefined' && typeof HookBus.emit === 'function') {
      HookBus.emit('onAnteBetLadderChanged', {
        rungId: rungId, costMult: costMult, triggerMult: trigMult
      });
    }
  }

  rungs.forEach(function(rung, idx){
    rung.addEventListener('click', function(){
      if (host.getAttribute('data-locked') === 'true') return;
      applyRung(idx);
    });
    rung.addEventListener('keydown', function(e){
      if (host.getAttribute('data-locked') === 'true') return;
      let next = idx;
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (idx + 1) % rungs.length;
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (idx - 1 + rungs.length) % rungs.length;
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End')  next = rungs.length - 1;
      else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); applyRung(idx); return; }
      else return;
      e.preventDefault();
      applyRung(next);
      rungs[next].focus();
    });
  });

  // Lock during bonus phase so the player can't change rungs mid-feature.
  HookBus.on('onFsTrigger', function(){ host.setAttribute('data-locked', 'true'); });
  HookBus.on('onFsEnd',     function(){ host.setAttribute('data-locked', 'false'); });

  applyRung(ABL_DEFAULT_INDEX);
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
function escapeAttr(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
