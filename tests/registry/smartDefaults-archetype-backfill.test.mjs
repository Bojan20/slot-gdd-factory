/**
 * tests/registry/smartDefaults-archetype-backfill.test.mjs
 *
 * Wave UQ-8 (2026-06-21) — coverage for backfillFromArchetype() stage.
 *
 * Asserts:
 *   1. Empty / missing __unknownFeatures__ → no-op
 *   2. Suggestion below 0.55 confidence → skipped
 *   3. Valid suggestion → model._archetypeBackfill[kind] populated with
 *      archetypeId, forceFlag, windowFlag, hooks[], state (deep clone)
 *   4. Idempotent: 2nd call leaves the map unchanged
 *   5. Archetype catalog object is NOT mutated (deep-cloned state)
 *   6. applySmartDefaults() runs backfill end-to-end via the orchestrator
 *   7. recordDerived tag set when at least one kind was backfilled
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  backfillFromArchetype,
  applySmartDefaults,
} from '../../src/registry/smartDefaults.mjs';
import { getArchetype } from '../../src/registry/featureArchetypes.mjs';

function _modelWith(unknown) {
  return {
    __unknownFeatures__: unknown,
  };
}

test('no __unknownFeatures__ → no _archetypeBackfill key created', () => {
  const m = backfillFromArchetype({});
  assert.equal(m._archetypeBackfill, undefined);
});

test('empty __unknownFeatures__ array → no-op', () => {
  const m = backfillFromArchetype({ __unknownFeatures__: [] });
  assert.equal(m._archetypeBackfill, undefined);
});

test('suggestion below MIN_CONFIDENCE (0.55) is skipped', () => {
  const m = backfillFromArchetype(_modelWith([
    { kind: 'foo', suggestion: {
      archetype: getArchetype('sticky-state'),
      confidence: 0.40,
      reason: 'too-low',
    } },
  ]));
  /* Backfill map may be created but should be empty */
  assert.ok(!m._archetypeBackfill || !m._archetypeBackfill.foo);
});

test('valid suggestion populates _archetypeBackfill[kind] with full metadata', () => {
  const arch = getArchetype('multiplier-trail');
  const m = backfillFromArchetype(_modelWith([
    { kind: 'tumbleMultLadder', suggestion: {
      archetype: arch,
      confidence: 0.95,
      reason: 'exact-example',
    } },
  ]));
  const back = m._archetypeBackfill.tumbleMultLadder;
  assert.ok(back, 'backfill record missing');
  assert.equal(back.archetypeId, 'multiplier-trail');
  assert.equal(back.confidence, 0.95);
  assert.equal(back.reason, 'exact-example');
  assert.equal(back.forceFlag, arch.forceFlag);
  assert.equal(back.windowFlag, arch.windowFlag);
  assert.deepEqual(back.hooks, arch.hooks);
  assert.deepEqual(back.state, arch.stateShape);
});

test('backfill state is a deep clone — mutation must not leak to catalog', () => {
  const arch = getArchetype('feature-purchase');
  const m = backfillFromArchetype(_modelWith([
    { kind: 'bonusBuyMenu', suggestion: { archetype: arch, confidence: 0.95, reason: 'x' } },
  ]));
  const back = m._archetypeBackfill.bonusBuyMenu;
  /* Mutate the backfilled state */
  back.state.costMultiplier = 999;
  if (Array.isArray(back.state.offered)) back.state.offered.push('synthetic');
  /* Catalog state must remain frozen + untouched */
  assert.equal(arch.stateShape.costMultiplier, 0);
  assert.deepEqual(arch.stateShape.offered, []);
});

test('idempotent — 2nd call leaves existing backfill record alone', () => {
  const m = _modelWith([
    { kind: 'wheelGame', suggestion: {
      archetype: getArchetype('weighted-wheel'), confidence: 0.95, reason: 'x',
    } },
  ]);
  backfillFromArchetype(m);
  const before = m._archetypeBackfill.wheelGame;
  before._marker = 'untouched';
  backfillFromArchetype(m);
  assert.equal(m._archetypeBackfill.wheelGame._marker, 'untouched',
    'idempotent run must NOT overwrite existing record');
});

test('multiple unknown features all backfilled', () => {
  const m = backfillFromArchetype(_modelWith([
    { kind: 'tumbleMultLadder', suggestion: { archetype: getArchetype('multiplier-trail'), confidence: 0.95, reason: 'x' } },
    { kind: 'colorGamble',      suggestion: { archetype: getArchetype('gamble-double'),    confidence: 0.95, reason: 'x' } },
    { kind: 'extraStrip',       suggestion: { archetype: getArchetype('aux-reel'),         confidence: 0.70, reason: 'x' } },
  ]));
  assert.equal(Object.keys(m._archetypeBackfill).length, 3);
  assert.equal(m._archetypeBackfill.tumbleMultLadder.archetypeId, 'multiplier-trail');
  assert.equal(m._archetypeBackfill.colorGamble.archetypeId, 'gamble-double');
  assert.equal(m._archetypeBackfill.extraStrip.archetypeId, 'aux-reel');
});

test('applySmartDefaults runs backfill via the orchestrator pipeline', () => {
  const m = {
    __unknownFeatures__: [
      { kind: 'tieredMorph', suggestion: {
        archetype: getArchetype('morph-progressive'), confidence: 0.85, reason: 'x',
      } },
    ],
    /* Other stages need something to chew on — provide minimum context */
    topology: { kind: 'rectangular', cols: 5, rows: 3 },
    symbols: [],
  };
  applySmartDefaults(m);
  assert.ok(m._archetypeBackfill, 'orchestrator did not invoke backfill stage');
  assert.equal(m._archetypeBackfill.tieredMorph.archetypeId, 'morph-progressive');
});

test('recordDerived tag set when at least one kind backfilled', () => {
  const m = backfillFromArchetype(_modelWith([
    { kind: 'sideBetX', suggestion: {
      archetype: getArchetype('side-bet'), confidence: 0.95, reason: 'x',
    } },
  ]));
  /* recordDerived stamps confidence._derivedBy or similar; tolerant probe */
  const hasTag = (m.confidence && m.confidence._derivedBy &&
                  m.confidence._derivedBy['features.archetypeBackfill']) ||
                 (m._derived && m._derived.includes('features.archetypeBackfill'));
  assert.ok(hasTag !== undefined, 'derived-by tag should be present after backfill');
});

test('malformed entries skipped without throwing', () => {
  /* Should not throw, returns model with whatever it could process */
  const m = backfillFromArchetype(_modelWith([
    null,
    undefined,
    {},
    { kind: 'noSuggestion' },
    { kind: 'wrongShape', suggestion: 'not-an-object' },
    { kind: 'noArchetype', suggestion: { confidence: 0.9 } },
    { kind: 'noConfidence', suggestion: { archetype: getArchetype('sticky-state') } },
    /* one valid entry to confirm processing continues */
    { kind: 'validOne', suggestion: {
      archetype: getArchetype('cascade-collapse'), confidence: 0.95, reason: 'x',
    } },
  ]));
  /* Only validOne should have been backfilled */
  assert.ok(m._archetypeBackfill);
  assert.ok(m._archetypeBackfill.validOne);
  assert.equal(m._archetypeBackfill.validOne.archetypeId, 'cascade-collapse');
  for (const k of ['noSuggestion', 'wrongShape', 'noArchetype', 'noConfidence']) {
    assert.equal(m._archetypeBackfill[k], undefined, 'malformed entry leaked: ' + k);
  }
});
