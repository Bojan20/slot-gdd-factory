/**
 * Slot GDD Factory · hookBus BLOCK
 *
 * THE central lifecycle bus. Every feature block registers its runtime
 * callbacks here; the spin engine (runOneBaseSpin / handlePostSpin /
 * FSM_runNextFsSpin / runTumbleChain) emits events into it. NO block ever
 * calls another block's runtime directly — they all talk through HookBus.
 *
 * This is the LEGO rule (Boki, 2026-06-04, REINFORCED): every block must
 * register on at least one of these lifecycle events, otherwise it is
 * dead code by definition.
 *
 * ─── Events ─────────────────────────────────────────────────────────
 *
 *   preSpin       ({ duringFs })
 *      Emitted right before a spin begins (button click / FS auto-spin).
 *      Use to: arm anticipation, prepare wild placements, reset per-spin
 *      counters. NEVER mutate the grid here (grid is being rebuilt).
 *
 *   onSpinResult  ({ duringFs })
 *      Emitted after reels settle but before any cascade/tumble loop.
 *      Use to: annotate special cells (orbs, mystery, super), apply
 *      sticky/expanding/walking wild visuals, fire lightning multipliers.
 *
 *   onTumbleStep  ({ duringFs, chainIndex, events })
 *      Emitted once per tumble cascade step. `events` is the win-event
 *      array detected this step. Listeners can mutate the multiplier
 *      (HookBus.setMult) or wins ledger.
 *
 *   postSpin      ({ duringFs })
 *      Emitted after the final cascade step completes (or after settle if
 *      no cascade). Use to: run win presentation, count triggers, apply
 *      cap, trigger respin/hold-and-win/bonus modes.
 *
 *   onFsTrigger   ({ award, scatters })
 *      Emitted when FS round is about to start. Use to: reset persistent
 *      counters (BONUS_MULTIPLIER, sticky wild collection, hold-and-win
 *      board, FSM.mult to 1).
 *
 *   onFsSpinResult ({ chainIndex })
 *      Emitted after every FS spin settles (before tumble starts). This
 *      is where blocks that ESCALATE on every FS spin (progressive mult,
 *      persistent multiplier, multiplier-orb-bonus-accumulate) bump.
 *
 *   onFsEnd       ({ totalWin })
 *      Emitted as FS round closes (FSM_enterOutro path). Listeners reset
 *      persistent state so next FS round starts clean.
 *
 *   ─── Wave V: spin-control intent events ───────────────────────────
 *
 *   onSlamRequested  ({ phase: 'pre' | 'post', source: 'button' | 'reelsArea' | 'keyboard' })
 *      Emitted when the player asks reels to stop NOW (slam-stop button
 *      or click-on-reels area). `phase` distinguishes pre-response
 *      (server result not yet received → engine must wait via HookBus.once
 *      for onSpinResult, then collapse all reels to landed strip) from
 *      post-response (result received → engine collapses immediately).
 *      Owner: src/blocks/slamStop.mjs (emit). Consumers: reelEngine.mjs.
 *
 *   onSlamComplete   ({ duration: number })
 *      Emitted by reelEngine.mjs after all reels have visually collapsed
 *      into their final landed positions following a slam request.
 *      `duration` = ms elapsed from onSlamRequested to all-reels-stopped.
 *      Owner: src/blocks/reelEngine.mjs. Consumers: postSpin coordinator
 *      (transitions UI state out of slam phase), audio cues (future ADB).
 *
 *   onSkipRequested  ({ phase: 'rollup' | 'fsIntro' | 'fsOutro' | 'celebration', source: 'button' | 'keyboard' })
 *      Emitted when the player asks the current win-presentation /
 *      transition animation to terminate immediately. `phase` lets each
 *      listener decide whether it owns the cancellable animation.
 *      Sets a global `window.__SLOT_SKIPPED__ = true` flag; long-running
 *      animation chains poll this flag at every setTimeout step and bail
 *      to final state when set. Owner: src/blocks/forceSkip.mjs (emit).
 *      Consumers: winPresentation.mjs, scatterCelebration.mjs, freeSpins.mjs.
 *
 *   onSkipComplete   ({ phase: string, duration: number })
 *      Emitted by whichever block owns the animation that was skipped,
 *      after it has fully collapsed to its final state. Resets
 *      `window.__SLOT_SKIPPED__` to false. Owner: animation-owning block.
 *      Consumers: postSpin coordinator (re-enables spin button).
 *
 * ─── Shared state ──────────────────────────────────────────────────
 *
 *   HookBus.getMult() / HookBus.setMult(v) / HookBus.addMult(delta)
 *      The CURRENT effective payout multiplier. Set by listeners during
 *      onSpinResult / onTumbleStep / onFsSpinResult. Read by win-payout
 *      dispatcher (winPresentation) when computing event.payX.
 *
 *   HookBus.getMult() is the single source of truth — never read FSM.mult
 *   or BONUS_MULTIPLIER directly from non-HookBus consumers.
 *
 * GDD-driven configuration (consumed from `model.hookBus`):
 *   debugLog   boolean — log every event to console            (default false)
 *
 * Public API:
 *   defaultConfig() / resolveConfig(model)
 *   emitHookBusRuntime(cfg) → runtime JS string
 */

const DEFAULTS = Object.freeze({
  debugLog: false,
});

export function defaultConfig() {
  return { ...DEFAULTS };
}

export function resolveConfig(model) {
  const cfg = defaultConfig();
  const src = (model && model.hookBus) || {};
  if (src.debugLog === true) cfg.debugLog = true;
  return cfg;
}

export const HOOK_EVENTS = Object.freeze([
  /* Wave A → S: core spin lifecycle */
  'preSpin',
  'onSpinResult',
  'onTumbleStep',
  'postSpin',
  'onFsTrigger',
  'onFsSpinResult',
  'onFsEnd',
  /* Wave V: spin-control intent events (slam-stop + force-skip) */
  'onSlamRequested',
  'onSlamComplete',
  'onSkipRequested',
  'onSkipComplete',
]);

/* Wave V: phase enums for slam/skip payloads — exported so blocks can
 * import the canonical strings instead of stringly-typing. */
export const SLAM_PHASES = Object.freeze(['pre', 'post']);
export const SKIP_PHASES = Object.freeze(['rollup', 'fsIntro', 'fsOutro', 'celebration']);
export const SLAM_SOURCES = Object.freeze(['button', 'reelsArea', 'keyboard']);
export const SKIP_SOURCES = Object.freeze(['button', 'keyboard']);

export function emitHookBusRuntime(cfg = defaultConfig()) {
  const c = resolveConfig({ hookBus: cfg });
  const debug = !!c.debugLog;

  return `
  /* ── HookBus BLOCK — emitted by src/blocks/hookBus.mjs ─────────────
     The central lifecycle bus. Every feature block registers here and
     the spin engine emits into it. NO block calls another block directly.
     Events: preSpin, onSpinResult, onTumbleStep, postSpin, onFsTrigger,
             onFsSpinResult, onFsEnd
     Shared state: getMult / setMult / addMult / resetMult (1× baseline).
     Debug mode = ${debug}. */
  const HookBus = (function () {
    const handlers = Object.create(null);
    const EVENTS = ${JSON.stringify(Array.from(HOOK_EVENTS))};
    for (const e of EVENTS) handlers[e] = [];

    let _mult = 1;
    let _multBase = 1;

    function on(event, fn, opts) {
      if (!handlers[event]) {
        console.warn('[HookBus] unknown event:', event);
        return () => {};
      }
      if (typeof fn !== 'function') {
        console.warn('[HookBus] handler is not a function for', event);
        return () => {};
      }
      const priority = (opts && typeof opts.priority === 'number') ? opts.priority : 0;
      const entry = { fn, priority };
      handlers[event].push(entry);
      /* stable insertion order within same priority; higher priority first */
      handlers[event].sort((a, b) => b.priority - a.priority);
      return () => off(event, fn);
    }

    function off(event, fn) {
      if (!handlers[event]) return;
      handlers[event] = handlers[event].filter(e => e.fn !== fn);
    }

    function emit(event, payload) {
      const list = handlers[event];
      if (!list || list.length === 0) return [];
      const results = [];
      ${debug ? `console.log('[HookBus]', event, payload, 'handlers:', list.length);` : ''}
      for (const entry of list) {
        try {
          const r = entry.fn(payload || {});
          results.push(r);
        } catch (err) {
          console.error('[HookBus] handler threw on', event, err);
        }
      }
      return results;
    }

    async function emitAsync(event, payload) {
      const list = handlers[event];
      if (!list || list.length === 0) return [];
      const results = [];
      ${debug ? `console.log('[HookBus.async]', event, payload, 'handlers:', list.length);` : ''}
      for (const entry of list) {
        try {
          const r = await entry.fn(payload || {});
          results.push(r);
        } catch (err) {
          console.error('[HookBus] async handler threw on', event, err);
        }
      }
      return results;
    }

    function getMult() { return _mult; }
    function setMult(v) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) _mult = n;
      if (typeof window !== 'undefined') window.__HOOKBUS_MULT__ = _mult;
    }
    function addMult(delta) {
      const n = Number(delta);
      if (Number.isFinite(n)) setMult(_mult + n);
    }
    function resetMult() {
      _mult = _multBase;
      if (typeof window !== 'undefined') window.__HOOKBUS_MULT__ = _mult;
    }
    function setMultBaseline(v) {
      const n = Number(v);
      if (Number.isFinite(n) && n >= 0) _multBase = n;
    }

    function listenerCount(event) {
      return (handlers[event] && handlers[event].length) || 0;
    }

    /* Wave V: once(event, fn) — register a handler that auto-unsubscribes
     * after its first invocation. Industry pattern equivalent of
     * MobxUtils.addWhen used in playa-slot SlamStopCommand/ForceSkipCommand
     * for one-shot pre-response → post-response coordination. */
    function once(event, fn, opts) {
      if (typeof fn !== 'function') return () => {};
      let fired = false;
      const wrapped = function (payload) {
        if (fired) return;
        fired = true;
        off(event, wrapped);
        try { return fn(payload); }
        catch (err) { console.error('[HookBus] once handler threw on', event, err); }
      };
      return on(event, wrapped, opts);
    }

    /* Wave V: cancellable wait — resolves on next emit of 'event'. Used by
     * reelEngine slam-stop pre-response path: await HookBus.waitFor('onSpinResult'). */
    function waitFor(event, timeoutMs) {
      return new Promise(function (resolve, reject) {
        const dispose = once(event, function (payload) {
          if (timer) clearTimeout(timer);
          resolve(payload);
        });
        const timer = (typeof timeoutMs === 'number' && timeoutMs > 0)
          ? setTimeout(function () { dispose(); reject(new Error('[HookBus] waitFor timeout: ' + event)); }, timeoutMs)
          : null;
      });
    }

    return {
      on, off, once, emit, emitAsync, waitFor,
      getMult, setMult, addMult, resetMult, setMultBaseline,
      listenerCount,
      EVENTS,
    };
  })();

  if (typeof window !== 'undefined') {
    window.HookBus = HookBus;
    window.__HOOKBUS_MULT__ = 1;
  }
`;
}
