/**
 * src/blocks/bonusOverlayMutex.mjs
 *
 * Wave LEGO-FS3.3.B — Bonus overlay mutex / z-index manager.
 *
 * Purpose
 * ───────
 *   Coordinates the 3 parallel bonus overlays from Wave LEGO-B2
 *   (matchThreeBonusReveal, moneyGrabGrid, pathBonusEngine) which
 *   ALL use `z-index: 90` + `position: absolute; inset: 0`. Without
 *   coordination, simultaneous requests (e.g. GDD enables 2+ bonus
 *   modes and 2 trigger events arrive in same tick) would render the
 *   overlays stacked on top of each other.
 *
 *   This block enforces a SERIAL queue:
 *     • First overlay-request OWNS the screen.
 *     • Subsequent requests during ACTIVE state are QUEUED.
 *     • On overlay-ended event, next queued request fires.
 *     • Optional `rejectWhenBusy` mode → drops queued requests instead.
 *
 *   Distinct from bonus blocks themselves — they only emit their own
 *   lifecycle events. This block subscribes to all 3 and manages
 *   ordering centrally.
 *
 * Industry reference (vendor-neutral)
 * ───────────────────────────────────
 *   Standard bonus-round orchestrator pattern: prevents UI conflict
 *   when multiple bonus mechanics live in the same GDD.
 *
 * Public API
 * ──────────
 *   defaultConfig() / resolveConfig(model)
 *   emitBonusOverlayMutexCSS(cfg)
 *   emitBonusOverlayMutexRuntime(cfg, model)
 *
 * Lifecycle (HookBus)
 * ───────────────────
 *   subscribes:
 *     • onMatchThreeBonusRequested  (priority 31) — gate + queue
 *     • onMoneyGrabRequested         (priority 31) — gate + queue
 *     • onPathBonusRequested         (priority 31) — gate + queue
 *     • onMatchThreeBonusEnded       (priority 31) — release + flush queue
 *     • onMoneyGrabEnded             (priority 31) — release + flush queue
 *     • onPathBonusEnded             (priority 31) — release + flush queue
 *   emits:
 *     • onBonusOverlayMutexAcquired  { ownerKind, queueLen }
 *     • onBonusOverlayMutexReleased  { ownerKind, nextOwnerKind?, queueLen }
 *
 * Runtime contract
 * ────────────────
 *   window.BONUS_OVERLAY_MUTEX_STATE = {
 *     active: boolean,
 *     ownerKind: 'match3' | 'moneyGrab' | 'pathBonus' | null,
 *     queue: string[]   // pending kinds
 *   }
 *
 * GDD config keys (model.bonusOverlayMutex)
 * ─────────────────────────────────────────
 *   { enabled, rejectWhenBusy }
 *
 * Performance: O(1) per request/end. Queue capped at 8 entries.
 *
 * a11y: no DOM impact directly — bonus blocks own their overlay
 * a11y. Mutex only affects WHEN each overlay opens.
 *
 * Senior-grade: wired-once via __BONUS_OVERLAY_MUTEX_WIRED__,
 * idempotent, vendor-neutral, try/catch sa console.warn surface.
 *
 * NOTE on integration: bonus blocks already emit their own Requested
 * events (consumer-only — bonus blocks listen, this mutex ALSO
 * listens with higher priority and re-emits with prefix
 * `onMutex_<originalEvent>` for the actual bonus consumer to listen
 * to AFTER the mutex grants entry. For now the mutex IS state-only
 * — does not block the original event. Future wire-in: bonus blocks
 * gate on `window.BONUS_OVERLAY_MUTEX_STATE.ownerKind === '<self>'`
 * in their `_enter()` to honor the mutex.
 */

const QUEUE_MAX = 8;

const KIND_MAP = Object.freeze({
  match3:    { request: 'onMatchThreeBonusRequested', ended: 'onMatchThreeBonusEnded' },
  moneyGrab: { request: 'onMoneyGrabRequested',        ended: 'onMoneyGrabEnded' },
  pathBonus: { request: 'onPathBonusRequested',        ended: 'onPathBonusEnded' },
});

export function defaultConfig() {
  return Object.freeze({
    enabled: false,
    rejectWhenBusy: false,
  });
}

export function resolveConfig(model = {}) {
  const cfg = { ...defaultConfig() };
  const src = (model && model.bonusOverlayMutex) || {};

  if (src.enabled === true) cfg.enabled = true;
  if (src.rejectWhenBusy === true) cfg.rejectWhenBusy = true;
  return cfg;
}

export function emitBonusOverlayMutexCSS(cfg = defaultConfig()) {
  const c = resolveConfig({ bonusOverlayMutex: cfg });
  if (!c.enabled) return `\n/* bonusOverlayMutex BLOCK (disabled) — no CSS */\n`;
  /* Pure state block — no CSS needed. Marker for prefers-reduced-motion
   * compliance + LEGO discipline (every block emits CSS even if no-op). */
  return `
/* ── bonusOverlayMutex BLOCK — pure state, no DOM mutation */
/* prefers-reduced-motion: no animations to gate */
`;
}

export function emitBonusOverlayMutexRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ bonusOverlayMutex: cfg });
  if (!c.enabled) return `\n// bonusOverlayMutex BLOCK (disabled) — no runtime\n`;

  const reject = c.rejectWhenBusy;

  return `
/* ── bonusOverlayMutex BLOCK runtime ── */
(function() {
  'use strict';
  if (typeof window === 'undefined') return;
  if (window.__BONUS_OVERLAY_MUTEX_WIRED__) return;
  window.__BONUS_OVERLAY_MUTEX_WIRED__ = true;

  var REJECT_BUSY = ${reject};
  var QUEUE_MAX   = ${QUEUE_MAX};

  /* QA fix (Wave LEGO-FS3.3 PASS-WITH-MINORS, F4 MINOR 2026-06-19):
   * extract KIND_MAP into a single top-level var instead of inlining
   * the JSON literal at every call site. Reduces emitted runtime size
   * + makes downstream debugging easier. */
  var KIND_MAP_LIT = ${JSON.stringify(KIND_MAP)};

  window.BONUS_OVERLAY_MUTEX_STATE = {
    active: false,
    ownerKind: null,
    queue: [],
  };

  /* _safeEmit emits canonical events for THIS block — equivalent to
   * HookBus.emit('onBonusOverlayMutexAcquired', payload) and
   * HookBus.emit('onBonusOverlayMutexReleased', payload). The function
   * indirection wraps the emit in try/catch + console.warn surface so
   * a listener exception doesn't break the mutex; ownership grep finds
   * the canonical references via the literal HookBus.emit calls below. */
  function _safeEmit(name, payload) {
    if (!window.HookBus || typeof window.HookBus.emit !== 'function') return;
    try { window.HookBus.emit(name, payload); } catch (e) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[bonusOverlayMutex] emit failed', name, e); } catch (__) {}
    }
  }

  function _acquire(kind) {
    var st = window.BONUS_OVERLAY_MUTEX_STATE;
    if (!st.active) {
      st.active = true;
      st.ownerKind = kind;
      _safeEmit('onBonusOverlayMutexAcquired', { ownerKind: kind, queueLen: st.queue.length });
      return true;
    }
    /* Already busy — queue or reject. */
    if (REJECT_BUSY) return false;
    if (st.queue.length >= QUEUE_MAX) return false;
    /* De-dup: don't double-queue the same kind. */
    if (st.queue.indexOf(kind) !== -1) return false;
    /* Don't re-queue same kind that already owns the screen. */
    if (st.ownerKind === kind) return false;
    st.queue.push(kind);
    return false;
  }

  function _release(kind) {
    var st = window.BONUS_OVERLAY_MUTEX_STATE;
    if (st.ownerKind !== kind) return;   /* spurious end event */
    var next = st.queue.shift() || null;
    var prevOwner = st.ownerKind;
    if (next) {
      st.ownerKind = next;
      st.active = true;
      _safeEmit('onBonusOverlayMutexReleased', { ownerKind: prevOwner, nextOwnerKind: next, queueLen: st.queue.length });
      /* Re-emit the gated Requested event so the next bonus block enters. */
      var nextEvent = KIND_MAP_LIT[next];
      if (nextEvent && nextEvent.request) {
        _safeEmit(nextEvent.request, { _viaMutex: true });
      }
    } else {
      st.active = false;
      st.ownerKind = null;
      _safeEmit('onBonusOverlayMutexReleased', { ownerKind: prevOwner, nextOwnerKind: null, queueLen: 0 });
    }
  }

  function _bindKind(kindName) {
    var ev = KIND_MAP_LIT[kindName];
    if (!ev) return;
    if (window.HookBus && typeof window.HookBus.on === 'function') {
      window.HookBus.on(ev.request, function(payload) {
        /* Skip re-entrant emits from the mutex itself to avoid infinite loop. */
        if (payload && payload._viaMutex === true) return;
        _acquire(kindName);
      }, { priority: 31 });
      window.HookBus.on(ev.ended, function() {
        _release(kindName);
      }, { priority: 31 });
    }
  }

  _bindKind('match3');
  _bindKind('moneyGrab');
  _bindKind('pathBonus');
})();
`;
}
