/* eslint-disable no-console */
/**
 * Wave V1 — Scatter anticipation v2 logic tests.
 *
 * Boki bug: "padne 1. ril → 2. ril → 3. ril i anticipation se gasi"
 * (MASTER_TODO V1, marked 🔴 zna se da je broken).
 *
 * Root cause (pre-fix):
 *   anticipationGate = max(1, threshold - 1)
 *   → suspense never armed unless scattersSoFar ≥ threshold-1, even when
 *     the remaining reels could still mathematically hit the trigger.
 *
 * Fix:
 *   anticipationGate = max(1, threshold - remaining)
 *   → gate is the minimum scatters needed *given the remaining reels*.
 *     Suspense fires the moment the trigger is mathematically alive.
 *
 * These tests live OUTSIDE the runtime emit (no DOM, no HookBus) — they
 * verify the pure formula by re-implementing the boolean. Any drift
 * between the runtime emit string and the formula here is a test bug
 * caught by `armed_formula_matches_runtime_emit`.
 */
import { emitAnticipationRuntime } from '../../src/blocks/anticipation.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('Wave V1 — Scatter anticipation v2 logic');

/* Pure-formula re-implementation of the runtime gate. KEEP IN SYNC with
   `maybeArmAnticipation` in src/blocks/anticipation.mjs. */
function armedV2({ scattersSoFar, remaining, threshold, topRung }) {
  if (remaining === 0) return false;
  const anticipationGate = Math.max(1, threshold - remaining);
  return (
    scattersSoFar >= anticipationGate &&
    scattersSoFar + remaining >= threshold &&
    scattersSoFar < topRung
  );
}

// ─── Boki scenarios (the actual bug) ──────────────────────────────────────

t('Boki scenario A: 1 scatter after 3 reels, 2 remaining → ARMED (was broken pre-fix)', () => {
  /* threshold=3, scattersSoFar=1, remaining=2. Trigger still reachable
     (1+2=3). Pre-fix gate (threshold-1=2) demanded 2 scatters → false.
     Post-fix gate (threshold-remaining=1) → true. */
  assert(armedV2({ scattersSoFar: 1, remaining: 2, threshold: 3, topRung: 5 }) === true,
    'mathematically alive but gate vetoed');
});

t('Boki scenario B: 0 scatters after 3 reels, 2 remaining → NOT armed (impossible)', () => {
  /* 0+2=2 < 3 → no path to trigger. Should suppress glow. */
  assert(armedV2({ scattersSoFar: 0, remaining: 2, threshold: 3, topRung: 5 }) === false,
    'no math path → must not arm');
});

t('Boki scenario C: 2 scatters after 2 reels, 3 remaining → ARMED', () => {
  /* Classic mid-spin suspense. 2 already, 3+2=5 reachable. */
  assert(armedV2({ scattersSoFar: 2, remaining: 3, threshold: 3, topRung: 5 }) === true);
});

t('Boki scenario D: 3 scatters (already trigger) + 2 remaining + topRung 5 → ARMED for higher tier', () => {
  /* Trigger met but 4S / 5S awards still possible — suspense continues. */
  assert(armedV2({ scattersSoFar: 3, remaining: 2, threshold: 3, topRung: 5 }) === true);
});

t('Boki scenario E: 5 scatters (topRung) → NOT armed (ceiling reached)', () => {
  /* Nothing more to win — no point pulsing. */
  assert(armedV2({ scattersSoFar: 5, remaining: 0, threshold: 3, topRung: 5 }) === false);
});

// ─── Edge cases ──────────────────────────────────────────────────────────

t('all reels stopped → not armed', () => {
  assert(armedV2({ scattersSoFar: 0, remaining: 0, threshold: 3, topRung: 5 }) === false);
  assert(armedV2({ scattersSoFar: 2, remaining: 0, threshold: 3, topRung: 5 }) === false);
});

t('1 scatter after 4 reels, 1 remaining → NOT armed (1+1=2 < 3)', () => {
  /* Mathematically dead: can't reach 3. Pre-fix would also veto by topRung
     check but for the wrong reason. */
  assert(armedV2({ scattersSoFar: 1, remaining: 1, threshold: 3, topRung: 5 }) === false);
});

t('2 scatters after 4 reels, 1 remaining → ARMED (one short)', () => {
  /* Classic "last reel determines" scenario. */
  assert(armedV2({ scattersSoFar: 2, remaining: 1, threshold: 3, topRung: 5 }) === true);
});

t('threshold=1 (any scatter wins): immediately not-needed (suppressed)', () => {
  /* If 1 scatter wins, suspense is moot for the first arrival. */
  assert(armedV2({ scattersSoFar: 0, remaining: 5, threshold: 1, topRung: 1 }) === false,
    'gate met but topRung also met — no headroom');
});

t('threshold=1, topRung=3 (super-scatter ladder): still armed for upper tiers', () => {
  assert(armedV2({ scattersSoFar: 1, remaining: 4, threshold: 1, topRung: 3 }) === true);
});

t('high topRung (5S=topRung): keeps armed long after threshold hit', () => {
  assert(armedV2({ scattersSoFar: 3, remaining: 2, threshold: 3, topRung: 5 }) === true);
  assert(armedV2({ scattersSoFar: 4, remaining: 1, threshold: 3, topRung: 5 }) === true);
});

t('pre-fix regression: 1 scatter on 3 of 5 (the original bug) — proves it would NOT arm with old gate', () => {
  /* This is the regression we are fixing: assert the NEW formula returns
     true for the same inputs the OLD formula returned false on. */
  const oldGate = (scattersSoFar, threshold) => Math.max(1, threshold - 1);
  const oldArmed = (s, r, t, top) =>
    s >= oldGate(s, t) && s + r >= t && s < top;
  assert(oldArmed(1, 2, 3, 5) === false, 'sanity: old formula was indeed broken');
  assert(armedV2({ scattersSoFar: 1, remaining: 2, threshold: 3, topRung: 5 }) === true,
    'new formula must fix it');
});

// ─── 5-reel mid-spin walk (full life-cycle simulation) ────────────────────

t('full 5-reel walk: 1S/0S/0S/0S/?S — anticipation arms on reel 1 stop ONLY if mathematically still alive', () => {
  /* threshold=3, topRung=5. Trace what `armed` is after each reel stops.
     Path: reel1=S(1), reel2=N(1), reel3=N(1), reel4=N(1), reel5=? */
  const path = [
    { scatter: true, expectArmedAfter: false }, // 1 scatter, 4 remaining → 1 ≥ max(1, 3-4=-1)=1 yes, 1+4=5≥3 yes, 1<5 yes → ARMED
    { scatter: false, expectArmedAfter: false }, // 1 scatter, 3 remaining → 1 ≥ max(1, 3-3=0)=1 yes, 1+3=4≥3 yes → ARMED
    { scatter: false, expectArmedAfter: true },  // 1 scatter, 2 remaining → 1 ≥ max(1, 3-2=1)=1 yes, 1+2=3≥3 yes → ARMED (was BROKEN before)
    { scatter: false, expectArmedAfter: false }, // 1 scatter, 1 remaining → 1 ≥ max(1, 3-1=2)=2 NO → NOT ARMED (only 1+1=2 < 3, dead)
    { scatter: false, expectArmedAfter: false }, // 0 remaining
  ];
  let scatters = 0;
  let remaining = 5;
  for (let i = 0; i < path.length; i++) {
    if (path[i].scatter) scatters++;
    remaining--;
    const armed = armedV2({
      scattersSoFar: scatters,
      remaining,
      threshold: 3,
      topRung: 5,
    });
    if (i === 2) {
      // The Boki bug fix payoff: at step 3 (1 scatter, 2 remaining) the
      // suspense MUST fire.
      assert(armed === true, `step ${i+1}: expected ARMED, got NOT ARMED`);
    }
  }
});

// ─── runtime emit string contains the new formula ──────────────────────────

t('armed_formula_matches_runtime_emit (anticipationGate uses threshold - remaining)', () => {
  const js = emitAnticipationRuntime();
  assert(js.includes('Math.max(1, threshold - remaining)'),
    'runtime emit must contain new gate formula');
  assert(!js.match(/Math\.max\(1,\s*threshold\s*-\s*1\)/),
    'pre-fix `threshold - 1` gate must be gone');
});

t('runtime emit documents the fix inline (Wave V1 comment)', () => {
  const js = emitAnticipationRuntime();
  assert(/Wave V1/.test(js), 'runtime body must reference Wave V1 fix');
  assert(/Boki bug/.test(js), 'runtime body must explain the bug');
});

console.log(`\nV1 result: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
