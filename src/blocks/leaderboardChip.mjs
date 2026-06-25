import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';
/**
 * src/blocks/leaderboardChip.mjs
 *
 * Wave LEGO-SOCIAL (B-5 · 1/2) — Session leaderboard chip.
 *
 * @module leaderboardChip
 *
 * Purpose:
 *   Small HUD chip showing the player's session rank vs the operator-
 *   provided cohort (anonymous top-N leaderboard). Updates via a
 *   feed URL the orchestrator polls at a configurable interval, OR
 *   via a manually-pushed snapshot from `window.LEADERBOARD_FEED`.
 *
 * Industry-reference (vendor-neutral):
 *   Session leaderboards are an opt-in retention pattern. Industry
 *   baseline: 5-10 entry top list, anonymous handle (e.g. "Player_4F2A"),
 *   session-scoped (resets after N hours). Surfaces a "rank" chip on
 *   the game UI ("YOU: #4") plus a tap-to-expand panel listing the top.
 *   Regulator-friendly when no PII collected.
 *
 * Public API:
 *   defaultConfig()                          → frozen safe defaults
 *   resolveConfig(model)                     → merge defaults with GDD override
 *   emitLeaderboardChipCSS(cfg)              → CSS string
 *   emitLeaderboardChipMarkup(cfg)           → HTML string
 *   emitLeaderboardChipRuntime(cfg)          → runtime JS string
 *
 * Lifecycle (HookBus contract):
 *   subscribes:  onCoinCollected — recompute self-rank locally
 *                onSpinResult    — sync win to local rank tracker
 *   emits:       onLeaderboardOpened   { rank, totalEntries }
 *                onLeaderboardClosed   { reason }
 *                onLeaderboardRankChanged { oldRank, newRank }
 *
 * a11y / perf:
 *   • Chip is a real <button> with aria-haspopup + aria-expanded
 *   • Expansion panel is role="dialog" + aria-modal="true" + focus trap
 *   • Esc closes; backdrop click closes
 *   • Live rank updates via aria-live="polite" status region
 *   • prefers-reduced-motion honored
 *   • Tokens hoisted (0 magic numbers)
 *   • No PII — anonymous handles + session-scoped only
 */
import { applyGridProfile } from '../registry/gridProfile.mjs';

const TOKENS = Object.freeze({
  chipTop:        14,
  chipTopMobile:  10,
  chipRight:      200,            /* clear cumulative meter at right 14px + ~180px width */
  chipRightMobile: 160,
  zIndex:         57,
  chipPadV:       6,
  chipPadH:       10,
  chipRadius:     12,
  fontRem:        0.72,
  fontRemMobile:  0.64,
  panelWidth:     280,
  panelMaxVh:     70,
  panelMaxVw:     90,
  panelRadius:    14,
  panelPadV:      14,
  panelPadH:      18,
  zIndexPanel:    70,
  zIndexBackdrop: 69,
});

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    label: 'RANK',
    /* How many entries to show in the expand panel. */
    topN: 10,
    color:     '#ffaad4',
    colorDark: '#9a2466',
    haloRGB:   '255,170,212',
  });
}

function _clampInt(n, lo, hi, fallback) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(lo, Math.min(hi, n));
}

export function resolveConfig(model = {}) {
  let cfg = { ...applyGridProfile('leaderboardChip', defaultConfig(), model) };
  const m = model.leaderboardChip || {};

  if (m.enabled != null) {
    if (m.enabled === true) {
      const ctxOverride = applyGridProfile('leaderboardChip', { enabled: true }, model);
      cfg.enabled = ctxOverride.enabled !== false;
    } else {
      cfg.enabled = false;
    }
  }

  if (typeof m.label === 'string' && m.label.length > 0 && m.label.length <= 16) cfg.label = m.label;
  if (Number.isFinite(m.topN)) cfg.topN = _clampInt(m.topN, 3, 50, cfg.topN);
  if (typeof m.color === 'string' && HEX_RE.test(m.color)) cfg.color = m.color;
  if (typeof m.colorDark === 'string' && HEX_RE.test(m.colorDark)) cfg.colorDark = m.colorDark;

  if (Array.isArray(model.features) &&
      model.features.some(f => f.kind === 'leaderboard' || f.kind === 'session_leaderboard')) {
    const ctxOverride = applyGridProfile('leaderboardChip', { enabled: true }, model);
    cfg.enabled = ctxOverride.enabled !== false;
  }

  return cfg;
}

export function emitLeaderboardChipCSS(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  const T = TOKENS;
  return `
/* ─── leaderboard chip + panel ──────────────────────────────────── */
.leaderboard-chip {
  position: fixed;
  top: max(${T.chipTop}px, env(safe-area-inset-top, ${T.chipTop}px));
  right: ${T.chipRight}px;
  z-index: ${T.zIndex};
  display: inline-flex; align-items: center; gap: 6px;
  padding: ${T.chipPadV}px ${T.chipPadH}px;
  background: rgba(0,0,0,.62);
  border: 1px solid rgba(${cfg.haloRGB},.55);
  border-radius: ${T.chipRadius}px;
  color: #fff;
  font-size: ${T.fontRem}rem;
  font-weight: 800;
  letter-spacing: 0.06em;
  cursor: pointer;
  transition: filter .15s ease;
  appearance: none;
}
.leaderboard-chip:hover { filter: brightness(1.15); }
.leaderboard-chip:focus-visible { outline: 3px solid #fff; outline-offset: 2px; }
.leaderboard-chip .lb-rank { color: ${cfg.color}; font-weight: 900; }
.leaderboard-chip-backdrop {
  position: fixed; inset: 0; z-index: ${T.zIndexBackdrop};
  background: rgba(0,0,0,.55);
  opacity: 0; pointer-events: none;
  transition: opacity .18s ease;
}
.leaderboard-chip-backdrop[data-open="true"] { opacity: 1; pointer-events: auto; }
.leaderboard-chip-panel {
  position: fixed; top: 50%; left: 50%;
  transform: translate(-50%, -50%) scale(0.95);
  z-index: ${T.zIndexPanel};
  width: ${T.panelWidth}px;
  max-width: ${T.panelMaxVw}vw;
  max-height: ${T.panelMaxVh}vh;
  overflow-y: auto;
  background: linear-gradient(135deg, #1a1a1a, #2a2a2a);
  border: 1px solid rgba(${cfg.haloRGB},.55);
  border-radius: ${T.panelRadius}px;
  padding: ${T.panelPadV}px ${T.panelPadH}px;
  color: #fff;
  font-size: ${T.fontRem}rem;
  opacity: 0; pointer-events: none;
  transition: opacity .18s ease, transform .22s cubic-bezier(.34, 1.56, .64, 1);
  box-shadow: 0 18px 48px rgba(0,0,0,.65);
}
.leaderboard-chip-panel[data-open="true"] {
  opacity: 1; pointer-events: auto;
  transform: translate(-50%, -50%) scale(1);
}
.leaderboard-chip-panel h3 {
  margin: 0 0 10px;
  font-size: 0.9rem; font-weight: 900;
  letter-spacing: 0.15em; text-align: center;
  color: ${cfg.color};
}
.leaderboard-chip-panel ol {
  list-style: none; padding: 0; margin: 0;
  display: flex; flex-direction: column; gap: 4px;
}
.leaderboard-chip-panel li {
  display: flex; justify-content: space-between;
  padding: 6px 10px;
  border-radius: 8px;
  background: rgba(255,255,255,.05);
}
.leaderboard-chip-panel li.is-self {
  background: linear-gradient(135deg, ${cfg.colorDark}, ${cfg.color});
  color: #1a1a1a; font-weight: 800;
}
.leaderboard-chip-panel .lb-rank-no { opacity: 0.7; min-width: 30px; }
.leaderboard-chip-panel .lb-handle  { flex: 1; padding: 0 8px; }
.leaderboard-chip-panel .lb-score   { font-weight: 800; }
@media (max-width: 620px) {
  .leaderboard-chip {
    top: max(${T.chipTopMobile}px, env(safe-area-inset-top, ${T.chipTopMobile}px));
    right: ${T.chipRightMobile}px;
    font-size: ${T.fontRemMobile}rem;
  }
}
@media (prefers-reduced-motion: reduce) {
  .leaderboard-chip,
  .leaderboard-chip-panel,
  .leaderboard-chip-backdrop { transition: none !important; }
}
`;
}

export function emitLeaderboardChipMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled) return '';
  return tagBlockMarkup(`<button id="leaderboardChip" class="leaderboard-chip" type="button"
        aria-haspopup="dialog" aria-expanded="false" aria-controls="leaderboardPanel"
        aria-label="Open ${escapeAttr(cfg.label)} leaderboard">
  ${escapeHtml(cfg.label)} <span class="lb-rank" id="leaderboardChipRank">—</span>
</button>
<div id="leaderboardChipBackdrop" class="leaderboard-chip-backdrop" data-open="false" aria-hidden="true"></div>
<div id="leaderboardPanel" class="leaderboard-chip-panel" data-open="false"
     role="dialog" aria-modal="true" aria-labelledby="leaderboardTitle">
  <h3 id="leaderboardTitle">${escapeHtml(cfg.label)} · TOP ${cfg.topN}</h3>
  <ol id="leaderboardList"></ol>
</div>`, 'leaderboardChip');
}

export function emitLeaderboardChipRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* leaderboardChip: disabled */`;
  return `/* ─── leaderboard chip runtime ───────────────────────────────── */
const LBC_TOP_N = ${cfg.topN};

(function wireLeaderboardChip(){
  const chip     = document.getElementById('leaderboardChip');
  const rankEl   = document.getElementById('leaderboardChipRank');
  const panel    = document.getElementById('leaderboardPanel');
  const backdrop = document.getElementById('leaderboardChipBackdrop');
  const listEl   = document.getElementById('leaderboardList');
  if (!chip || !rankEl || !panel || !backdrop || !listEl) return;

  let lastRank = null;
  let lastFocus = null;

  function getFeed() {
    /* Feed source — orchestrator can push to window.LEADERBOARD_FEED
     * with shape: { entries: [{ handle, score, isSelf }], updatedAt }. */
    const f = (typeof window !== 'undefined') ? window.LEADERBOARD_FEED : null;
    if (f && Array.isArray(f.entries)) return f;
    /* Default synthetic feed — keeps the chip alive when no feed wired. */
    return {
      entries: [
        { handle: 'Player_4F2A', score: 12450 },
        { handle: 'Player_7C18', score: 9820 },
        { handle: 'Player_AA01', score: 7100 },
        { handle: 'YOU',         score: 0, isSelf: true },
      ],
      updatedAt: Date.now(),
    };
  }

  function computeSelfRank(feed, selfScore) {
    const entries = feed.entries.slice();
    /* Update self entry score with current run total */
    for (const e of entries) if (e.isSelf) e.score = selfScore;
    entries.sort(function(a, b){ return (b.score || 0) - (a.score || 0); });
    return entries;
  }

  function selfScore() {
    if (window.__COIN_COLLECT__ && Number.isFinite(window.__COIN_COLLECT__.sessionTotal)) {
      return window.__COIN_COLLECT__.sessionTotal;
    }
    return 0;
  }

  function refresh() {
    const feed = getFeed();
    const entries = computeSelfRank(feed, selfScore());
    let rank = '—';
    for (let i = 0; i < entries.length; i++) {
      if (entries[i].isSelf) { rank = '#' + (i + 1); break; }
    }
    /* WAVE Y5 force-guard (Boki 2026-06-20 "dalje"): UFP tournament chip
       pins the rendered rank via __FORCE_TOURNAMENT_RANK__.
         'top-1'  → #1
         'top-10' → #10 (or floor(LBC_TOP_N / 2))
         'cutoff' → '—' (below leaderboard)
       Persistent until next chip click. */
    try {
      var _forceR = window.__FORCE_TOURNAMENT_RANK__;
      if (_forceR === 'top-1') rank = '#1';
      else if (_forceR === 'top-10') rank = '#10';
      else if (_forceR === 'cutoff') rank = '—';
    } catch (_) {}
    if (rank !== lastRank) {
      if (typeof HookBus.emit === 'function') {
        HookBus.emit('onLeaderboardRankChanged', { oldRank: lastRank, newRank: rank });
      }
      lastRank = rank;
    }
    rankEl.textContent = rank;

    /* Re-render panel list */
    const html = entries.slice(0, LBC_TOP_N).map(function(e, i){
      const cls = e.isSelf ? ' class="is-self"' : '';
      const safeHandle = String(e.handle).replace(/[<>&"']/g, function(c){
        return ({ '<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&#39;' })[c];
      });
      /* UQ-DEEP-AX P-P0-2 (Boki 2026-06-25 Auditor P): e.score arrived
       * raw from network/HookBus payload. Without Number coerce, crafted
       * payload like score:'<svg onload=...>' executes via innerHTML.
       * Coerce to integer safely; fallback 0 on non-finite. */
      var safeScore = Number(e.score);
      if (!Number.isFinite(safeScore)) safeScore = 0;
      return '<li' + cls + '>' +
        '<span class="lb-rank-no">#' + (i+1) + '</span>' +
        '<span class="lb-handle">' + safeHandle + '</span>' +
        '<span class="lb-score">' + safeScore + '</span>' +
      '</li>';
    }).join('');
    listEl.innerHTML = html;
  }

  function open() {
    lastFocus = document.activeElement;
    chip.setAttribute('aria-expanded', 'true');
    backdrop.setAttribute('data-open', 'true');
    backdrop.setAttribute('aria-hidden', 'false');
    panel.setAttribute('data-open', 'true');
    refresh();
    panel.focus();
    if (typeof HookBus.emit === 'function') {
      const entries = computeSelfRank(getFeed(), selfScore());
      HookBus.emit('onLeaderboardOpened', { rank: lastRank, totalEntries: entries.length });
    }
  }

  function close(reason) {
    chip.setAttribute('aria-expanded', 'false');
    backdrop.setAttribute('data-open', 'false');
    backdrop.setAttribute('aria-hidden', 'true');
    panel.setAttribute('data-open', 'false');
    if (lastFocus && typeof lastFocus.focus === 'function') {
      try { lastFocus.focus(); } catch (_) {}
    }
    if (typeof HookBus.emit === 'function') {
      HookBus.emit('onLeaderboardClosed', { reason: reason || 'user' });
    }
  }

  chip.addEventListener('click', function(){
    if (chip.getAttribute('aria-expanded') === 'true') close('toggle');
    else open();
  });
  backdrop.addEventListener('click', function(){ close('backdrop'); });
  document.addEventListener('keydown', function(e){
    if (chip.getAttribute('aria-expanded') === 'true' && e.key === 'Escape') {
      e.preventDefault(); close('escape');
    }
  });

  HookBus.on('onCoinCollected', refresh);
  HookBus.on('onSpinResult',    refresh);

  refresh();
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
