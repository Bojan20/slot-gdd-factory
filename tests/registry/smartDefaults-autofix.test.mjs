/**
 * tests/registry/smartDefaults-autofix.test.mjs
 *
 * Wave UQ-13 (2026-06-21) — coverage for autofixGaps() stage 6.
 *
 * Asserts:
 *   1. Empty symbols → 8-symbol placeholder roster + tag in
 *      confidence._autofixedBy.symbols.placeholder-roster
 *   2. Empty features → topology-keyed placeholder mix + tag
 *   3. Missing/partial bet → safe defaults filled + tag
 *   4. Missing paytable → stub from existing symbols + tag
 *   5. autofixGaps is idempotent — second run leaves data alone
 *   6. Engineer-provided data is NEVER overwritten
 *   7. applySmartDefaults orchestrator runs autofix as stage 6
 *   8. autofix tag is structurally distinct from _derivedBy tag
 *      (audits can tell the difference)
 *   9. Errors inside autofix don't throw — recorded in confidence._failures
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  autofixGaps,
  applySmartDefaults,
} from '../../src/registry/smartDefaults.mjs';

test('UQ-13: empty symbols → 8-symbol placeholder roster + autofix tag', () => {
  const m = {};
  autofixGaps(m);
  const total = (m.symbols.high || []).length + (m.symbols.mid || []).length +
                (m.symbols.low  || []).length + (m.symbols.specials || []).length;
  assert.equal(total, 8, 'expected 8 placeholder symbols, got ' + total);
  assert.equal(m.symbols.high.length, 3);
  assert.equal(m.symbols.mid.length, 3);
  assert.equal(m.symbols.low.length, 2);
  assert.ok(m.confidence._autofixedBy['symbols.placeholder-roster']);
});

test('UQ-13: empty features → topology-keyed placeholder mix + tag', () => {
  const m = { topology: { kind: 'cluster' } };
  autofixGaps(m);
  assert.ok(Array.isArray(m.features));
  assert.ok(m.features.length >= 1);
  const kinds = m.features.map(f => f.kind);
  assert.ok(kinds.includes('cluster_pays'), 'cluster topology mix should include cluster_pays');
  assert.ok(m.features.every(f => f._autofix === true), 'every autofix feature should carry _autofix flag');
  assert.ok(m.confidence._autofixedBy['features.placeholder-mix']);
});

test('UQ-13: bet defaults filled when missing entirely', () => {
  const m = {};
  autofixGaps(m);
  assert.ok(m.bet);
  assert.equal(m.bet.minBet, 0.10);
  assert.equal(m.bet.maxBet, 100);
  assert.equal(m.bet.defaultBet, 1.00);
  assert.equal(m.bet.currency, 'USD');
  assert.ok(m.confidence._autofixedBy['bet.defaults']);
});

test('UQ-13: partial bet config → only missing fields filled, existing preserved', () => {
  const m = { bet: { minBet: 0.25, defaultBet: 2.00 /* no maxBet, no currency */ } };
  autofixGaps(m);
  assert.equal(m.bet.minBet, 0.25, 'engineer minBet must NOT be overwritten');
  assert.equal(m.bet.defaultBet, 2.00, 'engineer defaultBet must NOT be overwritten');
  assert.equal(m.bet.maxBet, 100, 'missing maxBet should default to 100');
  assert.equal(m.bet.currency, 'USD');
  assert.ok(m.confidence._autofixedBy['bet.fields-completed']);
});

test('UQ-13: paytable stub generated from symbols when missing', () => {
  const m = {
    symbols: {
      high: [{ id: 'A', label: 'Ace' }, { id: 'K', label: 'King' }],
      mid:  [{ id: 'M1', label: 'Mid 1' }],
      low:  [],
      specials: [],
    },
  };
  autofixGaps(m);
  assert.ok(Array.isArray(m.paytable));
  assert.equal(m.paytable.length, 3);
  for (const row of m.paytable) {
    assert.ok(row.pay && Number.isFinite(row.pay['3']));
    assert.equal(row._autofix, true);
  }
  assert.ok(m.confidence._autofixedBy['paytable.placeholder-rows']);
});

test('UQ-13: idempotent — 2nd call does not duplicate or alter autofixed data', () => {
  const m = {};
  autofixGaps(m);
  const before = JSON.stringify(m.symbols);
  const beforeFeat = JSON.stringify(m.features);
  autofixGaps(m);
  assert.equal(JSON.stringify(m.symbols), before, 'symbols changed on 2nd run');
  assert.equal(JSON.stringify(m.features), beforeFeat, 'features changed on 2nd run');
});

test('UQ-13: engineer-provided data is NEVER overwritten', () => {
  const m = {
    symbols: { high: [{ id: 'Z', label: 'Zeus' }], mid: [], low: [], specials: [] },
    features: [{ kind: 'mysterySymbol', label: 'Mystery' }],
    paytable: [{ id: 'Z', pay: { '5': 500 } }],
    bet: { minBet: 1, maxBet: 50, defaultBet: 5, currency: 'EUR' },
  };
  autofixGaps(m);
  assert.equal(m.symbols.high.length, 1);
  assert.equal(m.symbols.high[0].id, 'Z');
  assert.equal(m.features.length, 1);
  assert.equal(m.features[0].kind, 'mysterySymbol');
  assert.equal(m.paytable.length, 1);
  assert.equal(m.bet.currency, 'EUR');
  /* No autofix tags should have been written since nothing was missing. */
  const tags = (m.confidence && m.confidence._autofixedBy) || {};
  assert.equal(Object.keys(tags).length, 0,
    'autofix tags should be empty when engineer data is present, got: ' + JSON.stringify(tags));
});

test('UQ-13: applySmartDefaults orchestrator runs autofix as stage 6', () => {
  /* Bare model — pipeline should produce a full renderable model end-to-end */
  const m = {};
  applySmartDefaults(m);
  assert.ok(m.symbols && (m.symbols.high.length + m.symbols.mid.length + m.symbols.low.length) > 0);
  assert.ok(Array.isArray(m.features) && m.features.length > 0);
  assert.ok(m.bet && Number.isFinite(m.bet.minBet));
  assert.ok(m.confidence._autofixedBy);
});

test('UQ-13: autofix tag is structurally distinct from _derivedBy tag', () => {
  const m = {};
  autofixGaps(m);
  /* derivedBy may or may not be set (no derivation stages ran); but the
     autofix tag must be a structured object with source + reason. */
  const tag = m.confidence._autofixedBy['symbols.placeholder-roster'];
  assert.ok(tag && typeof tag === 'object');
  assert.equal(tag.source, 'smartDefaults.autofix');
  assert.ok(typeof tag.reason === 'string' && tag.reason.length > 0);
});

test('UQ-13: errors inside autofix do not throw — recorded in _failures', () => {
  /* Force a failure by making symbols an object with throwing getter. */
  const m = {};
  Object.defineProperty(m, 'symbols', {
    get() { throw new Error('synthetic symbols access failure'); },
    configurable: true,
  });
  /* Should not throw */
  autofixGaps(m);
  /* Replace symbols with sane value before assertions so test runner can format */
  Object.defineProperty(m, 'symbols', { value: { high: [], mid: [], low: [], specials: [] }, writable: true });
  assert.ok(Array.isArray(m.confidence._failures));
  assert.ok(m.confidence._failures.some(f => f.label === 'smartDefaults.autofixGaps'));
});
