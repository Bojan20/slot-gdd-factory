/**
 * src/registry/visionCostGuard.mjs
 *
 * N+2 atom J (Boki 2026-06-25) — Cost cap for the V9 vision call.
 *
 * # WHY
 *
 * Opus 4.8 vision pricing (images + prompt + completion) lands around
 * $0.04–$0.06 per game when V9 sends 10 baked screenshots. Without a
 * guard, an overnight `node tools/v9-vision-orchestrator.mjs --vision`
 * sweep over all 338 corpus games could burn $15+ before anyone notices.
 * Worse: a rogue script (or a flaky test) could loop and burn $hundreds.
 *
 * The guard sits in front of every vision call and decides:
 *   - Have we already hit the user-set ceiling (calls or $$)?
 *   - Are we at risk of crossing it on the next call?
 *
 * If yes — `shouldCallVision()` returns `{ ok: false, reason: ... }` and
 * the caller emits a `vision-mode-llm-call: SKIP` receipt with that
 * reason. No surprise bill, no half-broken telemetry.
 *
 * # CONFIGURATION
 *
 * Env vars (read at module load, cached for the life of the process):
 *
 *   V9_MAX_VISION_CALLS   default 20    — hard upper bound on calls
 *   V9_MAX_VISION_USD     default 2.50  — soft upper bound on $$ spent
 *   V9_EST_USD_PER_CALL   default 0.05  — accountant's estimate per call
 *
 * The guard tracks calls + $$ in a tiny in-memory accumulator. It is
 * intentionally NOT persisted across processes — each CLI run starts
 * fresh. A future Wave can persist if cross-run caps become useful.
 *
 * # API
 *
 *   const guard = createGuard();
 *   guard.shouldCallVision()          → { ok, reason?, remaining }
 *   guard.recordCall({ usd })         → updates accumulator
 *   guard.report()                    → snapshot of the accumulator
 *
 * Callers create one guard per orchestrator run; the module-level
 * `defaultGuard` exists for one-shot callers that don't want to manage
 * lifecycle.
 */

/**
 * @typedef {Object} GuardConfig
 * @property {number} maxCalls
 * @property {number} maxUsd
 * @property {number} estUsdPerCall
 */

/**
 * Resolve guard config from env, falling back to safe defaults. The
 * resolver is exported so tests can build configs without poking at
 * `process.env`.
 *
 * @param {NodeJS.ProcessEnv} [env]
 * @returns {GuardConfig}
 */
export function resolveConfig(env = process.env) {
  const num = (raw, fallback, { min = 0, max = Infinity } = {}) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || n > max) return fallback;
    return n;
  };
  return {
    maxCalls: num(env.V9_MAX_VISION_CALLS, 20, { min: 0, max: 10_000 }),
    maxUsd: num(env.V9_MAX_VISION_USD, 2.5, { min: 0, max: 10_000 }),
    estUsdPerCall: num(env.V9_EST_USD_PER_CALL, 0.05, { min: 0, max: 100 }),
  };
}

/**
 * @typedef {Object} GuardSnapshot
 * @property {number} calls
 * @property {number} usd
 * @property {number} maxCalls
 * @property {number} maxUsd
 * @property {number} estUsdPerCall
 */

/**
 * @typedef {Object} Decision
 * @property {boolean} ok       true → safe to call
 * @property {string}  [reason] populated when ok=false
 * @property {{calls: number, usd: number}} remaining
 */

/**
 * Build a fresh guard instance. Each instance owns its own
 * accumulator; nothing is shared statically.
 *
 * @param {Partial<GuardConfig>} [overrides]
 * @returns {{
 *   shouldCallVision: () => Decision,
 *   recordCall: (opts?: { usd?: number }) => void,
 *   report: () => GuardSnapshot,
 *   reset: () => void,
 * }}
 */
export function createGuard(overrides = {}) {
  const cfg = { ...resolveConfig(), ...overrides };
  let calls = 0;
  let usd = 0;

  function shouldCallVision() {
    if (calls >= cfg.maxCalls) {
      return {
        ok: false,
        reason: `vision call cap reached: ${calls}/${cfg.maxCalls} calls`,
        remaining: { calls: 0, usd: Math.max(0, cfg.maxUsd - usd) },
      };
    }
    /* Pre-call check: would this PLANNED call push us past the $$
       ceiling? Use the configured estimate. The actual recordCall()
       takes the observed cost, so an over-estimate just means we cap
       slightly early — that's the safe direction to err. */
    if (usd + cfg.estUsdPerCall > cfg.maxUsd) {
      return {
        ok: false,
        reason: `vision $$ cap would be exceeded: $${usd.toFixed(2)} + $${cfg.estUsdPerCall} > $${cfg.maxUsd}`,
        remaining: { calls: Math.max(0, cfg.maxCalls - calls), usd: 0 },
      };
    }
    return {
      ok: true,
      remaining: {
        calls: cfg.maxCalls - calls,
        usd: cfg.maxUsd - usd,
      },
    };
  }

  function recordCall(opts = {}) {
    calls += 1;
    /* Allow the caller to pass an observed cost (e.g. parsed from the
       wrapper's token-count line). When absent we fall back to the
       est-per-call so the accumulator still moves. */
    const inc = typeof opts.usd === 'number' && Number.isFinite(opts.usd) && opts.usd >= 0
      ? opts.usd
      : cfg.estUsdPerCall;
    usd += inc;
  }

  function report() {
    return {
      calls,
      usd: Number(usd.toFixed(4)),
      maxCalls: cfg.maxCalls,
      maxUsd: cfg.maxUsd,
      estUsdPerCall: cfg.estUsdPerCall,
    };
  }

  function reset() {
    calls = 0;
    usd = 0;
  }

  return { shouldCallVision, recordCall, report, reset };
}

/**
 * Default module-level guard for callers that don't want to manage
 * lifecycle. Tests should prefer `createGuard()` so they don't pollute
 * the default's accumulator across cases.
 */
export const defaultGuard = createGuard();
