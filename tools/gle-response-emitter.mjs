/**
 * tools/gle-response-emitter.mjs
 *
 * UQ-DEEP-AG · industry-grade `GameLogicResponse` envelope emitter (Boki 2026-06-24).
 * UQ-DEEP-AL · FIX-E (Boki 2026-06-24): IGT field-name alignment + Map<> shape.
 *
 * Industry IGT spec (IGT_PLAYA_RUNTIME.md, IGT_SYMBOLS/playa-slot.symbols.md):
 *   populationOutcome: Map<string, IPopulationOutcomeDef>      keyed by GLE tag ('main', ...)
 *   prizeOutcome:      Map<string, IPrizeOutcomeDef>           keyed by tag ('lines','scatter',...)
 *   freeSpinOutcome:   Map<string, IFreeSpinOutcomeDef>        { fsCount, fsCountDown, fsAwarded }
 *   multiplierOutcome: Map<string, IMultiplierOutcomeDef>      { value, lifetime }
 *   outcomeDetail:     { transactionId, stage, nextStage, payout, state? }
 *
 *   IOutcomePrizeDef = {
 *     pay, totalPay, multiplier, betMultiplier, symbolCount, position, ways
 *   }
 *   (NOT the legacy {type, amount, count, position} which we emitted pre-AL.)
 *
 *   IFreeSpinOutcomeDef = { fsCount, fsCountDown, fsAwarded }
 *   (NOT the legacy {spinsAwarded, multiplier, retrigger}.)
 *
 * Pre-AL we emitted single-object envelopes keyed by name (e.g. `prizeOutcome:
 * { Prize: [...] }`) and an invented `gameStatus` enum. Both are now fixed:
 *   - Map<> outer envelope (IGT requires keyed map, not single object).
 *   - `gameStatus` enum removed (IGT field is free-form `state: string`).
 *   - Prize & freeSpin field names migrated to IGT spec.
 *
 * Back-compat: pass `{ legacy: true }` to emitGleResponse to get the pre-AL
 * single-object format (used by any existing /spin consumer until migrated).
 *
 * Naš equivalent pre fix-a: `tools/math-backend.mjs:484` (samplePerSpin) vraćao
 * `{payX, isHit, fsTrigger}` — flat metric blob bez ijednog GLE field-a.
 * Sada: math-backend /spin može da emit-uje wire-compatible envelope na zahtev.
 *
 * Public API
 *   emitGleResponse(spinResult, sessionState, options) → GameLogicResponse
 *   emitOutcomeDetail(spinResult, sessionState, opts) → OutcomeDetail
 *   emitPopulationOutcome(grid, reelStrips, symbolIdMap) → IPopulationOutcomeDef
 *   emitPopulationMap(spinResult, options) → { tag: IPopulationOutcomeDef, ... }
 *   emitPrizeMap(spinResult) → { tag: { Prize: [IOutcomePrizeDef, ...] }, ... }
 *   emitFreeSpinMap(spinResult) → { tag: IFreeSpinOutcomeDef, ... }
 *   emitMultiplierMap(spinResult) → { tag: IMultiplierOutcomeDef, ... }
 *   prizeToIgtShape(p) → IOutcomePrizeDef
 *
 * Vendor-neutral: ne emit-uje brand names, samo wire contract.
 */

import { randomUUID, createHash } from 'node:crypto';

/* lifecycle state machine: 15 stage transitions. Spin completion → next stage. */
const STAGE = Object.freeze({
  BASE_GAME: 'BaseGame',
  FREE_SPIN: 'FreeSpin',
  LOCK_AND_RESPIN: 'LockAndRespin',
  JACKPOT: 'Jackpot',
  PICK_BONUS: 'PickBonus',
  END_GAME: 'EndGame',
});

/* industry contract: error code enum (regulator certifikat). */
export const GLE_ERROR_CODES = Object.freeze({
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  GLE_TIMEOUT: 'GLE_TIMEOUT',
  RNG_RESEED_REQUIRED: 'RNG_RESEED_REQUIRED',
  INVALID_BET: 'INVALID_BET',
  PAYTABLE_HASH_MISMATCH: 'PAYTABLE_HASH_MISMATCH',
});

/* UQ-DEEP-AL · FIX-F · lifecycle state machine transition matrix guard.
 *
 * Canonical legal transitions per IGT slot state machine spec. Any
 * `(from → to)` not in this matrix is ILLEGAL and gets either soft-defaulted
 * to BASE_GAME (production) or hard-thrown (strict / CI mode via env var
 * GLE_STRICT_TRANSITIONS='true').
 *
 * Keys are STAGE ENUM STRING KEYS (BASE_GAME, FREE_SPIN, ...) — not the
 * underlying camelCase value (BaseGame, FreeSpin, ...). Caller passes either,
 * we resolve via stageKey() helper below.
 */
export const LEGAL_TRANSITIONS = Object.freeze({
  BASE_GAME: Object.freeze(['BASE_GAME', 'FREE_SPIN', 'LOCK_AND_RESPIN', 'JACKPOT', 'PICK_BONUS', 'END_GAME']),
  FREE_SPIN: Object.freeze(['FREE_SPIN', 'LOCK_AND_RESPIN', 'JACKPOT', 'BASE_GAME', 'END_GAME']),
  LOCK_AND_RESPIN: Object.freeze(['LOCK_AND_RESPIN', 'JACKPOT', 'BASE_GAME', 'END_GAME']),
  JACKPOT: Object.freeze(['BASE_GAME', 'END_GAME']),
  PICK_BONUS: Object.freeze(['BASE_GAME', 'FREE_SPIN', 'END_GAME']),
  END_GAME: Object.freeze(['BASE_GAME']),
});

/* TransitionError — thrown when illegal state transition attempted in strict mode. */
export class TransitionError extends Error {
  constructor(from, to) {
    super(`Illegal lifecycle transition: ${from} → ${to}`);
    this.name = 'TransitionError';
    this.from = from;
    this.to = to;
    this.code = 'ILLEGAL_TRANSITION';
  }
}

/* Resolve any stage form (enum key 'BASE_GAME' or value 'BaseGame') → enum key. */
function stageKey(s) {
  if (s === undefined || s === null) return undefined;
  if (typeof s !== 'string') return null;
  /* If already a known key. */
  if (Object.prototype.hasOwnProperty.call(LEGAL_TRANSITIONS, s)) return s;
  /* If a known value, reverse-map. */
  for (const k of Object.keys(STAGE)) {
    if (STAGE[k] === s) return k;
  }
  return null;
}

/**
 * isLegalTransition(from, to) → boolean
 *   - true if (from → to) is in LEGAL_TRANSITIONS matrix.
 *   - true if from is undefined (initial state — anything goes from cold start).
 *   - false if from or to is an unknown stage.
 */
export function isLegalTransition(from, to) {
  if (from === undefined) return true;                             /* initial state */
  const fk = stageKey(from);
  const tk = stageKey(to);
  if (!fk || !tk) return false;                                    /* unknown stage */
  const allowed = LEGAL_TRANSITIONS[fk];
  if (!allowed) return false;
  return allowed.includes(tk);
}

/**
 * assertLegalTransition(from, to) — throws TransitionError if illegal.
 */
export function assertLegalTransition(from, to) {
  if (!isLegalTransition(from, to)) {
    throw new TransitionError(from, to);
  }
}

/* Determine next stage based on spin outcome + current state.
 * lifecycle state machine: state transitions are deterministic per spin outcome.
 *
 * UQ-DEEP-AL · FIX-F: final result run-through transition matrix guard.
 *   - Strict mode (env GLE_STRICT_TRANSITIONS='true'): throw TransitionError.
 *   - Soft mode (default): warn + fallback to BASE_GAME.
 * The guard surfaces bugs in trigger-detection logic without crashing prod. */
function computeNextStage(spinResult, currentStage) {
  let nextStage;
  if (!spinResult) {
    nextStage = STAGE.BASE_GAME;
  } else if (currentStage === STAGE.FREE_SPIN && spinResult.fsRemaining > 0) {
    nextStage = STAGE.FREE_SPIN;
  } else if (currentStage === STAGE.FREE_SPIN) {
    nextStage = STAGE.BASE_GAME;
  } else if (currentStage === STAGE.LOCK_AND_RESPIN && spinResult.respinsRemaining > 0) {
    nextStage = STAGE.LOCK_AND_RESPIN;
  } else if (currentStage === STAGE.LOCK_AND_RESPIN) {
    nextStage = STAGE.BASE_GAME;
  } else if (spinResult.hnwTrigger) {
    nextStage = STAGE.LOCK_AND_RESPIN;
  } else if (spinResult.fsTrigger) {
    nextStage = STAGE.FREE_SPIN;
  } else if (spinResult.jackpotTrigger) {
    nextStage = STAGE.JACKPOT;
  } else if (spinResult.pickBonusTrigger) {
    nextStage = STAGE.PICK_BONUS;
  } else {
    nextStage = STAGE.BASE_GAME;
  }

  /* Transition matrix guard. currentStage may be undefined on cold-start —
   * isLegalTransition handles that as "always legal". */
  if (currentStage && !isLegalTransition(currentStage, nextStage)) {
    if (process.env.GLE_STRICT_TRANSITIONS === 'true') {
      throw new TransitionError(currentStage, nextStage);
    }
    /* Soft default: warn + safe fallback. */
    // eslint-disable-next-line no-console
    console.warn(`[GLE] Illegal transition: ${currentStage} → ${nextStage} (defaulting to BASE_GAME)`);
    return STAGE.BASE_GAME;
  }
  return nextStage;
}

/**
 * Emit `OutcomeDetail` envelope per IGT contract.
 *
 * IGT-aligned (UQ-DEEP-AL FIX-E):
 *   { transactionId, stage, nextStage, settled, pending, payout, auditTimestamp, state }
 *
 * `gameStatus` (PLAYED/SETTLED/...) was an invented enum — IGT untyped — REMOVED
 * from default output. `state` is the IGT free-form opaque-string field (null
 * when not set). `settled`/`pending` are computed booleans kept as conveniences
 * (do not collide with any IGT field name).
 *
 * Legacy mode (`{ legacy: true }`) reinstates `gameStatus: 'PLAYED'` for any
 * existing client still binding to the pre-AL shape.
 *
 * `payout` u CENTAMA (integer arithmetic), ne dolarima — industry math engine contract.
 */
export function emitOutcomeDetail(spinResult, sessionState = {}, options = {}) {
  const legacy = options.legacy === true;
  const txId = randomUUID();                                  /* UQ-DEEP-AG P1-1 fix */
  const currentStage = sessionState.stage || STAGE.BASE_GAME;
  const nextStage = computeNextStage(spinResult, currentStage);
  const settled = nextStage === STAGE.BASE_GAME || nextStage === STAGE.END_GAME;
  const pending = !settled;
  /* industry standard payout u centima — integer-grade audit trail. */
  const betCents = Math.round((sessionState.betX || 1) * 100);
  const payoutCents = Math.round((spinResult.payX || 0) * betCents);
  const out = {
    transactionId: txId,
    stage: currentStage,
    nextStage,
    settled,
    pending,
    payout: payoutCents,
    /* Optional regulator audit trail. */
    auditTimestamp: new Date().toISOString(),
  };
  if (legacy) {
    /* Pre-AL clients still see the invented enum. */
    out.gameStatus = 'PLAYED';
    return out;
  }
  /* IGT-aligned: opaque free-form `state` (null when unset), no gameStatus enum. */
  out.state = (typeof sessionState.state === 'string') ? sessionState.state : null;
  return out;
}

/**
 * Emit `PopulationOutcome` envelope per industry contract:
 *   {
 *     Entry: [
 *       {
 *         Cell: [
 *           { stripIndex: int, symbolId: int },
 *           ...                    // per row, per column
 *         ]
 *       },
 *       ...                        // typically one entry per reel
 *     ]
 *   }
 *
 * Klijent (playa-slot reelEngine) koristi stripIndex da pozicionira physical
 * reel — server-authoritative stop. Bez ovoga reelEngine fallback-uje na
 * lokalni JS RNG (non-replay-able, non-regulatable).
 */
export function emitPopulationOutcome(grid, reelStrips, symbolIdMap = {}) {
  if (!Array.isArray(grid) || grid.length === 0) return { Entry: [] };
  const nReels = grid.length;
  const nRows = Array.isArray(grid[0]) ? grid[0].length : 3;
  const entries = [];
  for (let reelIdx = 0; reelIdx < nReels; reelIdx++) {
    const reelStrip = reelStrips && reelStrips[reelIdx];
    const cells = [];
    for (let rowIdx = 0; rowIdx < nRows; rowIdx++) {
      const sym = grid[reelIdx] && grid[reelIdx][rowIdx];
      const symbolId = (typeof sym === 'string') ? (symbolIdMap[sym] ?? -1) : (typeof sym === 'number' ? sym : -1);
      /* stripIndex: position in reelStrip where this symbol came from. If
       * unknown (browser-side fallback), use rowIdx as offset. */
      let stripIndex = -1;
      if (Array.isArray(reelStrip)) {
        /* Find a stripIndex such that strip[stripIndex+rowIdx] === sym. */
        for (let i = 0; i < reelStrip.length; i++) {
          if (reelStrip[i] === sym || (symbolIdMap[reelStrip[i]] === symbolId)) {
            stripIndex = i - rowIdx;
            if (stripIndex < 0) stripIndex += reelStrip.length;
            break;
          }
        }
      }
      cells.push({ stripIndex, symbolId });
    }
    entries.push({ Cell: cells });
  }
  return { Entry: entries };
}

/**
 * Emit population map: `{ 'main': IPopulationOutcomeDef, ... }`.
 * Future bonus phases (fs-spin, lock-respin) get their own keys.
 *
 * Reads `options.grid + options.reelStrips + options.symbolIdMap` first; if
 * absent falls back to `spinResult.grid + spinResult.reelStrips + spinResult.symbolIdMap`.
 * Returns `{}` (no `main` key) when grid is unavailable — keeps IGT contract:
 * the outer envelope IS the map (must be an object), individual keys are optional.
 */
export function emitPopulationMap(spinResult, options = {}) {
  const out = {};
  if (Array.isArray(options.grid) && options.grid.length > 0) {
    out['main'] = emitPopulationOutcome(options.grid, options.reelStrips || [], options.symbolIdMap || {});
  } else if (spinResult && Array.isArray(spinResult.grid) && spinResult.grid.length > 0) {
    out['main'] = emitPopulationOutcome(spinResult.grid, spinResult.reelStrips || [], spinResult.symbolIdMap || {});
  }
  return out;
}

/**
 * Convert a single internal prize → IGT IOutcomePrizeDef.
 *   { pay, totalPay, multiplier, betMultiplier, symbolCount, position, ways }
 *
 * `pay` is the base award in cents (pre-multiplier).
 * `totalPay = round(pay × multiplier × betMultiplier)`.
 *
 * Accepts either pre-converted cents (`p.pay`) or dollars (`p.amount`/`p.payX`).
 * `position` collapses array forms to 0 (IGT field is a single int — payline
 * or cluster index).
 */
export function prizeToIgtShape(p) {
  const multiplier    = (typeof p.multiplier === 'number' && p.multiplier > 0) ? p.multiplier : 1;
  const betMultiplier = (typeof p.betMultiplier === 'number' && p.betMultiplier > 0) ? p.betMultiplier : 1;
  let pay;
  if (typeof p.pay === 'number') pay = Math.round(p.pay);
  else pay = Math.round(((p.amount ?? p.payX ?? 0)) * 100);
  const totalPay = Math.round(pay * multiplier * betMultiplier);
  const symbolCount = (typeof p.symbolCount === 'number') ? p.symbolCount
    : (typeof p.count === 'number' ? p.count
       : (typeof p.matchLen === 'number' ? p.matchLen : 0));
  let position;
  if (typeof p.position === 'number') position = p.position;
  else if (typeof p.payline === 'number') position = p.payline;
  else if (typeof p.lineIndex === 'number') position = p.lineIndex;
  else if (Array.isArray(p.position) && p.position.length > 0) position = 0;
  else position = 0;
  const ways = (typeof p.ways === 'number' && p.ways > 0) ? p.ways : 1;
  return { pay, totalPay, multiplier, betMultiplier, symbolCount, position, ways };
}

/**
 * Emit prize map: `{ 'lines': { Prize: [...] }, 'scatter': { Prize: [...] } }`.
 * Groups internal prizes by `p.tag || derive(p.type)`.
 *   p.type === 'scatter' → 'scatter'
 *   p.type === 'cluster' → 'cluster'
 *   p.type === 'ways'    → 'ways'
 *   else                 → 'lines'
 */
export function emitPrizeMap(spinResult) {
  const out = {};
  if (!spinResult || !Array.isArray(spinResult.prizes) || spinResult.prizes.length === 0) return out;
  for (const p of spinResult.prizes) {
    const tag = p.tag
      || (p.type === 'scatter' ? 'scatter'
          : p.type === 'cluster' ? 'cluster'
          : p.type === 'ways' ? 'ways'
          : 'lines');
    if (!out[tag]) out[tag] = { Prize: [] };
    out[tag].Prize.push(prizeToIgtShape(p));
  }
  return out;
}

/**
 * Emit free-spin map: `{ 'fs-main': { fsCount, fsCountDown, fsAwarded } }`.
 * Empty `{}` when no FS trigger / no remaining FS.
 *
 * IGT IFreeSpinOutcomeDef fields:
 *   fsCount      total FS this lifecycle (cumulative incl. retriggers)
 *   fsCountDown  remaining FS to play
 *   fsAwarded    FS newly awarded by this trigger
 */
export function emitFreeSpinMap(spinResult) {
  const out = {};
  if (!spinResult) return out;
  const fsTriggered = spinResult.fsTrigger
                   || spinResult.fsAwarded
                   || (typeof spinResult.fsRemaining === 'number' && spinResult.fsRemaining > 0);
  if (!fsTriggered) return out;
  const fsAwarded    = spinResult.fsAwarded || spinResult.fsSpins || 0;
  const fsCountDown  = (typeof spinResult.fsRemaining === 'number') ? spinResult.fsRemaining : fsAwarded;
  const fsCount      = (typeof spinResult.fsCount === 'number') ? spinResult.fsCount : fsAwarded;
  out['fs-main'] = { fsCount, fsCountDown, fsAwarded };
  return out;
}

/**
 * Emit multiplier map: `{ 'global': { value, lifetime } }`.
 */
export function emitMultiplierMap(spinResult) {
  const out = {};
  if (!spinResult) return out;
  if (typeof spinResult.multiplier === 'number' && spinResult.multiplier > 1) {
    out['global'] = {
      value: spinResult.multiplier,
      lifetime: spinResult.multiplierLifetime || 'spin',
    };
  }
  return out;
}

/**
 * Emit complete `GameLogicResponse` envelope.
 *
 * Default (UQ-DEEP-AL FIX-E): IGT-aligned Map<> shape — `populationOutcome`,
 * `prizeOutcome`, `freeSpinOutcome`, `multiplierOutcome` are always plain
 * objects keyed by GLE tag (possibly `{}`).
 *
 * Legacy (`{ legacy: true }`): pre-AL flat shape (back-compat for any current
 * /spin consumer not yet migrated). Switch consumers to `legacy: false`
 * once they bind to the Map<> shape.
 *
 * @param {object} spinResult — output from samplePerSpin or MC executor
 * @param {object} sessionState — { stage, betX, sessionId, spinIdx, paytableHash, state }
 * @param {object} options — { gleVersion, includePopulation, reelStrips, symbolIdMap, grid, legacy }
 */
export function emitGleResponse(spinResult, sessionState = {}, options = {}) {
  const gleVersion = options.gleVersion || '4.0';
  const legacy = options.legacy === true;
  const outcomeDetail = emitOutcomeDetail(spinResult, sessionState, { legacy });

  if (legacy) {
    /* ── Pre-AL legacy shape (single-object outcomes, conditional emit). ─── */
    const response = {
      gle_version: gleVersion,
      outcomeDetail,
      paytableHash: sessionState.paytableHash || null,
      sessionId: sessionState.sessionId || null,
      spinIdx: sessionState.spinIdx || 0,
    };
    if (options.includePopulation && Array.isArray(options.grid)) {
      response.populationOutcome = emitPopulationOutcome(
        options.grid,
        options.reelStrips || [],
        options.symbolIdMap || {},
      );
    }
    if (Array.isArray(spinResult.prizes) && spinResult.prizes.length > 0) {
      response.prizeOutcome = {
        Prize: spinResult.prizes.map(p => ({
          type: p.type || 'line',
          amount: Math.round((p.amount || p.payX || 0) * 100),
          count: p.count || p.matchLen || 0,
          position: Array.isArray(p.position) ? p.position : [],
        })),
      };
    }
    if (spinResult.fsTrigger || spinResult.fsAwarded) {
      response.freeSpinOutcome = {
        spinsAwarded: spinResult.fsAwarded || spinResult.fsSpins || 0,
        multiplier: spinResult.fsMultiplier || 1,
        retrigger: spinResult.fsRetrigger === true,
      };
    }
    if (typeof spinResult.multiplier === 'number' && spinResult.multiplier > 1) {
      response.multiplierOutcome = {
        value: spinResult.multiplier,
        lifetime: spinResult.multiplierLifetime || 'spin',
      };
    }
    return response;
  }

  /* ── IGT-aligned Map<> shape (default). ───────────────────────────────── */
  const response = {
    gle_version: gleVersion,
    outcomeDetail,
    /* Paytable hash echo — regulator certifikat zahteva integrity check. */
    paytableHash: sessionState.paytableHash || null,
    sessionId: sessionState.sessionId || null,
    spinIdx: sessionState.spinIdx || 0,
    /* Map<> envelopes (plain object keyed by GLE tag; possibly empty). */
    populationOutcome: emitPopulationMap(spinResult, options),
    prizeOutcome:      emitPrizeMap(spinResult),
    freeSpinOutcome:   emitFreeSpinMap(spinResult),
    multiplierOutcome: emitMultiplierMap(spinResult),
  };
  return response;
}

/**
 * Build error envelope per industry contract — structured error codes.
 */
export function emitErrorResponse(code, message, options = {}) {
  if (!Object.values(GLE_ERROR_CODES).includes(code)) {
    code = GLE_ERROR_CODES.GLE_TIMEOUT;
  }
  return {
    ok: false,
    gle_version: options.gleVersion || '4.0',
    code,
    message: message || code,
    retryable: code === GLE_ERROR_CODES.GLE_TIMEOUT || code === GLE_ERROR_CODES.RNG_RESEED_REQUIRED,
    severity: code === GLE_ERROR_CODES.PAYTABLE_HASH_MISMATCH ? 'fatal' : 'recoverable',
    errorTimestamp: new Date().toISOString(),
  };
}

export { STAGE };
