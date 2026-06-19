/**
 * tools/_ultimate-cross-engine-parity.mjs
 *
 * Ultimate Cross-Engine Parity Sweep for Wave LEGO-BUY blocks.
 *
 * Wave LEGO-BUY (4f40cb1) introduced 2 new blocks (bonusBuyMenu +
 * anteBetLadder) but tested them only on slot/rectangular kind. This
 * probe verifies their behavior on EVERY known SHAPE.kind:
 *
 *   For each (block × kind), assert:
 *     1. resolveConfig respects gridProfile veto (per topology decision)
 *     2. emit*CSS / emit*Markup / emit*Runtime are EMPTY when disabled
 *     3. resolveConfig still functions without explicit GDD entry
 *     4. Auto-enable from features[] does NOT override topology veto
 *     5. Explicit GDD enabled=true CANNOT override topology veto
 *        (when topology profile says enabled:false — veto wins)
 *     6. Single-tier degeneracy collapses correctly (menu/ladder)
 *     7. Jurisdiction ban interacts correctly with topology veto
 *
 * Also runs full regression on legacy bonusBuy + anteBet across all
 * the same kinds to ensure mutex with menu/ladder doesn't regress them.
 *
 * Exit 0 = all parity assertions pass, 1 = any drift / regression.
 */
import {
  defaultConfig as bbmDefault,
  resolveConfig as bbmResolve,
  emitBonusBuyMenuCSS,
  emitBonusBuyMenuMarkup,
  emitBonusBuyMenuRuntime,
} from '../src/blocks/bonusBuyMenu.mjs';
import {
  defaultConfig as ablDefault,
  resolveConfig as ablResolve,
  emitAnteBetLadderCSS,
  emitAnteBetLadderMarkup,
  emitAnteBetLadderRuntime,
} from '../src/blocks/anteBetLadder.mjs';
import {
  resolveConfig as bbResolve,
  emitBonusBuyCSS,
  emitBonusBuyMarkup,
  emitBonusBuyRuntime,
} from '../src/blocks/bonusBuy.mjs';
import {
  resolveConfig as abResolve,
  emitAnteBetCSS,
  emitAnteBetMarkup,
  emitAnteBetRuntime,
} from '../src/blocks/anteBet.mjs';
import { listKinds, PROFILE } from '../src/registry/gridProfile.mjs';

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) { pass++; }
  else    { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); }
}

const ALL_KINDS = listKinds();
console.log('\n=== Ultimate Cross-Engine Parity Sweep ===');
console.log(`  • Wave LEGO-BUY blocks tested across ${ALL_KINDS.length} kinds`);

/* ── matrix of valid full-tier configs (will be the "ideal" GDD) ─── */
const VALID_MENU_TIERS = [
  { id: 'standard', label: 'STANDARD FS', costX: 75,  forceScatters: 4, fsMode: 'standard' },
  { id: 'super',    label: 'SUPER FS',    costX: 200, forceScatters: 5, fsMode: 'super' },
  { id: 'mega',     label: 'MEGA FS',     costX: 500, forceScatters: 6, fsMode: 'mega' },
];
const VALID_LADDER_RUNGS = [
  { id: 'off', label: 'OFF',   costMultiplier: 1.0,  triggerMultiplier: 1.0 },
  { id: 'mid', label: '+50%',  costMultiplier: 1.5,  triggerMultiplier: 2.0 },
  { id: 'max', label: '+100%', costMultiplier: 2.0,  triggerMultiplier: 3.0 },
];

/* ── helper: makeModel(kind, ...) ─────────────────────────────────── */
function modelFor(kind, extra = {}) {
  return {
    SHAPE: { kind },
    features: [],
    ...extra,
  };
}

function isEmpty(s) {
  return s === '' || s === '/* bonusBuyMenu: disabled */' ||
         s === '/* anteBetLadder: disabled */' ||
         s === '/* bonusBuy: disabled */' ||
         s === '/* anteBet: disabled */';
}

/* ── decide: does PROFILE veto this block for this kind? ──────────── */
function profileVeto(kind, blockName) {
  const entry = PROFILE[kind];
  if (!entry || !entry[blockName]) return null;
  return entry[blockName].enabled === false;
}

/* ── 1: bonusBuyMenu across every kind ────────────────────────────── */
console.log('\n  ─ bonusBuyMenu × kinds ─');
for (const kind of ALL_KINDS) {
  const veto = profileVeto(kind, 'bonusBuyMenu') === true;

  /* Default resolve (no features, no explicit override) — must be
   * disabled regardless of veto, because default `enabled: false`. */
  const r0 = bbmResolve(modelFor(kind));
  t(`bbm.${kind}: default disabled`, r0.enabled === false);

  /* Explicit enabled + valid tiers (a "GDD wants this") */
  const r1 = bbmResolve(modelFor(kind, { bonusBuyMenu: { enabled: true, tiers: VALID_MENU_TIERS } }));
  if (veto) {
    t(`bbm.${kind}: topology veto wins over explicit enabled`, r1.enabled === false,
      `expected disabled (veto), got ${r1.enabled}`);
  } else {
    t(`bbm.${kind}: explicit enabled + tiers ⇒ active`, r1.enabled === true,
      `expected enabled, got ${r1.enabled}`);
  }

  /* Auto-enable from features.bonus_buy[tiers] */
  const r2 = bbmResolve(modelFor(kind, {
    features: [{ kind: 'bonus_buy', tiers: VALID_MENU_TIERS }],
  }));
  if (veto) {
    t(`bbm.${kind}: topology veto wins over feature auto-enable`, r2.enabled === false,
      `expected disabled (veto), got ${r2.enabled}`);
  } else {
    t(`bbm.${kind}: feature auto-enable ⇒ active`, r2.enabled === true,
      `expected enabled, got ${r2.enabled}`);
  }

  /* Emit functions: must return empty when disabled */
  if (r0.enabled === false) {
    t(`bbm.${kind}: default → emitCSS empty`,     isEmpty(emitBonusBuyMenuCSS(r0)));
    t(`bbm.${kind}: default → emitMarkup empty`,  isEmpty(emitBonusBuyMenuMarkup(r0)));
    t(`bbm.${kind}: default → emitRuntime stub`,  isEmpty(emitBonusBuyMenuRuntime(r0)));
  }
  if (r1.enabled === false) {
    t(`bbm.${kind}: vetoed → emitCSS empty`,     isEmpty(emitBonusBuyMenuCSS(r1)));
    t(`bbm.${kind}: vetoed → emitMarkup empty`,  isEmpty(emitBonusBuyMenuMarkup(r1)));
    t(`bbm.${kind}: vetoed → emitRuntime stub`,  isEmpty(emitBonusBuyMenuRuntime(r1)));
  } else if (r1.enabled === true) {
    t(`bbm.${kind}: active → emitCSS non-empty`,    !isEmpty(emitBonusBuyMenuCSS(r1)));
    t(`bbm.${kind}: active → emitMarkup non-empty`, !isEmpty(emitBonusBuyMenuMarkup(r1)));
    t(`bbm.${kind}: active → emitRuntime non-empty`,!isEmpty(emitBonusBuyMenuRuntime(r1)));
  }

  /* Single-tier degeneracy must collapse regardless of kind */
  const rDeg = bbmResolve(modelFor(kind, {
    bonusBuyMenu: { enabled: true, tiers: [VALID_MENU_TIERS[0]] },
  }));
  t(`bbm.${kind}: single-tier degeneracy collapses`, rDeg.enabled === false,
    `expected disabled, got ${rDeg.enabled}`);

  /* Jurisdiction ban: UKGC must always disable, even if topology allows */
  const rJ = bbmResolve(modelFor(kind, {
    regulator: { profile: 'UKGC' },
    features: [{ kind: 'bonus_buy', tiers: VALID_MENU_TIERS }],
  }));
  t(`bbm.${kind}: UKGC ban forces disabled`, rJ.enabled === false && rJ.bannedByJurisdiction === true,
    `enabled=${rJ.enabled}, banned=${rJ.bannedByJurisdiction}`);
}

/* ── 2: anteBetLadder across every kind ────────────────────────────── */
console.log('  ─ anteBetLadder × kinds ─');
for (const kind of ALL_KINDS) {
  const veto = profileVeto(kind, 'anteBetLadder') === true;

  const r0 = ablResolve(modelFor(kind));
  t(`abl.${kind}: default disabled`, r0.enabled === false);

  const r1 = ablResolve(modelFor(kind, { anteBetLadder: { enabled: true, rungs: VALID_LADDER_RUNGS } }));
  if (veto) {
    t(`abl.${kind}: topology veto wins over explicit enabled`, r1.enabled === false,
      `expected disabled (veto), got ${r1.enabled}`);
  } else {
    t(`abl.${kind}: explicit enabled + rungs ⇒ active`, r1.enabled === true,
      `expected enabled, got ${r1.enabled}`);
  }

  const r2 = ablResolve(modelFor(kind, {
    features: [{ kind: 'ante_bet', rungs: VALID_LADDER_RUNGS }],
  }));
  if (veto) {
    t(`abl.${kind}: topology veto wins over feature auto-enable`, r2.enabled === false,
      `expected disabled (veto), got ${r2.enabled}`);
  } else {
    t(`abl.${kind}: feature auto-enable ⇒ active`, r2.enabled === true,
      `expected enabled, got ${r2.enabled}`);
  }

  if (r0.enabled === false) {
    t(`abl.${kind}: default → emitCSS empty`,    isEmpty(emitAnteBetLadderCSS(r0)));
    t(`abl.${kind}: default → emitMarkup empty`, isEmpty(emitAnteBetLadderMarkup(r0)));
    t(`abl.${kind}: default → emitRuntime stub`, isEmpty(emitAnteBetLadderRuntime(r0)));
  }
  if (r1.enabled === false) {
    t(`abl.${kind}: vetoed → emitCSS empty`,    isEmpty(emitAnteBetLadderCSS(r1)));
    t(`abl.${kind}: vetoed → emitMarkup empty`, isEmpty(emitAnteBetLadderMarkup(r1)));
    t(`abl.${kind}: vetoed → emitRuntime stub`, isEmpty(emitAnteBetLadderRuntime(r1)));
  } else if (r1.enabled === true) {
    t(`abl.${kind}: active → emitCSS non-empty`,    !isEmpty(emitAnteBetLadderCSS(r1)));
    t(`abl.${kind}: active → emitMarkup non-empty`, !isEmpty(emitAnteBetLadderMarkup(r1)));
    t(`abl.${kind}: active → emitRuntime non-empty`,!isEmpty(emitAnteBetLadderRuntime(r1)));
  }

  const rDeg = ablResolve(modelFor(kind, {
    anteBetLadder: { enabled: true, rungs: [VALID_LADDER_RUNGS[0]] },
  }));
  t(`abl.${kind}: single-rung degeneracy collapses`, rDeg.enabled === false,
    `expected disabled, got ${rDeg.enabled}`);
}

/* ── 3: legacy bonusBuy + anteBet regression (no LEGO-BUY interaction breaks them) */
console.log('  ─ regression: legacy bonusBuy + anteBet × kinds ─');
for (const kind of ALL_KINDS) {
  const vetoBB = profileVeto(kind, 'bonusBuy') === true;
  const vetoAB = profileVeto(kind, 'anteBet')  === true;

  /* Legacy bonusBuy on its own */
  const rBB = bbResolve(modelFor(kind, { features: [{ kind: 'bonus_buy', label: 'BB' }] }));
  if (vetoBB) {
    t(`bb.${kind}: topology veto wins`, rBB.enabled === false);
  } else {
    t(`bb.${kind}: feature auto-enable still works`, rBB.enabled === true);
  }

  /* Legacy anteBet on its own */
  const rAB = abResolve(modelFor(kind, { features: [{ kind: 'ante_bet' }] }));
  if (vetoAB) {
    t(`ab.${kind}: topology veto wins`, rAB.enabled === false);
  } else {
    t(`ab.${kind}: feature auto-enable still works`, rAB.enabled === true);
  }
}

/* ── 4: mutex correctness — bonusBuy/anteBet must STILL emit when
       menu/ladder are NOT enabled on the same kind ───────────────── */
console.log('  ─ mutex regression: single-button still works when menu disabled ─');
for (const kind of ALL_KINDS) {
  const vetoBB = profileVeto(kind, 'bonusBuy') === true;
  const vetoAB = profileVeto(kind, 'anteBet')  === true;

  const model = modelFor(kind, {
    features: [{ kind: 'bonus_buy', label: 'BB' }, { kind: 'ante_bet' }],
    /* No bonusBuyMenu / anteBetLadder block configured — legacy must
       continue to emit (when not topology-vetoed). */
  });
  const rBBM = bbmResolve(model);
  const rABL = ablResolve(model);
  const rBB  = bbResolve(model);
  const rAB  = abResolve(model);

  /* When menu auto-collapses (no tiers), bonusBuy MUST stay enabled
   * iff topology allows. This is the LEGO-BUY mutex fallback path. */
  if (!vetoBB) {
    t(`mutex.${kind}: bbm collapsed → bonusBuy still enabled`, rBB.enabled === true && rBBM.enabled === false);
  } else {
    t(`mutex.${kind}: both vetoed → both disabled`, rBB.enabled === false && rBBM.enabled === false);
  }
  if (!vetoAB) {
    t(`mutex.${kind}: abl collapsed → anteBet still enabled`, rAB.enabled === true && rABL.enabled === false);
  } else {
    t(`mutex.${kind}: both ladder vetoed → both disabled`, rAB.enabled === false && rABL.enabled === false);
  }
}

/* ── reporting ───────────────────────────────────────────────────── */
console.log(`\n=== Result: ${pass} pass / ${fail} fail across ${ALL_KINDS.length} kinds ===`);
if (fail > 0) {
  console.log('\n  Failures:');
  for (const f of failures) console.log(`    - ${f}`);
  process.exit(1);
}
process.exit(0);
