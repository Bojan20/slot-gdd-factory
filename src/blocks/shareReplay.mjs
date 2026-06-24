/**
 * src/blocks/shareReplay.mjs
 *
 * Wave LEGO-SOCIAL (B-5 · 2/2) — Anonymous share-replay link generator.
 *
 * @module shareReplay
 *
 * Purpose:
 *   On big-win events, surfaces a "SHARE" button that bundles the
 *   captured spin frame from `window.__SPIN_HISTORY__` into an
 *   anonymous, PII-free token URL the player can copy or open in a
 *   share sheet. The token is base64-encoded JSON of:
 *     { spinIndex, win, gridSnapshot, at }
 *   No player handle, no IP, no account id ever leaves the device.
 *
 *   This block does NOT post to any social network — it generates the
 *   token + invokes navigator.share() when available, falls back to
 *   navigator.clipboard.writeText otherwise. Regulator-friendly.
 *
 * Industry-reference (vendor-neutral):
 *   Share-replay tokens are an emerging post-2023 pattern that lets
 *   players brag about big wins without exposing PII. Industry
 *   baseline: trigger on big-win presentation, navigator.share() web
 *   API (with clipboard fallback), no auto-posting.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitShareReplayCSS(cfg)                  → CSS string
 *   emitShareReplayMarkup(cfg)               → HTML string
 *   emitShareReplayRuntime(cfg)              → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onBigWinTierEnter (any tier) — show share button
 *                onBigWinTierExit             — hide share button
 *                onSpinResult — refresh latest frame ref
 *                onFsTrigger — suppress mid-bonus
 *                onFsEnd — resume
 *   emits:       onShareReplayInvoked { method: 'native' | 'clipboard' | 'failed' }
 *
 * a11y / perf:
 *   • Button is a real <button> with aria-label "Share this win"
 *   • Focus ring + Esc to hide
 *   • Toast confirmation via aria-live="polite" region
 *   • prefers-reduced-motion honored
 *   • Strictly anonymous — no PII collected or transmitted
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  btnTop:         70,
  btnTopMobile:   55,
  btnRight:       14,
  btnRightMobile: 10,
  zIndex:         58,
  btnPadV:        8,
  btnPadH:        14,
  btnRadius:      12,
  fontRem:        0.78,
  fontRemMobile:  0.7,
  toastFadeMs:    260,
  toastTop:       110,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'SHARE WIN',
    /* Token URL prefix — operator can customize host. The block always
     * uses anchor-fragment encoding so the token never hits the server
     * (privacy: no GET query string in access logs). */
    tokenHostPrefix: 'https://share.example/replay#',
    color:     '#c5a8ff',
    colorDark: '#5a3a9c',
    haloRGB:   '197,168,255',
  });
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('shareReplay', defaultConfig(), model) };
  const m = model.shareReplay || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('shareReplay', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (typeof m.tokenHostPrefix === 'string' && /^https?:\/\/[^\s]{1,200}#?$/.test(m.tokenHostPrefix)) {
    cfg.tokenHostPrefix = m.tokenHostPrefix;
  }
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'share_replay' || f.kind === 'share_win')) {
    const ctxOverride = applyGridProfile('shareReplay', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitShareReplayCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── share replay button + toast ───────────────────────────────── */
.share-replay-btn {
  position: fixed;
  top: ${T.btnTop}px;
  right: max(${T.btnRight}px, env(safe-area-inset-right, ${T.btnRight}px));
  z-index: ${T.zIndex};
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #fff;
  border: 1px solid rgba(255,255,255,.4);
  border-radius: ${T.btnRadius}px;
  padding: ${T.btnPadV}px ${T.btnPadH}px;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.12em;
  cursor: pointer;
  box-shadow: 0 4px 18px rgba(${cfg.haloRGB},.55);
  opacity: 0; pointer-events: none;
  transform: translateY(-6px);
  transition: opacity .22s ease, transform .22s ease;
}
.share-replay-btn[data-show="true"] {
  opacity: 1; pointer-events: auto; transform: translateY(0);
}
.share-replay-btn:hover { filter: brightness(1.15); }
.share-replay-btn:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.share-replay-toast {
  position: fixed;
  top: ${T.toastTop}px; right: max(${T.btnRight}px, env(safe-area-inset-right, ${T.btnRight}px));
  z-index: ${T.zIndex};
  background: rgba(0,0,0,.82);
  border: 1px solid rgba(${cfg.haloRGB},.5);
  border-radius: 10px;
  padding: 6px 12px;
  font-size: 0.72rem;
  color: ${cfg.color};
  font-weight: 700;
  letter-spacing: 0.08em;
  opacity: 0; pointer-events: none;
  transition: opacity ${T.toastFadeMs}ms ease;
}
.share-replay-toast[data-show="true"] { opacity: 1; }
@media (max-width: 620px) {
  .share-replay-btn {
    top: ${T.btnTopMobile}px;
    right: max(${T.btnRightMobile}px, env(safe-area-inset-right, ${T.btnRightMobile}px));
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .share-replay-btn, .share-replay-toast { transition: none !important; }
}
`;
}

export function emitShareReplayMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return `<button id="shareReplayBtn" class="share-replay-btn" type="button"
        aria-label="Share this win" data-show="false">${escapeHtml(cfg.label)}</button>
<div id="shareReplayToast" class="share-replay-toast" role="status" aria-live="polite"
     aria-atomic="true" data-show="false"></div>`;
}

export function emitShareReplayRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* shareReplay: disabled */`;
  return `/* ─── share replay runtime ───────────────────────────────────── */
const SR_TOKEN_HOST = ${JSON.stringify(cfg.tokenHostPrefix)};

(function wireShareReplay(){
  const btn   = document.getElementById('shareReplayBtn');
  const toast = document.getElementById('shareReplayToast');
  if (!btn || !toast) return;
  let suspended = false;
  let toastTimer = null;

  function buildToken() {
    const state = window.__SPIN_HISTORY__;
    const frame = (state && state.buffer && state.buffer.length > 0)
      ? state.buffer[state.buffer.length - 1] : null;
    const payload = {
      spinIndex: state ? state.buffer.length - 1 : 0,
      win: frame ? frame.win : 0,
      at: frame ? frame.at : Date.now(),
      /* gridSnapshot is the captured outerHTML — but it's too large for
       * a URL. We hash to a fingerprint instead; the receiving server
       * would re-fetch the actual frame from the operator's signed
       * URL on tap. For the placeholder UI this is just a length proxy. */
      gridSize: frame && frame.gridHTML ? frame.gridHTML.length : 0,
    };
    try { return btoa(JSON.stringify(payload)); }
    catch (_) { return null; }
  }

  function buildUrl() {
    const tok = buildToken();
    if (!tok) return null;
    return SR_TOKEN_HOST + tok;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.setAttribute('data-show', 'true');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function(){
      toast.setAttribute('data-show', 'false');
    }, 2200);
  }

  function emitInvoked(method) {
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onShareReplayInvoked', { method: method });
    }
  }

  btn.addEventListener('click', function(){
    const url = buildUrl();
    if (!url) { showToast('Share unavailable'); emitInvoked('failed'); return; }

    /* Prefer native share sheet (mobile); fall back to clipboard. */
    if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      navigator.share({ title: 'My slot win', text: 'Check out this win!', url: url })
        .then(function(){ showToast('Shared!'); emitInvoked('native'); })
        .catch(function(){
          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url)
              .then(function(){ showToast('Link copied'); emitInvoked('clipboard'); })
              .catch(function(){ showToast('Share failed'); emitInvoked('failed'); });
          } else {
            showToast('Share failed'); emitInvoked('failed');
          }
        });
    } else if (typeof navigator !== 'undefined' && navigator.clipboard &&
               navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url)
        .then(function(){ showToast('Link copied'); emitInvoked('clipboard'); })
        .catch(function(){ showToast('Share failed'); emitInvoked('failed'); });
    } else {
      showToast('Share unavailable'); emitInvoked('failed');
    }
  });

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && btn.getAttribute('data-show') === 'true') {
      e.preventDefault();
      btn.setAttribute('data-show', 'false');
    }
  });

  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onBigWinTierEnter', function(){
    if (suspended) return;
    btn.setAttribute('data-show', 'true');
  }) : void 0);
  HookBus.on('onBigWinTierExit', function(){
    btn.setAttribute('data-show', 'false');
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onFsTrigger', function(){
    suspended = true;
    btn.setAttribute('data-show', 'false');
  }) : void 0);
  HookBus.on('onFsEnd', function(){ suspended = false; });
})();
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
