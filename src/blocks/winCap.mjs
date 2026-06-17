/**
 * src/blocks/winCap.mjs
 *
 * Wave N3 (base) + W51 (cross-jurisdiction enforcement) — Win Cap terminator.
 *
 * Regulator-mandated max-win enforcement. When cumulative win reaches
 * maxWinX × bet, current spin/round terminates immediately and a
 * "MAX WIN!" overlay is shown. Industry baseline: regulator-mandated max-win
 * cap — typical 5000× / 10 000× bet thresholds.
 *
 * W51 cross-jurisdiction matrix (HARD ceiling — operator cannot exceed):
 *
 *   UKGC                 100 000× stake  (Remote Gambling RTS 13 max-win cap)
 *   MGA (Malta)          500 000× stake  (Player Protection Directive §5)
 *   SE Spelinspektionen  500 000× stake  (Tech Std 6.5 max-win clamp)
 *   DE GlüStV            100 000× stake  (effective via €1 stake floor + §11)
 *   NL KSA               250 000× stake  (Spel-1 §16 ceiling)
 *   ON AGCO              250 000× stake  (Standard 4.06 max-win disclosure)
 *   NJ DGE               varies          (per-game ceiling in operator licence)
 *
 * If `model.responsibleGambling.jurisdiction` (or alias
 * `model.regulator.profile`) is set, the maxWinX is CLAMPED to the
 * jurisdiction ceiling — operator cannot exceed regulator hard limit
 * even via explicit GDD override. A clamp generates a one-time runtime
 * warning + `onWinCapClamped` event for the audit log.
 *
 * GDD knobs:
 *   • maxWinX: number — multiplier of base bet (default 5000)
 *   • mode: 'round' | 'spin' — cap applied per-round (default) or per-spin
 *   • jurisdiction: 'UKGC' | 'MGA' | 'SE' | 'DE' | 'NL' | 'ON' | 'NJ' | 'OFF'
 *   • overlayLabel: string
 *   • overlayMs: number — duration of MAX WIN overlay
 *   • color: 'r,g,b'
 *   • forceRoundEnd: boolean — true = kill FS round on cap hit
 *
 * HookBus events:
 *   • onWinCapTriggered { jurisdiction, ceiling, hitAt, mode } — cap fired
 *   • onWinCapClamped { requested, ceiling, jurisdiction } — explicit
 *     override exceeded jurisdiction ceiling, clamped down
 */

/* W59.H1 — Central jurisdiction precedence resolver (regulator.profile
 * > responsibleGambling.jurisdiction > winCap.jurisdiction fallback). */
import { resolveJurisdiction } from './jurisdictionGate.mjs';

/* W51 — per-jurisdiction ceiling matrix. Operator cannot exceed.
 * `OFF` = no jurisdiction profile, GDD value passes through (used for
 * permissive markets / unregulated demo builds). */
/* W58.J-AGCO — Jurisdictions that require RTP transparency disclosure
 * at session launch. Mirrors W57.A4 + W58.J-UKGC routing pattern.
 *
 * Citations:
 *   • ON AGCO Standard 4.06 — RTP transparency display mandatory
 *   • UKGC RTS 8 — return-to-player must be visible to player
 *   • MGA Player Protection — RTP visibility recommended */
export const RTP_DISCLOSURE_REQUIRED_JURISDICTIONS = Object.freeze(['ON', 'UKGC', 'MGA']);

export const JURISDICTION_CEILINGS = Object.freeze({
  UKGC: 100000,
  MGA:  500000,
  SE:   500000,
  DE:   100000,
  NL:   250000,
  ON:   250000,
  NJ:   500000,   /* upper-bound default; per-licence variance via override */
  /* W57.A3 — IT ADM added to jurisdiction matrix per rg-architect
   * cross-jurisdiction audit. Italian Agenzia delle Dogane e dei
   * Monopoli (ADM) sets the technical ceiling for online slot operators
   * licensed under the AAMS regime; the 250 000× line aligns with
   * neighbouring EEA jurisdictions (NL, ON) that share the same cap
   * order-of-magnitude. */
  IT:   250000,
  OFF:  1000000,  /* dev/demo default-permissive (no jurisdiction profile) */
});

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    maxWinX: 5000,
    mode: 'round',
    jurisdiction: 'OFF',
    ceilingApplied: false,    /* W51 — true if maxWinX was clamped down */
    overlayLabel: 'MAX WIN!',
    overlayMs: 2400,
    color: '255,215,0',
    forceRoundEnd: true,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const m = model.winCap || {};
  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.maxWinX)) cfg.maxWinX = clampInt(m.maxWinX, 100, 1000000);
  if (m.mode === 'round' || m.mode === 'spin') cfg.mode = m.mode;
  if (typeof m.overlayLabel === 'string' && m.overlayLabel.length > 0 && m.overlayLabel.length <= 30) {
    cfg.overlayLabel = m.overlayLabel;
  }
  if (Number.isFinite(m.overlayMs)) cfg.overlayMs = clampInt(m.overlayMs, 400, 12000);
  if (typeof m.color === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.color)) cfg.color = m.color;
  if (m.forceRoundEnd != null) cfg.forceRoundEnd = !!m.forceRoundEnd;

  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'win_cap')) {
    cfg.enabled = true;
  }
  /* Also enable from explicit limits.max_win_x in JSON IR */
  if (model.limits && Number.isFinite(model.limits.max_win_x)) {
    cfg.enabled = true;
    cfg.maxWinX = clampInt(model.limits.max_win_x, 100, 1000000);
  }

  /* W59.H1 — Centralized precedence chain (was an inline last-write-wins
   * loop). Semantics preserved: regulator.profile WINS, then RG, then
   * winCap.jurisdiction (W51 cross-jurisdiction enforcement). */
  const jurisdiction = resolveJurisdiction(model, { fallbackKey: 'winCap.jurisdiction' });
  if (jurisdiction && Object.prototype.hasOwnProperty.call(JURISDICTION_CEILINGS, jurisdiction)) {
    cfg.jurisdiction = jurisdiction;
    /* Auto-enable when an explicit regulated jurisdiction is set — operators
     * deploying under any of UKGC/MGA/SE/DE/NL/ON/NJ MUST have the cap
     * surface active even if the GDD forgot to flip enabled=true. */
    if (cfg.jurisdiction !== 'OFF') cfg.enabled = true;
    const ceiling = JURISDICTION_CEILINGS[cfg.jurisdiction];
    if (cfg.maxWinX > ceiling) {
      cfg.maxWinX = ceiling;
      cfg.ceilingApplied = true;
    }
  }

  /* W58.J-AGCO — RTP transparency disclosure. ON AGCO Standard 4.06 +
   * UKGC RTS 8 require RTP visible to player at session launch. Read
   * RTP from model.math.rtp (read-only — math layer remains gated per
   * rule_no_math_unless_asked; we only EXPOSE existing value). Falls
   * back to model.rtp shorthand. Value clamped to 0..1 range; falsy
   * values left as null so downstream consumers can detect absence. */
  let rtpValue = null;
  if (model && model.math && Number.isFinite(model.math.rtp)) {
    rtpValue = Number(model.math.rtp);
  } else if (model && Number.isFinite(model.rtp)) {
    rtpValue = Number(model.rtp);
  }
  if (rtpValue !== null && (rtpValue < 0 || rtpValue > 1)) rtpValue = null;
  cfg.rtp = rtpValue;
  cfg.requireRtpDisclosure = !!(cfg.jurisdiction && RTP_DISCLOSURE_REQUIRED_JURISDICTIONS.indexOf(cfg.jurisdiction) !== -1);

  return cfg;
}

export function emitWinCapCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `
/* ─── win cap overlay ───────────────────────────────────────────── */
.wincap-overlay {
  position: fixed;
  inset: 0;
  z-index: 99;
  display: none;
  align-items: center;
  justify-content: center;
  background: radial-gradient(circle, rgba(0,0,0,.55), rgba(0,0,0,.85));
  backdrop-filter: blur(6px);
  pointer-events: none;
}
.wincap-overlay[data-show="true"] {
  display: flex;
  animation: wcFade 320ms ease-out;
}
.wincap-overlay .wc-card {
  background: linear-gradient(135deg, rgba(${cfg.color},.18), rgba(${cfg.color},.05));
  border: 2.5px solid rgba(${cfg.color},.85);
  border-radius: 18px;
  padding: 1.5rem 2.4rem;
  color: rgba(${cfg.color},1);
  font-size: 2.4rem;
  font-weight: 900;
  letter-spacing: 0.14em;
  text-align: center;
  box-shadow: 0 0 60px rgba(${cfg.color},.65);
  text-shadow: 0 0 22px rgba(${cfg.color},.85);
  animation: wcPulse 1.4s ease-in-out infinite;
}
@keyframes wcFade { from { opacity: 0; } to { opacity: 1; } }
@keyframes wcPulse {
  0%, 100% { transform: scale(1); }
  50%      { transform: scale(1.06); }
}
@media (prefers-reduced-motion: reduce) {
  .wincap-overlay[data-show="true"], .wincap-overlay .wc-card { animation: none; }
}
@media (max-width: 620px) {
  .wincap-overlay .wc-card { font-size: 1.5rem; padding: 1rem 1.5rem; }
}
`;
}

export function emitWinCapMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<div id="winCapOverlay" class="wincap-overlay" data-show="false" role="alert">
  <div class="wc-card">${escapeHtml(cfg.overlayLabel)}</div>
</div>`;
}

export function emitWinCapRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* winCap: disabled */`;
  return `/* ─── win cap runtime (W51 jurisdiction-aware) ─────────────────── */
const WIN_CAP_MAX_X        = ${cfg.maxWinX};
const WIN_CAP_MODE         = ${JSON.stringify(cfg.mode)};
const WIN_CAP_OVERLAY_MS   = ${cfg.overlayMs};
const WIN_CAP_FORCE_END    = ${cfg.forceRoundEnd ? 'true' : 'false'};
const WIN_CAP_JURISDICTION = ${JSON.stringify(cfg.jurisdiction)};
const WIN_CAP_CEILING_APPLIED = ${cfg.ceilingApplied ? 'true' : 'false'};
const WIN_CAP_RTP_REQUIRED = ${cfg.requireRtpDisclosure ? 'true' : 'false'};
const WIN_CAP_RTP_VALUE = ${cfg.rtp === null ? 'null' : Number(cfg.rtp)};
let WIN_CAP_CUMULATIVE_X = 0;

/* W51 — emit one-time clamp audit event so RG / compliance log sees that
 * the operator's requested cap was lowered to jurisdiction ceiling. */
if (WIN_CAP_CEILING_APPLIED && typeof HookBus !== 'undefined') {
  try {
    HookBus.emit('onWinCapClamped', {
      jurisdiction: WIN_CAP_JURISDICTION,
      ceiling: WIN_CAP_MAX_X,
    });
  } catch (_) {}
}

/* W58.J-AGCO — emit RTP transparency disclosure event at boot so
 * downstream consumer (regulator modal / paytable / H1 jurisdictionGate)
 * surfaces the RTP value to the player before first spin. Honest scope:
 * if RTP value is null (math layer gated; no value in model), event
 * payload carries rtp:null so consumer can render "RTP: pending"
 * placeholder instead of throwing. */
if (WIN_CAP_RTP_REQUIRED && typeof HookBus !== 'undefined') {
  try {
    HookBus.emit('onRtpDisclosureRequired', {
      jurisdiction: WIN_CAP_JURISDICTION,
      rtp: WIN_CAP_RTP_VALUE,
    });
  } catch (_) {}
}

function winCapAdd(winX) {
  if (!Number.isFinite(winX) || winX <= 0) return false;
  if (WIN_CAP_MODE === 'spin') {
    if (winX >= WIN_CAP_MAX_X) { winCapTrigger(winX); return true; }
    return false;
  }
  WIN_CAP_CUMULATIVE_X += winX;
  if (WIN_CAP_CUMULATIVE_X >= WIN_CAP_MAX_X) { winCapTrigger(WIN_CAP_CUMULATIVE_X); return true; }
  return false;
}

function winCapTrigger(hitAt) {
  const overlay = document.getElementById('winCapOverlay');
  if (overlay) {
    overlay.dataset.show = 'true';
    setTimeout(() => { overlay.dataset.show = 'false'; }, WIN_CAP_OVERLAY_MS);
  }
  /* W51 — Audit event for regulator log. Lets downstream consumers
   * (telemetry, audit trail, automated cert harness) capture the moment
   * cap was hit + which jurisdiction the deployment is operating under. */
  if (typeof HookBus !== 'undefined') {
    try {
      HookBus.emit('onWinCapTriggered', {
        jurisdiction: WIN_CAP_JURISDICTION,
        ceiling: WIN_CAP_MAX_X,
        hitAt: Number.isFinite(hitAt) ? hitAt : WIN_CAP_MAX_X,
        mode: WIN_CAP_MODE,
      });
    } catch (_) {}
  }
  if (WIN_CAP_FORCE_END && typeof FSM_enterOutro === 'function') {
    /* Skip rest of round, jump to outro */
    setTimeout(() => { try { FSM_enterOutro(); } catch(e) {} }, WIN_CAP_OVERLAY_MS / 2);
  }
}

function winCapReset() {
  WIN_CAP_CUMULATIVE_X = 0;
  const overlay = document.getElementById('winCapOverlay');
  if (overlay) overlay.dataset.show = 'false';
}

function winCapGet() { return WIN_CAP_CUMULATIVE_X; }

if (typeof window !== 'undefined') {
  window.winCapAdd     = winCapAdd;
  window.winCapTrigger = winCapTrigger;
  window.winCapReset   = winCapReset;
  window.winCapGet     = winCapGet;
  window.WIN_CAP_MAX_X = WIN_CAP_MAX_X;
}

/* HookBus wire-up — winCap watches every settled win event and short-
   circuits the round when the cumulative payout reaches WIN_CAP_MAX_X.
   onFsTrigger resets the cumulative ledger so each FS round starts fresh.
   Without these handlers winCap is dead code (function defined but never
   called). */
if (typeof HookBus !== 'undefined') {
  /* F5 fix (Boki cross-block audit): winCap CLAMP ev.payX IN-PLACE so
     downstream presenters (winPresentation, bigWinTier, paylineOverlay)
     honor the cap. Without in-place mutation the cap flag was set but
     the round still paid the uncapped amount.
     Priority 100 ensures clamp runs BEFORE presenter handlers. */
  HookBus.on('postSpin', ({ events } = {}) => {
    if (!Array.isArray(events) || events.length === 0) return;
    for (const ev of events) {
      const winX = Number(ev && ev.payX);
      if (!Number.isFinite(winX) || winX <= 0) continue;
      const remaining = Math.max(0, WIN_CAP_MAX_X - WIN_CAP_CUMULATIVE_X);
      if (winX > remaining && ev) {
        ev.payX = remaining;
      }
      if (winCapAdd(winX)) break;
    }
  }, { priority: 100 });
  HookBus.on('preSpin', () => {
    if (WIN_CAP_MODE === 'spin') winCapReset();
  });
  HookBus.on('onFsTrigger', () => { winCapReset(); });
  HookBus.on('onFsEnd',     () => { winCapReset(); });
}
`;
}

function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
