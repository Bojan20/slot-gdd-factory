/* eslint-disable no-console */
/**
 * Wave B64 — symbolUpgrade block unit tests.
 *
 * Coverage matrix:
 *   • defaultConfig stability + isolation
 *   • resolveConfig: probability clamp, maxPerTumble clamp, flashMs/morphMs
 *     clamp, flashColor RGB validation, eligibleTiers sanitization, ladder
 *     sanitization (dedupe, length cap, identity pair drop)
 *   • Auto-enable via feature.kind matching (symbol_upgrade / transmute /
 *     evolve / level-up-symbol)
 *   • Auto-disable on tumble-incompatible shapes (wheel, hex, plinko, …)
 *   • emitSymbolUpgradeCSS: disabled = stub, enabled = keyframes
 *   • emitSymbolUpgradeMarkup: always empty
 *   • emitSymbolUpgradeRuntime: disabled stub vs enabled bus listeners
 *   • LEGO discipline: event ownership ALL emits in this block, registers
 *     preSpin + onTumbleStep + postSpin + onFsEnd listeners
 *   • Vendor-neutral: no game / studio names
 *   • Accessibility: prefers-reduced-motion guard present
 *   • Boki rules: senior-grade JSDoc header markers, force hook real path
 */
import {
  defaultConfig,
  resolveConfig,
  emitSymbolUpgradeCSS,
  emitSymbolUpgradeMarkup,
  emitSymbolUpgradeRuntime,
} from '../../src/blocks/symbolUpgrade.mjs';

let pass = 0, fail = 0;
const t = (n, fn) => {
  try { fn(); console.log('  ✓', n); pass++; }
  catch (e) { console.log('  ✗', n, '\n     ', e.message); fail++; }
};
const eq  = (a, b, m = '') => { if (a !== b) throw new Error(`expected ${JSON.stringify(b)}, got ${JSON.stringify(a)} — ${m}`); };
const ok  = (c, m = '') => { if (!c) throw new Error(`expected truthy — ${m}`); };
const ct  = (s, n, m = '') => { if (!String(s).includes(n)) throw new Error(`missing substring ${JSON.stringify(n)} — ${m}`); };
const nct = (s, n, m = '') => { if (String(s).includes(n)) throw new Error(`unexpected substring ${JSON.stringify(n)} — ${m}`); };

console.log('— blocks/symbolUpgrade.mjs —');

/* ── defaultConfig + resolveConfig ─────────────────────────────── */

t('defaultConfig: stable shape', () => {
  const c = defaultConfig();
  eq(c.enabled, false);
  eq(c.probability, 0.06);
  eq(c.maxPerTumble, 2);
  eq(c.flashColor, '255,210,90');
  eq(c.flashMs, 480);
  eq(c.morphMs, 220);
  eq(c.bonusAccumulate, true);
  ok(Array.isArray(c.eligibleTiers));
  eq(c.eligibleTiers.length, 2);
  eq(c.eligibleTiers[0], 'low');
  eq(c.eligibleTiers[1], 'mid');
  eq(c.ladder, null);
});

t('defaultConfig: returns isolated arrays', () => {
  const a = defaultConfig();
  const b = defaultConfig();
  ok(a !== b);
  ok(a.eligibleTiers !== b.eligibleTiers);
  a.eligibleTiers.push('high');
  eq(b.eligibleTiers.length, 2, 'mutation does not leak');
});

t('resolveConfig: empty model → defaults', () => {
  const c = resolveConfig({});
  eq(c.enabled, false);
  eq(c.probability, 0.06);
});

t('resolveConfig: enabled true honored', () => {
  eq(resolveConfig({ symbolUpgrade: { enabled: true } }).enabled, true);
});

t('resolveConfig: probability clamped to [0,1]', () => {
  eq(resolveConfig({ symbolUpgrade: { probability: 0.3 } }).probability, 0.3);
  eq(resolveConfig({ symbolUpgrade: { probability: -1 } }).probability, 0);
  eq(resolveConfig({ symbolUpgrade: { probability: 9 } }).probability, 1);
  eq(resolveConfig({ symbolUpgrade: { probability: 'nope' } }).probability, 0.06);
});

t('resolveConfig: maxPerTumble integer + out-of-range → default', () => {
  eq(resolveConfig({ symbolUpgrade: { maxPerTumble: 5 } }).maxPerTumble, 5);
  /* Defence-in-depth: out-of-range falls back to the safe default (2),
     not to the boundary. Surprises the GDD author at QA time, never at
     runtime. */
  eq(resolveConfig({ symbolUpgrade: { maxPerTumble: 0 } }).maxPerTumble, 2);
  eq(resolveConfig({ symbolUpgrade: { maxPerTumble: 9999 } }).maxPerTumble, 2);
  eq(resolveConfig({ symbolUpgrade: { maxPerTumble: 'bad' } }).maxPerTumble, 2);
});

t('resolveConfig: flashMs / morphMs bounded', () => {
  eq(resolveConfig({ symbolUpgrade: { flashMs: 1500 } }).flashMs, 1500);
  eq(resolveConfig({ symbolUpgrade: { flashMs: 50 } }).flashMs, 480);
  eq(resolveConfig({ symbolUpgrade: { flashMs: 99999 } }).flashMs, 480);
  eq(resolveConfig({ symbolUpgrade: { morphMs: 500 } }).morphMs, 500);
  eq(resolveConfig({ symbolUpgrade: { morphMs: 10 } }).morphMs, 220);
});

t('resolveConfig: flashColor RGB validation', () => {
  eq(resolveConfig({ symbolUpgrade: { flashColor: '100,150,200' } }).flashColor, '100,150,200');
  eq(resolveConfig({ symbolUpgrade: { flashColor: 'gold' } }).flashColor, '255,210,90');
  eq(resolveConfig({ symbolUpgrade: { flashColor: '999,1,2' } }).flashColor, '255,210,90');
  /* Spaces are squashed during sanitisation. */
  eq(resolveConfig({ symbolUpgrade: { flashColor: '10, 20, 30' } }).flashColor, '10,20,30');
});

t('resolveConfig: eligibleTiers filtered to known tiers', () => {
  const a = resolveConfig({ symbolUpgrade: { eligibleTiers: ['low', 'special', 'foo'] } });
  eq(a.eligibleTiers.length, 1);
  eq(a.eligibleTiers[0], 'low');
  /* Empty / invalid → fall back to defaults (low + mid). */
  const b = resolveConfig({ symbolUpgrade: { eligibleTiers: [] } });
  eq(b.eligibleTiers.length, 2);
});

t('resolveConfig: ladder sanitisation', () => {
  const r = resolveConfig({
    symbolUpgrade: {
      ladder: [
        { from: 'A', to: 'B' },
        { from: 'A', to: 'B' },         // dedupe
        { from: 'C', to: 'C' },         // identity drop
        { from: '', to: 'Z' },          // malformed
        { from: 'D', to: 'E' },
      ],
    },
  });
  eq(r.ladder.length, 2);
  eq(r.ladder[0].from, 'A');
  eq(r.ladder[1].from, 'D');
});

t('resolveConfig: ladder rejects non-array', () => {
  eq(resolveConfig({ symbolUpgrade: { ladder: 'oops' } }).ladder, null);
});

t('resolveConfig: feature.kind auto-enables', () => {
  const cases = [
    'symbol_upgrade', 'symbol-upgrade', 'SymbolUpgrade',
    'transmute', 'evolve', 'level_up_symbol', 'level-up-symbol',
  ];
  for (const kind of cases) {
    const c = resolveConfig({ features: [{ kind }] });
    ok(c.enabled, `auto-enable for kind=${kind}`);
  }
  /* Unrelated kinds must NOT auto-enable. */
  const c0 = resolveConfig({ features: [{ kind: 'tumble' }] });
  eq(c0.enabled, false);
});

t('resolveConfig: tumble-incompatible shapes force-disable', () => {
  for (const kind of ['wheel', 'hex', 'hexagonal', 'plinko', 'crash', 'slingo', 'radial']) {
    const c = resolveConfig({
      shape: { kind },
      symbolUpgrade: { enabled: true },
    });
    eq(c.enabled, false, `shape ${kind} must force-disable`);
  }
});

t('resolveConfig: topology.kind also triggers shape gate', () => {
  const c = resolveConfig({
    topology: { kind: 'wheel' },
    symbolUpgrade: { enabled: true },
  });
  eq(c.enabled, false);
});

/* ── emit CSS ──────────────────────────────────────────────────── */

t('emitSymbolUpgradeCSS: disabled → stub', () => {
  const out = emitSymbolUpgradeCSS({ enabled: false });
  ct(out, 'disabled by GDD');
  nct(out, '@keyframes');
});

t('emitSymbolUpgradeCSS: enabled → keyframes + class rules', () => {
  const out = emitSymbolUpgradeCSS({ enabled: true });
  ct(out, '@keyframes symbolUpgradeFlash');
  ct(out, '@keyframes symbolUpgradeMorph');
  ct(out, '.cell.is-upgrading');
  ct(out, 'prefers-reduced-motion');
});

t('emitSymbolUpgradeCSS: flashColor baked', () => {
  const out = emitSymbolUpgradeCSS({ enabled: true, flashColor: '12,34,56' });
  ct(out, '12,34,56');
});

/* ── markup ────────────────────────────────────────────────────── */

t('emitSymbolUpgradeMarkup: always empty (decorator block)', () => {
  eq(emitSymbolUpgradeMarkup({ enabled: true }), '');
  eq(emitSymbolUpgradeMarkup({ enabled: false }), '');
});

/* ── runtime ───────────────────────────────────────────────────── */

t('emitSymbolUpgradeRuntime: disabled → stub + force noop', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: false });
  ct(out, '__SYMBOL_UPGRADE_ENABLED__ = false');
  ct(out, 'symbolUpgradeForceAt');
  nct(out, "HookBus.on('preSpin'");
});

t('emitSymbolUpgradeRuntime: enabled wires all 4 lifecycle listeners', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: true });
  ct(out, "HookBus.on('preSpin'");
  ct(out, "HookBus.on('onTumbleStep'");
  ct(out, "HookBus.on('postSpin'");
  ct(out, "HookBus.on('onFsEnd'");
});

t('emitSymbolUpgradeRuntime: emits exactly the two owned events', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: true });
  ct(out, "HookBus.emit('onSymbolUpgrade'");
  ct(out, "HookBus.emit('onSymbolUpgradeCascade'");
  /* Should NEVER emit any non-owned event. */
  nct(out, "HookBus.emit('preSpin'");
  nct(out, "HookBus.emit('onTumbleStep'");
});

t('emitSymbolUpgradeRuntime: knobs baked into source literal', () => {
  const out = emitSymbolUpgradeRuntime({
    enabled: true,
    probability: 0.42,
    maxPerTumble: 7,
    flashMs: 700,
    morphMs: 300,
  });
  ct(out, 'SYMBOL_UPGRADE_PROBABILITY  = 0.42');
  ct(out, 'SYMBOL_UPGRADE_MAX_PER_TUMBLE = 7');
  ct(out, 'SYMBOL_UPGRADE_FLASH_MS     = 700');
  ct(out, 'SYMBOL_UPGRADE_MORPH_MS     = 300');
});

t('emitSymbolUpgradeRuntime: ladder GDD wins over runtime derivation', () => {
  const out = emitSymbolUpgradeRuntime({
    enabled: true,
    ladder: [{ from: 'L1', to: 'M1' }],
  });
  ct(out, '"from":"L1"');
  ct(out, '"to":"M1"');
});

t('emitSymbolUpgradeRuntime: exposes window.__SYMBOL_UPGRADE_FS__ for FS aggregate', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: true });
  ct(out, '__SYMBOL_UPGRADE_FS__');
  ct(out, 'IN_FREE_SPINS');
});

t('emitSymbolUpgradeRuntime: force hook routes through real upgrade path', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: true });
  /* The force entry must call _suPerformUpgrade rather than direct
     bypass, mirroring the rule_force_buttons_real_spin contract. */
  ct(out, '_suPerformUpgrade(cellEl, { forced: true })');
});

/* ── LEGO + vendor neutrality ──────────────────────────────────── */

t('source: vendor-neutral (no studios / game names)', () => {
  const out = emitSymbolUpgradeRuntime({ enabled: true })
            + emitSymbolUpgradeCSS({ enabled: true });
  const lower = out.toLowerCase();
  for (const bad of [
    'gates of olympus', 'wrath of olympus', 'reactoonz', 'sweet bonanza',
    'sugar rush', 'megaways', 'netent', 'microgaming', 'pragmatic',
    'lightning link', 'cleopatra', 'buffalo', 'cash eruption',
  ]) {
    nct(lower, bad, `vendor mention: ${bad}`);
  }
});

/* ── done ──────────────────────────────────────────────────────── */

console.log(`\n  ${pass} pass / ${fail} fail`);
if (fail > 0) process.exit(1);
