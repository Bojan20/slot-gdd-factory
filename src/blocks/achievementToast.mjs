import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/achievementToast.mjs
 *
 * Wave LEGO-PROG (DEF1 · 3/3) — Level-up + achievement toast popups.
 *
 * @module achievementToast
 *
 * Purpose:
 *   When `playerXp.mjs` emits `onPlayerLevelUp` or when another block
 *   (or operator) emits a generic achievement event, this block paints
 *   a celebratory toast in top-center with badge label + reward
 *   description + dismiss timer. Stack-aware — if multiple toasts
 *   arrive fast, they queue gracefully instead of overlapping.
 *
 * Industry-reference (vendor-neutral):
 *   Achievement toasts are an emerging 2024-2026 polish layer.
 *   Industry baseline: top-center floating card, 3-5s visible, badge
 *   icon + title + sub, optional confetti, click-through allowed. WCAG
 *   role=alert + aria-live=assertive for the open moment.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitAchievementToastCSS(cfg)             → CSS string
 *   emitAchievementToastMarkup(cfg)          → HTML string
 *   emitAchievementToastRuntime(cfg)         → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onPlayerLevelUp        — auto-toast Level N badge
 *                onAchievementUnlocked  — explicit operator-pushed achievement
 *   emits:       onAchievementToastShown   { kind, label }
 *                onAchievementToastDismissed { kind, label, reason }
 *
 * a11y / perf:
 *   • role="alert" + aria-live="assertive" + aria-atomic="true"
 *   • Dismissable via Esc OR click on toast OR auto-timer
 *   • prefers-reduced-motion: instant fade
 *   • Queue: max 3 concurrent toasts, oldest auto-dismiss
 *   • Tokens hoisted (0 magic numbers)
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  topPad:           14,
  topPadMobile:     10,
  zIndex:           67,
  cardWidth:        300,
  cardMaxVw:        92,
  cardPadV:         10,
  cardPadH:         16,
  cardRadius:       12,
  badgeSize:        36,
  fontTitleRem:     0.9,
  fontSubRem:       0.72,
  fadeMs:           220,
  defaultVisibleMs: 3500,
  gapBetween:       8,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const RGB_RE = /^\d{1,3},\d{1,3},\d{1,3}$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'LEVEL UP',
    /* How long each toast remains visible before auto-dismissing. */
    visibleMs: 3500,
    /* Maximum simultaneous toasts. Older ones auto-dismiss FIFO. */
    maxQueue: 3,
    color:    '#ffd34a',
    colorDark: '#a07520',
    haloRGB:  '255,211,74',
    badgeEmoji: '🏆',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('achievementToast', defaultConfig(), model) };
  const m = model.achievementToast || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('achievementToast', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 24) cfg.label = m.label;
  if (Number.isFinite(m.visibleMs)) cfg.visibleMs = _clampInt(m.visibleMs, 500, 30000, cfg.visibleMs);
  if (Number.isFinite(m.maxQueue))  cfg.maxQueue  = _clampInt(m.maxQueue, 1, 10, cfg.maxQueue);
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;
  if (typeof m.haloRGB === 'string' && RGB_RE.test(m.haloRGB)) cfg.haloRGB = m.haloRGB;
  if (typeof m.badgeEmoji === 'string' && m.badgeEmoji.length > 0 && m.badgeEmoji.length <= 8) {
    cfg.badgeEmoji = m.badgeEmoji;
  }

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'achievement_toast' || f.kind === 'level_up_toast' ||
                               f.kind === 'player_xp' || f.kind === 'player_progression')) {
    const ctxOverride = applyGridProfile('achievementToast', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitAchievementToastCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── achievement toast stack ───────────────────────────────────── */
.achievement-toast-stack {
  position: fixed;
  top: max(${T.topPad}px, env(safe-area-inset-top, ${T.topPad}px));
  left: 50%;
  transform: translateX(-50%);
  z-index: ${T.zIndex};
  display: flex; flex-direction: column; gap: ${T.gapBetween}px;
  pointer-events: none;
  align-items: center;
}
.achievement-toast {
  pointer-events: auto;
  width: ${T.cardWidth}px;
  max-width: ${T.cardMaxVw}vw;
  background: linear-gradient(135deg, ${cfg.color}, ${cfg.colorDark});
  color: #1a1a1a;
  border-radius: ${T.cardRadius}px;
  padding: ${T.cardPadV}px ${T.cardPadH}px;
  display: flex; align-items: center; gap: 12px;
  box-shadow: 0 12px 36px rgba(0,0,0,.55), 0 0 32px rgba(${cfg.haloRGB},.5);
  opacity: 0;
  transform: translateY(-12px);
  transition: opacity ${T.fadeMs}ms ease, transform ${T.fadeMs}ms ease;
  cursor: pointer;
}
.achievement-toast[data-show="true"] {
  opacity: 1; transform: translateY(0);
}
.achievement-toast .at-badge {
  width: ${T.badgeSize}px; height: ${T.badgeSize}px;
  border-radius: 50%;
  background: rgba(255,255,255,.55);
  display: flex; align-items: center; justify-content: center;
  font-size: 1.4rem;
  flex-shrink: 0;
}
.achievement-toast .at-body { flex: 1; }
.achievement-toast .at-title {
  font-size: ${T.fontTitleRem}rem; font-weight: 900;
  letter-spacing: 0.12em; line-height: 1.2;
}
.achievement-toast .at-sub {
  font-size: ${T.fontSubRem}rem; font-weight: 600;
  letter-spacing: 0.04em; opacity: 0.78;
  margin-top: 2px;
}
.achievement-toast:focus-visible {
  outline: 3px solid #fff; outline-offset: 2px;
}
@media (max-width: 620px) {
  .achievement-toast-stack {
    top: max(${T.topPadMobile}px, env(safe-area-inset-top, ${T.topPadMobile}px));
  }
}
@media (prefers-reduced-motion: reduce) {
  .achievement-toast { transition: none !important; }
}
`;
}

export function emitAchievementToastMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<div id="achievementToastStack" class="achievement-toast-stack"
     role="alert" aria-live="assertive" aria-atomic="true"></div>`, 'achievementToast');
}

export function emitAchievementToastRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* achievementToast: disabled */`;
  return `/* ─── achievement toast runtime ──────────────────────────────── */
const AT_VISIBLE_MS = ${cfg.visibleMs};
const AT_MAX_QUEUE  = ${cfg.maxQueue};
const AT_BADGE      = ${JSON.stringify(cfg.badgeEmoji)};
const AT_DEFAULT_LABEL = ${JSON.stringify(cfg.label)};

(function wireAchievementToast(){
  const stack = document.getElementById('achievementToastStack');
  if (!stack) return;

  function rewardText(reward) {
    if (!reward) return '';
    if (reward.kind === 'credit')     return '+' + reward.value + ' CREDITS';
    if (reward.kind === 'fs_trigger') return reward.value + ' FREE SPINS';
    if (reward.kind === 'multiplier') return '×' + reward.value + ' WIN MULT';
    if (reward.kind === 'boost')      return 'BOOST UNLOCKED';
    return '';
  }

  function makeToast(opts) {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'achievement-toast';
    el.setAttribute('aria-label',
      (opts.kind || 'achievement') + ': ' + (opts.title || opts.label || AT_DEFAULT_LABEL));
    el.setAttribute('data-show', 'false');
    const badge = document.createElement('div');
    badge.className = 'at-badge';
    badge.textContent = opts.badge || AT_BADGE;
    const body = document.createElement('div');
    body.className = 'at-body';
    const title = document.createElement('div');
    title.className = 'at-title';
    title.textContent = opts.title || AT_DEFAULT_LABEL;
    body.appendChild(title);
    if (opts.sub) {
      const sub = document.createElement('div');
      sub.className = 'at-sub';
      sub.textContent = opts.sub;
      body.appendChild(sub);
    }
    el.appendChild(badge);
    el.appendChild(body);
    return el;
  }

  function dismissOldest() {
    const first = stack.firstElementChild;
    if (first) {
      first.setAttribute('data-show', 'false');
      setTimeout(function(){ if (first.parentNode) first.parentNode.removeChild(first); }, 240);
    }
  }

  function show(opts) {
    if (stack.children.length >= AT_MAX_QUEUE) dismissOldest();
    const el = makeToast(opts);
    stack.appendChild(el);
    requestAnimationFrame(function(){ el.setAttribute('data-show', 'true'); });
    const dismissTimer = setTimeout(function(){
      el.setAttribute('data-show', 'false');
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 240);
      if (typeof HookBus.emit === 'function') {
        HookBus.emit('onAchievementToastDismissed', {
          kind: opts.kind || 'achievement', label: opts.title || opts.label || '',
          reason: 'timeout',
        });
      }
    }, AT_VISIBLE_MS);
    el.addEventListener('click', function(){
      clearTimeout(dismissTimer);
      el.setAttribute('data-show', 'false');
      setTimeout(function(){ if (el.parentNode) el.parentNode.removeChild(el); }, 240);
      if (typeof HookBus.emit === 'function') {
        HookBus.emit('onAchievementToastDismissed', {
          kind: opts.kind || 'achievement', label: opts.title || opts.label || '',
          reason: 'click',
        });
      }
    });
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onAchievementToastShown', {
        kind: opts.kind || 'achievement', label: opts.title || opts.label || '',
      });
    }
  }

  HookBus.on('onPlayerLevelUp', function(payload){
    if (!payload || !Number.isFinite(payload.newLevel)) return;
    show({
      kind: 'level_up',
      title: 'LEVEL ' + payload.newLevel,
      sub: rewardText(payload.reward),
    });
  });
  (typeof HookBus !== 'undefined' && typeof HookBus.on === 'function' ? HookBus.on('onAchievementUnlocked', function(payload){
    if (!payload) return;
    show({
      kind: 'achievement',
      title: String(payload.title || payload.label || 'ACHIEVEMENT'),
      sub: String(payload.sub || ''),
      badge: payload.badge,
    });
  }) : void 0);

  document.addEventListener('keydown', function(e){
    if (e.key === 'Escape' && stack.children.length > 0) {
      e.preventDefault(); dismissOldest();
    }
  });
})();
`;
}
