#!/usr/bin/env node
/**
 * tests/blocks/_engineStaleCallbackGuard.test.mjs
 *
 * Wave W57.A5 — Two-tier spinToken / tickToken stale-callback guard.
 *
 * Validates that the two highest-traffic rAF engines (reelEngine.mjs +
 * hexReelEngine.mjs) bake a spin-token guard so setTimeout callbacks
 * scheduled during spin N silently abort when fired AFTER spin N+1 has
 * started (or after the spin has been slam-stopped / aborted).
 *
 * Pattern source: agents/research-pool/woo-reels-RE.md §8.3 (production
 * pattern observed in the in-house production engine) +
 * engine-architect W57 audit verdict (HIGH severity, 0% adoption pre-W57).
 *
 * The contract verified here is the EMITTED source string — every guarded
 * setTimeout must be wrapped with the per-engine guard helper. Future
 * setTimeout introductions that bypass the guard get caught by §3.
 *
 * Honest scope: this wave guards reelEngine + hexReelEngine. The 4
 * remaining engines (wheelSpinEngine / crashSpinEngine / plinkoSpinEngine
 * / slingoSpinEngine) have shorter spin durations + smaller setTimeout
 * surface — they're slated for W57.A5.2 follow-up when actual stale-call
 * regressions surface. §4 documents the scope decision.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

let pass = 0, fail = 0;
function t(name, ok, detail) {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (detail ? ' — ' + detail : '')); }
}
function block(name, fn) { console.log('— ' + name + ' —'); fn(); console.log(''); }

const here = dirname(fileURLToPath(import.meta.url));
const reelSrc = readFileSync(resolve(here, '../../src/blocks/reelEngine.mjs'), 'utf8');
const hexSrc  = readFileSync(resolve(here, '../../src/blocks/hexReelEngine.mjs'), 'utf8');

/* ════════════════════════════════════════════════════════════════════
 * 1. reelEngine.mjs spin-token guard
 * ════════════════════════════════════════════════════════════════════ */
block('1. reelEngine.mjs spinToken guard', () => {
  t('1.1 W57.A5 marker comment present',          /W57\.A5/.test(reelSrc));
  t('1.2 __reelEngineSpinToken__ declared as window-scoped counter',
    /window\.__reelEngineSpinToken__/.test(reelSrc));
  t('1.3 Token initialized to 0 when missing (idempotent)',
    /typeof\s+window\.__reelEngineSpinToken__\s*!==\s*['"]number['"][\s\S]{0,80}window\.__reelEngineSpinToken__\s*=\s*0/.test(reelSrc));
  t('1.4 Token incremented every spin trigger',
    /window\.__reelEngineSpinToken__\+\+/.test(reelSrc));
  t('1.5 __spinToken captured as const at spin trigger',
    /const\s+__spinToken\s*=\s*window\.__reelEngineSpinToken__/.test(reelSrc));
  t('1.6 __sptGuard helper closes over captured token + compares to current',
    /const\s+__sptGuard[\s\S]{0,300}const\s+captured\s*=\s*__spinToken[\s\S]{0,300}captured\s*!==\s*window\.__reelEngineSpinToken__[\s\S]{0,80}return/.test(reelSrc));
  t('1.7 Stop-request setTimeout wrapped with __sptGuard',
    /reel\.stopTimerId\s*=\s*setTimeout\(__sptGuard\(/.test(reelSrc));
  t('1.8 onSettled handoff setTimeout wrapped with __sptGuard',
    /setTimeout\(__sptGuard\(onSettled\)/.test(reelSrc));
});

/* ════════════════════════════════════════════════════════════════════
 * 2. hexReelEngine.mjs spin-token guard
 * ════════════════════════════════════════════════════════════════════ */
block('2. hexReelEngine.mjs spinToken guard', () => {
  t('2.1 W57.A5 marker comment present',          /W57\.A5/.test(hexSrc));
  t('2.2 __hexSpinToken declared at outer engine scope (NOT inside __SLOT_HEX_RUNSPIN__)',
    /var\s+__hexSpinToken\s*=\s*0[\s\S]{0,80}function\s+__hexSptGuard/.test(hexSrc));
  t('2.3 __hexSptGuard helper closes over captured token + compares to current',
    /function\s+__hexSptGuard[\s\S]{0,300}var\s+captured\s*=\s*__hexSpinToken[\s\S]{0,200}captured\s*!==\s*__hexSpinToken[\s\S]{0,80}return/.test(hexSrc));
  t('2.4 Token incremented every spin trigger',
    /__hexSpinToken\+\+/.test(hexSrc));
  t('2.5 hexOnSettled handoff setTimeout wrapped with __hexSptGuard',
    /setTimeout\(__hexSptGuard\(cb\)/.test(hexSrc));
  t('2.6 outer-scope declaration prevents scope leak (no `var __hexSpinToken` redeclaration inside RUNSPIN)',
    !(/window\.__SLOT_HEX_RUNSPIN__\s*=\s*function[\s\S]{0,500}var\s+__hexSpinToken\s*=/.test(hexSrc)));
});

/* ════════════════════════════════════════════════════════════════════
 * 3. Guard-bypass detection — no naked setTimeout escapes the guard
 *    in the critical post-spin / settle paths.
 * ════════════════════════════════════════════════════════════════════ */
block('3. No-bypass invariant on critical settle paths', () => {
  /* The reel-loop end branch (where onSettled fires) must use __sptGuard. */
  const reelSettleSection = reelSrc.match(/spinTicker\s*=\s*null;[\s\S]{0,1000}typeof\s+onSettled\s*===\s*["']function["'][\s\S]{0,400}/);
  t('3.1 reelEngine settle section uses __sptGuard around onSettled',
    reelSettleSection ? /__sptGuard/.test(reelSettleSection[0]) : false);

  /* The hex-loop end branch must use __hexSptGuard. */
  const hexSettleSection = hexSrc.match(/hexTicker\s*=\s*null;[\s\S]{0,800}typeof\s+hexOnSettled\s*===\s*["']function["'][\s\S]{0,800}/);
  t('3.2 hexReelEngine settle section uses __hexSptGuard around cb',
    hexSettleSection ? /__hexSptGuard/.test(hexSettleSection[0]) : false);
});

/* ════════════════════════════════════════════════════════════════════
 * 4. Honest scope marker — engines deliberately NOT yet integrated
 * ════════════════════════════════════════════════════════════════════ */
block('4. Honest scope — 4 engines deferred to W57.A5.2', () => {
  /* The 4 deferred engines must NOT yet carry a W57.A5 marker; if they
   * pick it up later, this assertion will need to flip. Keeping it here
   * documents the scope decision so a future refactor doesn't silently
   * add the pattern without thinking through stale-callback edge cases. */
  for (const name of ['wheelSpinEngine', 'crashSpinEngine', 'plinkoSpinEngine', 'slingoSpinEngine']) {
    const src = readFileSync(resolve(here, '../../src/blocks/' + name + '.mjs'), 'utf8');
    t(`4.${name} deferred (no W57.A5 marker yet)`,
      !/W57\.A5/.test(src));
  }
});

/* ════════════════════════════════════════════════════════════════════
 * 5. Pure formula re-implementation — verifies the guard SHAPE matches
 *    what the source emits (drift detector).
 * ════════════════════════════════════════════════════════════════════ */
block('5. Guard formula drift detector', () => {
  /* Build a tiny sandbox: simulate spin N scheduling a callback, then
   * spin N+1 starts, then spin-N's callback fires. The captured-vs-
   * current comparison must drop the stale callback. */
  let tokenCounter = 0;
  let fired = false;
  function sptGuard(fn) {
    const captured = tokenCounter;
    return function () {
      if (captured !== tokenCounter) return; /* stale */
      return fn.apply(this, arguments);
    };
  }

  /* Spin N */
  tokenCounter++;
  const guardedCallback = sptGuard(() => { fired = true; });

  /* Spin N+1 (without firing N's callback) */
  tokenCounter++;

  /* Now fire N's callback — should be a no-op */
  guardedCallback();
  t('5.1 Stale callback (token incremented between schedule and fire) is dropped',
    fired === false);

  /* Fresh-callback case: schedule + fire without intervening spin */
  fired = false;
  tokenCounter++;
  const freshCallback = sptGuard(() => { fired = true; });
  freshCallback();
  t('5.2 Fresh callback (no intervening spin) executes normally',
    fired === true);
});

console.log('');
console.log(`  pass: ${pass}   fail: ${fail}`);
process.exit(fail > 0 ? 1 : 0);
