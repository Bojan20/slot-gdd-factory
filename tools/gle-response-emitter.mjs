/**
 * tools/gle-response-emitter.mjs
 *
 * UQ-DEEP-AG · IGT-grade `GameLogicResponse` envelope emitter (Boki 2026-06-24).
 *
 * IGT izvor: `IGT_PLAYA_RUNTIME.md` §3 + §8:
 *   PopulationOutcome/Entry/Cell{stripIndex, symbolId}
 *   PrizeOutcome/Prize{type, amount, count, position}
 *   FreeSpinOutcome{spinsAwarded, multiplier, ...}
 *   MultiplierOutcome{value, lifetime}
 *   OutcomeDetail{transactionId, stage, nextStage, gameStatus, settled, pending, payout}
 *
 * Naš equivalent pre fix-a: `tools/math-backend.mjs:484` (samplePerSpin) vraćao
 * `{payX, isHit, fsTrigger}` — flat metric blob bez ijednog GLE field-a.
 * Sada: math-backend /spin može da emit-uje IGT-compatible envelope na zahtev.
 *
 * Public API
 *   emitGleResponse(spinResult, sessionState, options) → GameLogicResponse
 *   emitOutcomeDetail(spinResult, sessionState) → OutcomeDetail
 *   emitPopulationOutcome(grid, reelStrips, symbolIdMap) → PopulationOutcome
 *
 * Vendor-neutral: ne emit-uje brand names, samo wire contract.
 */

import { randomUUID, createHash } from 'node:crypto';

/* IGT contract: gameStatus enum. */
const GAME_STATUS = Object.freeze({
  READY: 'READY',
  PLAYED: 'PLAYED',
  SETTLED: 'SETTLED',
  PENDING: 'PENDING',
  ERROR: 'ERROR',
});

/* IGT IXF state machine: 15 stage transitions. Spin completion → next stage. */
const STAGE = Object.freeze({
  BASE_GAME: 'BaseGame',
  FREE_SPIN: 'FreeSpin',
  LOCK_AND_RESPIN: 'LockAndRespin',
  JACKPOT: 'Jackpot',
  PICK_BONUS: 'PickBonus',
  END_GAME: 'EndGame',
});

/* IGT contract: error code enum (regulator certifikat). */
export const GLE_ERROR_CODES = Object.freeze({
  INSUFFICIENT_BALANCE: 'INSUFFICIENT_BALANCE',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  GLE_TIMEOUT: 'GLE_TIMEOUT',
  RNG_RESEED_REQUIRED: 'RNG_RESEED_REQUIRED',
  INVALID_BET: 'INVALID_BET',
  PAYTABLE_HASH_MISMATCH: 'PAYTABLE_HASH_MISMATCH',
});

/* Determine next stage based on spin outcome + current state.
 * IGT IXF: state transitions are deterministic per spin outcome. */
function computeNextStage(spinResult, currentStage) {
  if (!spinResult) return STAGE.BASE_GAME;
  /* If currently in FS and spins remaining → stay in FS. */
  if (currentStage === STAGE.FREE_SPIN && spinResult.fsRemaining > 0) return STAGE.FREE_SPIN;
  /* If currently in FS and no spins remaining → END FS, back to BaseGame. */
  if (currentStage === STAGE.FREE_SPIN) return STAGE.BASE_GAME;
  /* If H&W respinning → stay. */
  if (currentStage === STAGE.LOCK_AND_RESPIN && spinResult.respinsRemaining > 0) return STAGE.LOCK_AND_RESPIN;
  if (currentStage === STAGE.LOCK_AND_RESPIN) return STAGE.BASE_GAME;
  /* Trigger detection. */
  if (spinResult.hnwTrigger) return STAGE.LOCK_AND_RESPIN;
  if (spinResult.fsTrigger) return STAGE.FREE_SPIN;
  if (spinResult.jackpotTrigger) return STAGE.JACKPOT;
  if (spinResult.pickBonusTrigger) return STAGE.PICK_BONUS;
  return STAGE.BASE_GAME;
}

/**
 * Emit `OutcomeDetail` envelope per IGT contract (`IGT_PLAYA_RUNTIME.md:106`):
 *   { transactionId, stage, nextStage, gameStatus, settled, pending, payout }
 *
 * `payout` u CENTAMA (integer arithmetic), ne dolarima — IGT GLE contract.
 */
export function emitOutcomeDetail(spinResult, sessionState = {}) {
  const txId = randomUUID();                                  /* UQ-DEEP-AG P1-1 fix */
  const currentStage = sessionState.stage || STAGE.BASE_GAME;
  const nextStage = computeNextStage(spinResult, currentStage);
  const settled = nextStage === STAGE.BASE_GAME || nextStage === STAGE.END_GAME;
  const pending = !settled;
  /* IGT payout u centima — integer-grade audit trail. */
  const betCents = Math.round((sessionState.betX || 1) * 100);
  const payoutCents = Math.round((spinResult.payX || 0) * betCents);
  return {
    transactionId: txId,
    stage: currentStage,
    nextStage,
    gameStatus: GAME_STATUS.PLAYED,
    settled,
    pending,
    payout: payoutCents,
    /* Optional regulator audit trail. */
    auditTimestamp: new Date().toISOString(),
  };
}

/**
 * Emit `PopulationOutcome` envelope per IGT contract:
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
 * Emit complete `GameLogicResponse` envelope.
 *
 * @param {object} spinResult — output from samplePerSpin or MC executor
 * @param {object} sessionState — { stage, betX, sessionId, spinIdx, paytableHash }
 * @param {object} options — { gleVersion, includePopulation, reelStrips, symbolIdMap, grid }
 */
export function emitGleResponse(spinResult, sessionState = {}, options = {}) {
  const gleVersion = options.gleVersion || '4.0';
  const outcomeDetail = emitOutcomeDetail(spinResult, sessionState);

  const response = {
    gle_version: gleVersion,
    outcomeDetail,
    /* Paytable hash echo — regulator certifikat zahteva integrity check. */
    paytableHash: sessionState.paytableHash || null,
    sessionId: sessionState.sessionId || null,
    spinIdx: sessionState.spinIdx || 0,
  };

  /* Population (reel cell layout) — only emit kad imamo grid + reelStrips. */
  if (options.includePopulation && Array.isArray(options.grid)) {
    response.populationOutcome = emitPopulationOutcome(
      options.grid,
      options.reelStrips || [],
      options.symbolIdMap || {},
    );
  }

  /* Prize outcomes — winning line summaries. */
  if (Array.isArray(spinResult.prizes) && spinResult.prizes.length > 0) {
    response.prizeOutcome = {
      Prize: spinResult.prizes.map(p => ({
        type: p.type || 'line',
        amount: Math.round((p.amount || p.payX || 0) * 100),  /* cents */
        count: p.count || p.matchLen || 0,
        position: Array.isArray(p.position) ? p.position : [],
      })),
    };
  }

  /* Free-spin outcomes. */
  if (spinResult.fsTrigger || spinResult.fsAwarded) {
    response.freeSpinOutcome = {
      spinsAwarded: spinResult.fsAwarded || spinResult.fsSpins || 0,
      multiplier: spinResult.fsMultiplier || 1,
      retrigger: spinResult.fsRetrigger === true,
    };
  }

  /* Multiplier outcomes. */
  if (typeof spinResult.multiplier === 'number' && spinResult.multiplier > 1) {
    response.multiplierOutcome = {
      value: spinResult.multiplier,
      lifetime: spinResult.multiplierLifetime || 'spin',
    };
  }

  return response;
}

/**
 * Build error envelope per IGT contract — structured error codes.
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

export { STAGE, GAME_STATUS };
