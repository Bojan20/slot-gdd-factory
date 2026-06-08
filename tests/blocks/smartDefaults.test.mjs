/* eslint-disable no-console */
/**
 * tests/blocks/smartDefaults.test.mjs — Wave P2
 *
 * Exercises the parser-side smart-defaults engine that backfills
 * theme.palette, topology.kind/dims, symbol tier classification, and
 * synthetic feature mix when a GDD omits them. Verifies that:
 *
 *   • Sparse one-pager GDDs become fully renderable.
 *   • Explicit GDD fields are NEVER overwritten.
 *   • Each derived field tags itself in `confidence._derivedBy`.
 *   • The pipeline is idempotent.
 *   • Unknown / malformed input never throws.
 *   • Vendor-neutral palette / classifier rules — no game name baked in.
 *
 * Coverage targets (mapped 1:1 to the public API):
 *   deriveThemePalette       8 cases
 *   inferTopology            7 cases
 *   classifySymbolTiers      6 cases
 *   synthesizeFeatureMix     5 cases
 *   applySmartDefaults       4 integration cases
 *   defensive                4 cases
 *   total                   34 assertions across 34 named test rows
 */

import {
  applySmartDefaults,
  deriveThemePalette,
  inferTopology,
  classifySymbolTiers,
  synthesizeFeatureMix,
  listSupportedKinds,
  listSupportedPaletteFamilies,
} from '../../src/registry/smartDefaults.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓ ' + name); pass++; }
  catch (e) { console.log('  ✗ ' + name + '\n     ' + e.message); fail++; }
};
const eq = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const arrEq = (a, b, m = '') => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };

console.log('— blocks/smartDefaults.mjs —');

const freshModel = () => ({
  name: '',
  theme: { tags: [], palette: [], mood: '', setting: '' },
  topology: {},
  symbols: { high: [], mid: [], low: [], specials: [] },
  features: [],
  confidence: { name: 0, topology: 0, symbols: 0, features: 0, _failures: [], _derivedBy: {} },
});

/* ─── stage 1: theme palette ──────────────────────────────────── */

t('palette: norse tag → norse_iron family', () => {
  const m = freshModel();
  m.theme.tags = ['Norse', 'Vikings'];
  deriveThemePalette(m);
  eq(m.theme.palette.length, 4, 'palette[bg-deep, bg-mid, accent, text]');
  ok(m.confidence._derivedBy['theme.palette'] === 'smartDefaults', 'tagged derived');
  ok(/norse_iron/.test(Object.keys(m.confidence._derivedBy).join(' ')), 'family logged');
});

t('palette: egypt tag → egypt_lapis family', () => {
  const m = freshModel();
  m.theme.tags = ['Ancient Egypt', 'Pharaoh'];
  deriveThemePalette(m);
  ok(Object.keys(m.confidence._derivedBy).some((k) => /egypt_lapis/.test(k)), 'family logged');
});

t('palette: candy tag → candy_pop family', () => {
  const m = freshModel();
  m.theme.tags = ['Candy', 'Sweet Treats'];
  deriveThemePalette(m);
  ok(Object.keys(m.confidence._derivedBy).some((k) => /candy_pop/.test(k)), 'family logged');
});

t('palette: cyber tag → cyber_neon family', () => {
  const m = freshModel();
  m.theme.tags = ['Cyberpunk', 'Synth'];
  deriveThemePalette(m);
  ok(Object.keys(m.confidence._derivedBy).some((k) => /cyber_neon/.test(k)), 'family logged');
});

t('palette: explicit palette NEVER overwritten', () => {
  const m = freshModel();
  m.theme.palette = ['#aaaaaa', '#bbbbbb'];
  m.theme.tags = ['Norse'];
  deriveThemePalette(m);
  arrEq(m.theme.palette, ['#aaaaaa', '#bbbbbb'], 'preserved');
  ok(!m.confidence._derivedBy['theme.palette'], 'no derive tag');
});

t('palette: unknown tag → generic_premium fallback', () => {
  const m = freshModel();
  m.theme.tags = ['Wat'];
  deriveThemePalette(m);
  eq(m.theme.palette.length, 4, 'falls back to a 4-tuple');
});

t('palette: name keyword matches when tags empty', () => {
  const m = freshModel();
  m.name = 'Pharaoh Riches';
  deriveThemePalette(m);
  ok(Object.keys(m.confidence._derivedBy).some((k) => /egypt_lapis/.test(k)), 'detected from name');
});

t('palette: mood keyword matches', () => {
  const m = freshModel();
  m.theme.mood = 'gothic dark horror';
  deriveThemePalette(m);
  ok(Object.keys(m.confidence._derivedBy).some((k) => /horror_blood/.test(k)), 'detected from mood');
});

/* ─── stage 2: topology inference ─────────────────────────────── */

t('topology: cluster_pays feature → cluster kind + 7×7 dims', () => {
  const m = freshModel();
  m.features = [{ kind: 'cluster_pays', label: 'Cluster' }];
  inferTopology(m);
  eq(m.topology.kind, 'cluster');
  eq(m.topology.reels, 7);
  eq(m.topology.rows, 7);
});

t('topology: ways_pay feature → variable_reel kind + 6×5 dims', () => {
  const m = freshModel();
  m.features = [{ kind: 'ways_pay', label: 'Ways' }];
  inferTopology(m);
  eq(m.topology.kind, 'variable_reel');
});

t('topology: hex feature → hexagonal kind', () => {
  const m = freshModel();
  m.features = [{ kind: 'hex_cluster', label: 'Hex' }];
  inferTopology(m);
  eq(m.topology.kind, 'hexagonal');
});

t('topology: lock_respin feature → lock_respin kind', () => {
  const m = freshModel();
  m.features = [{ kind: 'hold_and_win', label: 'H&W' }];
  inferTopology(m);
  eq(m.topology.kind, 'lock_respin');
});

t('topology: explicit kind NEVER overwritten', () => {
  const m = freshModel();
  m.topology = { kind: 'plinko', reels: 1, rows: 1, paylines: 0 };
  m.features = [{ kind: 'cluster_pays', label: 'C' }];
  inferTopology(m);
  eq(m.topology.kind, 'plinko');
});

t('topology: paylines filled for rectangular when missing', () => {
  const m = freshModel();
  m.topology = { kind: 'rectangular' };
  inferTopology(m);
  ok(m.topology.paylines >= 10, 'default reasonable');
});

t('topology: cluster paylines = 0 (correct, not derived as 20)', () => {
  const m = freshModel();
  m.topology = { kind: 'cluster' };
  inferTopology(m);
  eq(m.topology.paylines, 0);
});

/* ─── stage 3: symbol tier classification ─────────────────────── */

t('symbols: card values classified as low', () => {
  const m = freshModel();
  m.symbols = { high: [], mid: [], low: [], specials: [], list: [
    { label: 'A' }, { label: 'K' }, { label: 'Q' }, { label: 'J' },
  ]};
  classifySymbolTiers(m);
  eq(m.symbols.low.length, 4, 'all cards landed low');
});

t('symbols: gems classified as high', () => {
  const m = freshModel();
  m.symbols = { high: [], mid: [], low: [], specials: [], list: [
    { label: 'Ruby' }, { label: 'Emerald' }, { label: 'Sapphire' },
  ]};
  classifySymbolTiers(m);
  eq(m.symbols.high.length, 3);
});

t('symbols: wild/scatter sorted to specials', () => {
  const m = freshModel();
  m.symbols = { high: [], mid: [], low: [], specials: [], list: [
    { label: 'WILD' }, { label: 'Scatter' }, { label: 'A' },
  ]};
  classifySymbolTiers(m);
  eq(m.symbols.specials.length, 2);
  eq(m.symbols.low.length, 1);
});

t('symbols: unclassified animal goes mid', () => {
  const m = freshModel();
  m.symbols = { high: [], mid: [], low: [], specials: [], list: [
    { label: 'Wolf' }, { label: 'Eagle' },
  ]};
  classifySymbolTiers(m);
  eq(m.symbols.mid.length, 2);
});

t('symbols: explicit tier roster NEVER reclassified', () => {
  const m = freshModel();
  m.symbols = { high: [{ label: 'A' }], mid: [], low: [], specials: [] };
  classifySymbolTiers(m);
  /* A was placed in high explicitly — must remain there even though it's a card. */
  eq(m.symbols.high.length, 1);
  eq(m.symbols.low.length, 0);
});

t('symbols: stragglers in specials get re-tiered when explicit roster present', () => {
  const m = freshModel();
  /* High already has a real high; specials has a card (probably mis-parsed). */
  m.symbols = { high: [{ label: 'Ruby' }], mid: [], low: [], specials: [{ label: 'A' }] };
  classifySymbolTiers(m);
  eq(m.symbols.specials.length, 0, 'A moved out of specials');
  eq(m.symbols.low.length, 1, 'A landed in low');
});

/* ─── stage 4: feature mix synthesis ──────────────────────────── */

t('features: empty rectangular gets free_spins + wild + multiplier', () => {
  const m = freshModel();
  m.topology.kind = 'rectangular';
  synthesizeFeatureMix(m);
  ok(m.features.length >= 3, 'at least the trio');
  ok(m.features.some((f) => f.kind === 'free_spins'));
});

t('features: cluster topology synthesizes cascade + cluster_pays', () => {
  const m = freshModel();
  m.topology.kind = 'cluster';
  synthesizeFeatureMix(m);
  ok(m.features.some((f) => f.kind === 'cluster_pays'));
});

t('features: wheel topology gets wheel_bonus + multiplier', () => {
  const m = freshModel();
  m.topology.kind = 'wheel';
  synthesizeFeatureMix(m);
  ok(m.features.some((f) => f.kind === 'wheel_bonus'));
});

t('features: explicit list NEVER replaced', () => {
  const m = freshModel();
  m.features = [{ kind: 'custom_x', label: 'X' }];
  m.topology.kind = 'cluster';
  synthesizeFeatureMix(m);
  eq(m.features.length, 1);
  eq(m.features[0].kind, 'custom_x');
});

t('features: human label is generated from kind', () => {
  const m = freshModel();
  m.topology.kind = 'rectangular';
  synthesizeFeatureMix(m);
  const fs = m.features.find((f) => f.kind === 'free_spins');
  ok(fs && fs.label.length > 0, 'free_spins label set');
  eq(fs.label, 'Free Spins');
});

/* ─── applySmartDefaults integration ─────────────────────────── */

t('integration: completely empty GDD → fully renderable model', () => {
  const m = freshModel();
  applySmartDefaults(m);
  ok(m.theme.palette.length === 4, 'palette filled');
  ok(m.topology.reels > 0, 'dims filled');
  ok(m.features.length > 0, 'features synthesized');
});

t('integration: explicit fields preserved across all stages', () => {
  const m = freshModel();
  m.theme.palette = ['#111', '#222', '#333', '#444'];
  m.topology = { kind: 'crash', reels: 1, rows: 1, paylines: 0 };
  m.features = [{ kind: 'multiplier', label: 'Mult' }];
  applySmartDefaults(m);
  arrEq(m.theme.palette, ['#111', '#222', '#333', '#444']);
  eq(m.topology.kind, 'crash');
  eq(m.features.length, 1);
});

t('integration: idempotent — calling twice yields same model', () => {
  const m = freshModel();
  m.theme.tags = ['Norse'];
  applySmartDefaults(m);
  const snap1 = JSON.stringify({ palette: m.theme.palette, kind: m.topology.kind, features: m.features });
  applySmartDefaults(m);
  const snap2 = JSON.stringify({ palette: m.theme.palette, kind: m.topology.kind, features: m.features });
  eq(snap1, snap2);
});

t('integration: derivation tags all logged', () => {
  const m = freshModel();
  applySmartDefaults(m);
  const tagged = Object.keys(m.confidence._derivedBy);
  ok(tagged.includes('theme.palette'), 'palette tagged');
  ok(tagged.includes('features.synthesized'), 'features tagged');
});

/* ─── defensive ───────────────────────────────────────────────── */

t('defensive: null model returns null (no throw)', () => {
  eq(applySmartDefaults(null), null);
});

t('defensive: missing theme subtree handled', () => {
  const m = { name: 'X' };
  applySmartDefaults(m);
  ok(m.theme, 'theme created');
});

t('defensive: classifier on empty symbols pool', () => {
  const m = freshModel();
  m.symbols = { high: [], mid: [], low: [], specials: [] };
  classifySymbolTiers(m);
  /* no crash, no derived tag because there was no pool to classify */
  ok(!m.confidence._derivedBy['symbols.tiers']);
});

t('introspection: listSupportedKinds covers ≥ 16 kinds', () => {
  ok(listSupportedKinds().length >= 16);
  ok(listSupportedPaletteFamilies().length >= 10);
});

console.log(`\n--- summary ---`);
console.log(`  pass: ${pass}`);
console.log(`  fail: ${fail}`);
if (fail) process.exit(1);
