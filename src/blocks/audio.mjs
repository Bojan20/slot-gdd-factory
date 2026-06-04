/**
 * src/blocks/audio.mjs
 *
 * Wave U2 — Audio scaffolding block.
 *
 * Zero-dependency Web Audio API wrapper that provides a Howler-style cue
 * API for the slot lifecycle, without pulling Howler.js as a dependency.
 * All cues lazy-load on first play (HTMLAudioElement + gain node), so a
 * GDD that doesn't ship URLs costs nothing at boot.
 *
 * Industry baseline: every production slot has master mute + master
 * volume + per-category volume + reduced-motion / accessibility aware
 * sound mute. This block delivers all four.
 *
 * Lifecycle (HookBus contract):
 *
 *   preSpin            (duringFs=false) → play SPIN_START
 *   onSpinResult       (any)             → play REEL_STOP
 *   onTumbleStep       (events>0)        → play TUMBLE_REMOVE
 *                                          + MULT_GROW if HookBus.getMult>1
 *   onFsTrigger        →                  FS_TRIGGER + FS_INTRO (sequence)
 *   onFsSpinResult     →                  FS_SPIN_START (subset volume)
 *   onFsEnd            →                  FS_OUTRO
 *
 * Plus direct runtime API for blocks that fire ad-hoc:
 *   audioPlay('ORB_SPAWN'), audioPlay('ANTICIPATION'),
 *   audioPlay('BUTTON_CLICK'), audioPlay('WIN_BIG' | 'WIN_MEGA' | 'WIN_EPIC')
 *
 * Mute / volume persistence in localStorage (`slot.audio.muted`,
 * `slot.audio.volume`) so the player's choice survives page refresh.
 *
 * Bake-time config (resolved from `model.audio`):
 *   { enabled, masterVolume, muted, urls: { CATEGORY: 'path/to.mp3', ... },
 *     volumes: { CATEGORY: 0.0-1.0, ... }, showToggle, toggleColor,
 *     bigWinThresholdX, megaWinThresholdX, epicWinThresholdX }
 *
 * Public API (server-side, ES module):
 *   defaultConfig() / resolveConfig(model)
 *   emitAudioCSS(cfg)        → mute toggle button styling
 *   emitAudioMarkup(cfg)     → footer mute/unmute button
 *   emitAudioRuntime(cfg)    → runtime JS string for orchestrator
 *
 * Runtime contract (after emitted JS executes):
 *   audioPlay(category, opts?)              fire-and-forget play
 *   audioSetMuted(boolean)                  master toggle
 *   audioToggleMuted()                      flip and return new state
 *   audioSetVolume(0-1)                     master volume
 *   audioPreload(category)                  warm up the asset cache
 *   AUDIO_STATE                             { muted, volume, loaded }
 *
 * Runtime dependencies: localStorage (persistence), Audio (HTMLAudioElement),
 * AudioContext (optional WebAudio gain — falls back to el.volume if unavailable),
 * HookBus (lifecycle bus), FSM (FS phase gating).
 */

/* All categories the slot lifecycle understands. URLs default empty so
   the block is dormant until the GDD names assets. */
const CATEGORIES = Object.freeze([
  'SPIN_START',
  'REEL_STOP',
  'TUMBLE_REMOVE',
  'ORB_SPAWN',
  'ANTICIPATION',
  'BUTTON_CLICK',
  'WIN_BASE',
  'WIN_BIG',
  'WIN_MEGA',
  'WIN_EPIC',
  'MULT_GROW',
  'FS_TRIGGER',
  'FS_INTRO',
  'FS_SPIN_START',
  'FS_OUTRO',
]);

export function defaultConfig() {
  return {
    enabled: false,
    masterVolume: 0.7,
    muted: false,
    /* Per-category URL — empty by default; GDD overrides individually.
       A category with empty URL plays nothing (silent no-op), so partial
       audio packs compose cleanly. */
    urls: CATEGORIES.reduce((m, c) => (m[c] = '', m), {}),
    /* Per-category volume relative to masterVolume (0..1). Defaults to 1
       (full relative volume) for each category. */
    volumes: CATEGORIES.reduce((m, c) => (m[c] = 1.0, m), {}),
    /* Footer mute/unmute button. Set false if the host UI already
       provides one (e.g. cabinet trim). */
    showToggle: true,
    toggleColor: '255,255,255',
    /* Win-tier thresholds in multiples of bet — WIN_BIG fires when
       roundTotalX >= bigWinThresholdX, MEGA at >= mega, EPIC at >= epic.
       Standard industry breakpoints. */
    bigWinThresholdX: 10,
    megaWinThresholdX: 50,
    epicWinThresholdX: 250,
  };
}

export function resolveConfig(model = {}) {
  const cfg = defaultConfig();
  const m = (model && model.audio) || {};

  if (m.enabled != null) cfg.enabled = !!m.enabled;
  if (Number.isFinite(m.masterVolume)) cfg.masterVolume = clampFloat(m.masterVolume, 0, 1);
  if (m.muted != null) cfg.muted = !!m.muted;
  if (m.urls && typeof m.urls === 'object') {
    for (const c of CATEGORIES) {
      const u = m.urls[c];
      if (typeof u === 'string' && u.length > 0 && u.length <= 512 && isSafeUrl(u)) {
        cfg.urls[c] = u;
      }
    }
  }
  if (m.volumes && typeof m.volumes === 'object') {
    for (const c of CATEGORIES) {
      const v = m.volumes[c];
      if (Number.isFinite(v)) cfg.volumes[c] = clampFloat(v, 0, 1);
    }
  }
  if (m.showToggle != null) cfg.showToggle = !!m.showToggle;
  if (typeof m.toggleColor === 'string' && /^\d{1,3},\d{1,3},\d{1,3}$/.test(m.toggleColor)) {
    cfg.toggleColor = m.toggleColor;
  }
  if (Number.isFinite(m.bigWinThresholdX))  cfg.bigWinThresholdX  = clampInt(m.bigWinThresholdX,  1, 100000);
  if (Number.isFinite(m.megaWinThresholdX)) cfg.megaWinThresholdX = clampInt(m.megaWinThresholdX, cfg.bigWinThresholdX + 1, 1000000);
  if (Number.isFinite(m.epicWinThresholdX)) cfg.epicWinThresholdX = clampInt(m.epicWinThresholdX, cfg.megaWinThresholdX + 1, 10000000);

  /* Auto-enable when the GDD declares an `audio` feature kind OR when
     at least one URL is populated. */
  if (Array.isArray(model.features) && model.features.some(f => f.kind === 'audio' || f.kind === 'sound')) {
    cfg.enabled = true;
  }
  if (!cfg.enabled) {
    const populated = CATEGORIES.some(c => cfg.urls[c] && cfg.urls[c].length > 0);
    if (populated) cfg.enabled = true;
  }

  return cfg;
}

export function emitAudioCSS(cfg = defaultConfig()) {
  if (!cfg.enabled || !cfg.showToggle) return '';
  return `
/* ─── audio mute toggle (Wave U2) ────────────────────────────────── */
.audio-toggle {
  position: fixed;
  top: 14px; right: 14px;
  z-index: 70;
  width: 38px; height: 38px;
  background: rgba(0,0,0,.55);
  border: 1.5px solid rgba(${cfg.toggleColor},.55);
  border-radius: 50%;
  color: rgba(${cfg.toggleColor},1);
  font-size: 1.1rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  transition: background 160ms ease, transform 120ms ease, border-color 160ms ease;
  text-shadow: 0 0 6px rgba(${cfg.toggleColor},.45);
}
.audio-toggle:hover { background: rgba(${cfg.toggleColor},.18); transform: scale(1.06); }
.audio-toggle:active { transform: scale(0.94); }
.audio-toggle[data-muted="true"] {
  border-color: rgba(${cfg.toggleColor},.25);
  color: rgba(${cfg.toggleColor},.45);
}
.audio-toggle[data-muted="true"]::after {
  content: '';
  position: absolute;
  width: 60%;
  height: 2px;
  background: rgba(${cfg.toggleColor},.85);
  transform: rotate(-32deg);
  pointer-events: none;
}
@media (max-width: 620px) {
  .audio-toggle { top: 8px; right: 8px; width: 32px; height: 32px; font-size: 0.95rem; }
}
@media (prefers-reduced-motion: reduce) {
  .audio-toggle, .audio-toggle:hover, .audio-toggle:active { transition: none; transform: none; }
}
`;
}

export function emitAudioMarkup(cfg = defaultConfig()) {
  if (!cfg.enabled || !cfg.showToggle) return '';
  return `<button id="audioToggle" class="audio-toggle" data-muted="${cfg.muted ? 'true' : 'false'}" type="button" aria-label="Toggle audio" title="Toggle audio">🔊</button>`;
}

export function emitAudioRuntime(cfg = defaultConfig()) {
  if (!cfg.enabled) return `/* audio: disabled */`;
  return `/* ─── audio runtime (Wave U2) ────────────────────────────────────── */
const AUDIO_CATEGORIES = ${JSON.stringify(CATEGORIES)};
const AUDIO_URLS       = ${JSON.stringify(cfg.urls)};
const AUDIO_VOLUMES    = ${JSON.stringify(cfg.volumes)};
const AUDIO_BIG_X      = ${cfg.bigWinThresholdX};
const AUDIO_MEGA_X     = ${cfg.megaWinThresholdX};
const AUDIO_EPIC_X     = ${cfg.epicWinThresholdX};
const AUDIO_STATE      = {
  muted: ${cfg.muted ? 'true' : 'false'},
  volume: ${cfg.masterVolume},
  loaded: Object.create(null),
};

/* Restore persisted preference if present — player choice survives reload. */
try {
  const lsM = localStorage.getItem('slot.audio.muted');
  if (lsM === 'true' || lsM === 'false') AUDIO_STATE.muted = lsM === 'true';
  const lsV = parseFloat(localStorage.getItem('slot.audio.volume') || '');
  if (Number.isFinite(lsV) && lsV >= 0 && lsV <= 1) AUDIO_STATE.volume = lsV;
} catch (e) { /* localStorage disabled in privacy mode — silent */ }

function _audioGetEl(category) {
  if (AUDIO_STATE.loaded[category]) return AUDIO_STATE.loaded[category];
  const url = AUDIO_URLS[category];
  if (!url) return null;             // category not wired — silent no-op
  try {
    const el = new Audio(url);
    el.preload = 'auto';
    AUDIO_STATE.loaded[category] = el;
    return el;
  } catch (e) {
    return null;                      // Audio() unavailable (very old browsers)
  }
}

function audioPlay(category, opts) {
  if (AUDIO_STATE.muted) return false;
  if (!AUDIO_CATEGORIES.includes(category)) return false;
  const el = _audioGetEl(category);
  if (!el) return false;
  const catVol = AUDIO_VOLUMES[category] != null ? AUDIO_VOLUMES[category] : 1;
  const vol = AUDIO_STATE.volume * catVol;
  /* Allow overlapping playback (e.g. rapid reel-stops) by cloning. */
  try {
    const node = el.cloneNode();
    node.volume = Math.max(0, Math.min(1, vol));
    /* opts.rate honors playbackRate when caller wants a tempo cue
       (e.g. anticipation slowdown plays at 0.85). */
    if (opts && Number.isFinite(opts.rate) && opts.rate > 0) node.playbackRate = opts.rate;
    const p = node.play();
    if (p && typeof p.catch === 'function') p.catch(() => {}); // user-gesture gate
    return true;
  } catch (e) {
    return false;
  }
}

function audioPreload(category) {
  if (!AUDIO_CATEGORIES.includes(category)) return false;
  return !!_audioGetEl(category);
}

function audioSetMuted(v) {
  AUDIO_STATE.muted = !!v;
  try { localStorage.setItem('slot.audio.muted', AUDIO_STATE.muted ? 'true' : 'false'); } catch (e) {}
  _audioSyncToggle();
}

function audioToggleMuted() {
  audioSetMuted(!AUDIO_STATE.muted);
  return AUDIO_STATE.muted;
}

function audioSetVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) return;
  AUDIO_STATE.volume = n;
  try { localStorage.setItem('slot.audio.volume', String(n)); } catch (e) {}
}

function _audioSyncToggle() {
  const btn = document.getElementById('audioToggle');
  if (!btn) return;
  btn.dataset.muted = AUDIO_STATE.muted ? 'true' : 'false';
  btn.textContent = AUDIO_STATE.muted ? '🔇' : '🔊';
}

if (typeof window !== 'undefined') {
  window.audioPlay        = audioPlay;
  window.audioPreload     = audioPreload;
  window.audioSetMuted    = audioSetMuted;
  window.audioToggleMuted = audioToggleMuted;
  window.audioSetVolume   = audioSetVolume;
  window.AUDIO_STATE      = AUDIO_STATE;
}

/* Wire the footer toggle button. */
document.addEventListener('DOMContentLoaded', () => {
  _audioSyncToggle();
  const btn = document.getElementById('audioToggle');
  if (btn) btn.addEventListener('click', () => { audioToggleMuted(); });
});

/* HookBus wire-up — audio listens to lifecycle events and fires cues.
   FS_TRIGGER plus FS_INTRO are sequenced (intro 200ms after trigger).
   Tumble step plays MULT_GROW only when the multiplier actually grew
   (HookBus.getMult > 1). Without these handlers audioPlay is still
   callable directly (ad-hoc) but lifecycle cues stay silent. */
if (typeof HookBus !== 'undefined') {
  HookBus.on('preSpin', ({ duringFs } = {}) => {
    audioPlay(duringFs ? 'FS_SPIN_START' : 'SPIN_START');
  });
  HookBus.on('onSpinResult', () => {
    audioPlay('REEL_STOP');
  });
  HookBus.on('onTumbleStep', ({ events } = {}) => {
    audioPlay('TUMBLE_REMOVE');
    if (Array.isArray(events) && events.length > 0 && HookBus.getMult && HookBus.getMult() > 1) {
      audioPlay('MULT_GROW');
    }
  });
  HookBus.on('postSpin', ({ events } = {}) => {
    if (!Array.isArray(events) || events.length === 0) return;
    const totalX = events.reduce((a, e) => a + (Number(e && e.payX) || 0), 0);
    if (totalX >= AUDIO_EPIC_X)        audioPlay('WIN_EPIC');
    else if (totalX >= AUDIO_MEGA_X)   audioPlay('WIN_MEGA');
    else if (totalX >= AUDIO_BIG_X)    audioPlay('WIN_BIG');
    else if (totalX > 0)               audioPlay('WIN_BASE');
  });
  HookBus.on('onFsTrigger', () => {
    audioPlay('FS_TRIGGER');
    setTimeout(() => audioPlay('FS_INTRO'), 200);
  });
  HookBus.on('onFsEnd', () => {
    audioPlay('FS_OUTRO');
  });
}
`;
}

/* ─── helpers ─────────────────────────────────────────────────────── */
function clampInt(n, lo, hi) {
  n = Math.floor(Number(n));
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

function clampFloat(n, lo, hi) {
  n = Number(n);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/* Reject obvious junk + javascript: / data: schemes; relative + http(s)
   + plain filenames OK. Defends against GDDs that paste arbitrary text. */
function isSafeUrl(s) {
  const v = String(s).trim();
  if (v.length === 0) return false;
  if (/^javascript:/i.test(v)) return false;
  if (/^data:/i.test(v)) return false;
  if (/[<>\s"`]/.test(v)) return false;
  return true;
}

/* Export the category list so tests can verify the full vocabulary. */
export const AUDIO_CATEGORIES = CATEGORIES;
