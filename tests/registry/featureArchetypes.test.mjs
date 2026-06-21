/**
 * tests/registry/featureArchetypes.test.mjs
 *
 * Wave UQ-6 (2026-06-21) — coverage for the 25-archetype catalog.
 *
 * Asserts:
 *   1. Catalog cardinality + immutability
 *   2. Per-archetype well-formed shape
 *   3. suggestArchetype() returns the right archetype for each canonical
 *      example (exact-example phase — must be 0.95)
 *   4. suggestArchetype() handles vendor-neutral GDD prose for each of the
 *      10 new archetypes (regex/intent phase — must be ≥ 0.55)
 *   5. findUnknownFeatures() returns sane suggestions on a synthetic model
 *   6. No archetype id, purpose, intentRegex source, or example contains
 *      vendor trademarks (rule_no_vendor_mentions enforcement)
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import {
  ARCHETYPES,
  ARCHETYPE_COUNT,
  ARCHETYPE_ALIASES,
  NON_ARCHETYPE_KINDS,
  suggestArchetype,
  findUnknownFeatures,
  getArchetype,
} from '../../src/registry/featureArchetypes.mjs';

/* ── Reference data ─────────────────────────────────────────────────── */

const VENDOR_FORBIDDEN = [
  'igt', 'pragmatic', 'cash[- ]?eruption', 'wolf[- ]?run', 'cleopatra',
  'buffalo', 'megaways', 'netent', 'microgaming', 'aristocrat',
  'novomatic', 'playtech', 'evolution', 'big[- ]?time[- ]?gaming',
  'reelplay', 'wazdan', 'scientific[- ]?games', 'light[- ]?and[- ]?wonder',
];
const VENDOR_RE = new RegExp(VENDOR_FORBIDDEN.join('|'), 'i');

/* Real-prose snippets, hand-written to mimic GDD wording WITHOUT vendor names */
const PROSE_CASES = [
  { archId: 'multiplier-trail',  prose: 'Each tumble in Free Spins increments the multiplier ladder by 1.' },
  { archId: 'feature-purchase',  prose: 'Player may use the bonus buy menu to purchase Free Spins for 80x bet.' },
  { archId: 'side-bet',          prose: 'The ante bet ladder boosts scatter weight by +25% at tier 2.' },
  { archId: 'weighted-wheel',    prose: 'Triggers a weighted wheel bonus with 12 segments of fixed prize values.' },
  { archId: 'variable-ways',     prose: 'Reels use variable reel heights; ways count varies up to 117,649 per spin.' },
  { archId: 'wild-multiplier',   prose: 'Every wild carries a multiplier of x2 through x10 applied to wins through it.' },
  { archId: 'stacked-symbols',   prose: 'Free Spins replace high symbols with full-reel stacks of the same kind.' },
  { archId: 'reel-extender',     prose: 'Each scatter on reel 5 grows the grid — extra rows are added until 7x7.' },
  { archId: 'morph-progressive', prose: 'Every tumble triggers symbol upgrade to the next tier in the ladder.' },
  { archId: 'gamble-double',     prose: 'After any win the player may risk the win on a red or black gamble feature.' },
];

/* ── Tests ──────────────────────────────────────────────────────────── */

test('ARCHETYPE_COUNT equals 28 after UQ-9 expansion', () => {
  assert.equal(ARCHETYPE_COUNT, 28, 'expected 28 archetypes (15 baseline + 10 UQ-6 + 3 UQ-9)');
  assert.equal(ARCHETYPES.length, ARCHETYPE_COUNT);
});

test('ARCHETYPES frozen — cannot be mutated', () => {
  assert.ok(Object.isFrozen(ARCHETYPES), 'ARCHETYPES must be Object.freeze()-d');
});

test('every archetype is well-formed (id, purpose, regex, hooks, flags, state, examples)', () => {
  for (const a of ARCHETYPES) {
    assert.ok(a.id && typeof a.id === 'string', 'id missing: ' + JSON.stringify(a));
    assert.ok(a.purpose && a.purpose.length >= 20, 'purpose too short for ' + a.id);
    assert.ok(a.intentRegex instanceof RegExp, 'intentRegex not RegExp: ' + a.id);
    assert.ok(Array.isArray(a.hooks) && a.hooks.length >= 1, 'hooks missing: ' + a.id);
    assert.ok(a.forceFlag && a.forceFlag.startsWith('__FORCE_'), 'forceFlag bad: ' + a.id);
    assert.ok(a.windowFlag && a.windowFlag.startsWith('__'), 'windowFlag bad: ' + a.id);
    assert.ok(a.stateShape && typeof a.stateShape === 'object', 'stateShape bad: ' + a.id);
    assert.ok(Array.isArray(a.examples) && a.examples.length >= 1, 'examples missing: ' + a.id);
  }
});

test('all archetype IDs are unique', () => {
  const ids = ARCHETYPES.map(a => a.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate id: ' + ids.join(','));
});

test('no vendor trademark leaks into id / purpose / regex / examples (rule_no_vendor_mentions)', () => {
  for (const a of ARCHETYPES) {
    assert.ok(!VENDOR_RE.test(a.id), 'vendor in id: ' + a.id);
    assert.ok(!VENDOR_RE.test(a.purpose), 'vendor in purpose of ' + a.id + ': ' + a.purpose);
    assert.ok(!VENDOR_RE.test(a.intentRegex.source), 'vendor in regex of ' + a.id);
    for (const e of a.examples) {
      assert.ok(!VENDOR_RE.test(e), 'vendor in example of ' + a.id + ': ' + e);
    }
  }
});

test('suggestArchetype returns 0.95 exact-example for each declared example', () => {
  for (const a of ARCHETYPES) {
    for (const ex of a.examples) {
      const r = suggestArchetype(ex);
      assert.ok(r, 'no suggestion for example ' + ex);
      assert.equal(r.archetype.id, a.id, `example "${ex}" mapped to ${r.archetype.id} not ${a.id}`);
      assert.equal(r.confidence, 0.95, 'confidence wrong for ' + ex);
      assert.equal(r.reason, 'exact-example');
    }
  }
});

test('suggestArchetype handles vendor-neutral GDD prose for each UQ-6 archetype', () => {
  for (const { archId, prose } of PROSE_CASES) {
    /* Use an unknown kind so the example phases are bypassed; force regex phase */
    const r = suggestArchetype('unknown_feature_kind_xyz', prose);
    assert.ok(r, 'no suggestion for prose hinting at ' + archId + ': "' + prose + '"');
    assert.equal(r.archetype.id, archId,
      `prose for ${archId} matched ${r.archetype.id} instead. Prose: "${prose}"`);
    assert.ok(r.confidence >= 0.55, 'confidence too low for ' + archId + ': ' + r.confidence);
  }
});

test('suggestArchetype returns null on empty/garbage input', () => {
  assert.equal(suggestArchetype(''), null);
  assert.equal(suggestArchetype(null), null);
  assert.equal(suggestArchetype(undefined), null);
  assert.equal(suggestArchetype('zzz_no_match_at_all_garbage_12345'), null);
});

test('getArchetype lookup works for all 25 IDs', () => {
  for (const a of ARCHETYPES) {
    const got = getArchetype(a.id);
    assert.equal(got, a, 'getArchetype mismatch for ' + a.id);
  }
  assert.equal(getArchetype('nonexistent-archetype'), null);
});

test('findUnknownFeatures surfaces suggestions for unknown kinds', () => {
  const fakeModel = {
    __activeFeatures__: [
      { kind: 'bonusBuyMenu' },           // matches feature-purchase example
      { kind: 'fortuneWheel' },           // matches weighted-wheel example
      { kind: 'someTotallyNewFeature' },  // unknown — no suggestion expected
    ],
    features: [],
    _gddProse: {
      someTotallyNewFeature: 'Player can gamble the win to double or nothing on a color pick.',
    },
  };
  const catalogFeatureKinds = new Set(['tumble', 'wildMultiplier']); // pretend only these are catalog-known
  const unknown = findUnknownFeatures(fakeModel, catalogFeatureKinds);

  assert.ok(unknown.length === 3, 'expected 3 unknown features, got ' + unknown.length);

  const bb = unknown.find(u => u.kind === 'bonusBuyMenu');
  assert.ok(bb && bb.suggestion, 'bonusBuyMenu must have suggestion');
  assert.equal(bb.suggestion.archetype.id, 'feature-purchase');

  const fw = unknown.find(u => u.kind === 'fortuneWheel');
  assert.ok(fw && fw.suggestion, 'fortuneWheel must have suggestion');
  assert.equal(fw.suggestion.archetype.id, 'weighted-wheel');

  const stnf = unknown.find(u => u.kind === 'someTotallyNewFeature');
  assert.ok(stnf && stnf.suggestion, 'prose-hint must yield a suggestion');
  assert.equal(stnf.suggestion.archetype.id, 'gamble-double');
});

/* ── UQ-9 coverage ──────────────────────────────────────────────────── */

test('UQ-9: ARCHETYPE_ALIASES is frozen + every alias target exists in catalog', () => {
  assert.ok(Object.isFrozen(ARCHETYPE_ALIASES));
  for (const [alias, targetId] of Object.entries(ARCHETYPE_ALIASES)) {
    assert.ok(getArchetype(targetId), `alias "${alias}" → unknown archetype "${targetId}"`);
  }
});

test('UQ-9: NON_ARCHETYPE_KINDS filter — suggestArchetype returns null', () => {
  const cases = [
    'bigWinTier', 'big_win_tier',
    'waysEval', 'ways_eval', 'payAnywhereEval', 'pay_anywhere_eval',
    'clusterPaysEval', 'cluster_pays_eval',
    'scatterPay', 'scatter_pay',
    'autoplay', 'realityCheck', 'reality_check',
    'featureGeneric', 'feature_generic',
  ];
  for (const k of cases) {
    assert.equal(suggestArchetype(k), null, 'expected null for NON_ARCHETYPE kind: ' + k);
  }
});

test('UQ-9: alias map routes top UQ-7 unknown kinds to right archetypes', () => {
  const cases = [
    ['freeSpins',               'fs-trigger'],
    ['free_spins',              'fs-trigger'],
    ['progressive_free_spins',  'fs-trigger'],
    ['jackpot',                 'jackpot-pool'],
    ['progressiveJackpot',      'jackpot-pool'],
    ['multiplier',              'multiplier-trail'],
    ['persistentMultiplier',    'multiplier-trail'],
    ['path_aware_multiplier',   'multiplier-trail'],
    ['gamble',                  'gamble-double'],
    ['cascade',                 'cascade-collapse'],
    ['lightning',               'boost-multiplier'],
    ['wheelBonus',              'weighted-wheel'],
    ['wheel_bonus',             'weighted-wheel'],
    ['wildReel',                'sticky-state'],
    ['wild_reel',               'sticky-state'],
    ['ways',                    'variable-ways'],
    ['superSymbol',             'super-symbol'],
    ['super_symbol',            'super-symbol'],
    ['winCap',                  'win-cap'],
    ['win_cap',                 'win-cap'],
  ];
  for (const [kind, expectedId] of cases) {
    const r = suggestArchetype(kind);
    assert.ok(r, 'no suggestion for ' + kind);
    assert.equal(r.archetype.id, expectedId,
      `${kind} → ${r.archetype.id} (expected ${expectedId})`);
    assert.ok(r.confidence >= 0.90, 'alias confidence should be ≥ 0.90, got ' + r.confidence);
  }
});

test('UQ-9: new archetypes (fs-trigger, win-cap, super-symbol) are present + well-formed', () => {
  for (const id of ['fs-trigger', 'win-cap', 'super-symbol']) {
    const a = getArchetype(id);
    assert.ok(a, 'missing UQ-9 archetype: ' + id);
    assert.ok(a.purpose.length > 0);
    assert.ok(a.intentRegex instanceof RegExp);
    assert.ok(Array.isArray(a.hooks) && a.hooks.length > 0);
    assert.ok(a.forceFlag.startsWith('__FORCE_'));
    assert.ok(a.windowFlag.startsWith('__'));
  }
});

test('UQ-9: prose snippets for fs-trigger / win-cap / super-symbol match', () => {
  const cases = [
    ['fs-trigger',   'Landing 3 scatters triggers the Free Spins round.'],
    ['win-cap',      'Game has a max win cap of 5000x bet — feature ends when hit.'],
    ['super-symbol', 'Reels can land a colossal symbol of 3x3 paying any position.'],
  ];
  for (const [archId, prose] of cases) {
    const r = suggestArchetype('unknown_feature_kind_xyz_' + archId, prose);
    assert.ok(r, 'no suggestion for ' + archId + ' prose: "' + prose + '"');
    assert.equal(r.archetype.id, archId,
      `prose for ${archId} matched ${r.archetype.id} instead`);
  }
});

test('every archetype hook name matches HookBus naming convention (lowerCamelCase, no spaces)', () => {
  const re = /^[a-z][a-zA-Z0-9]+$/;
  for (const a of ARCHETYPES) {
    for (const h of a.hooks) {
      assert.ok(re.test(h), 'bad hook name "' + h + '" in archetype ' + a.id);
    }
  }
});
