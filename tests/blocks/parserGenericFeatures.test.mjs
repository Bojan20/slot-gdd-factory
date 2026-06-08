/* eslint-disable no-console */
/**
 * Wave P6 — Generic feature fallback (`feature_generic`).
 *
 * Contract under test:
 *   - GDD-i koji pominju feature kojeg ~50 patterns iz `extractFeatures`
 *     ne hvata MORAJU da dobiju `kind: 'feature_generic'` entry sa
 *     verbatim labelom — nikad tihi drop.
 *   - Discovery surfaces:
 *       (a) `## X Feature` / `## X Mechanic` / `## X Bonus` headings
 *       (b) `**X Feature**` bold tags
 *       (c) `- X Mechanic` bullets pod "Features" / "Mechanics" sekcijama
 *   - Dedup protiv known kinds (Free Spins, Wild, Multiplier ne sme da
 *     se dupli kao generic).
 *   - Negation sekcije (`## Out of scope`) i dalje važe — nepoznata
 *     featura u negiranoj sekciji se NE registruje.
 *   - Cap na 12 discovered po GDD-u (sane upper bound).
 *   - Idempotency: drugi prolaz vraća isti broj generic-a.
 *   - Robustness: prazan / null / non-string input → `[]`, ne baca.
 *
 * Why it matters:
 *   "nikad crveno ni za izmišljeni feature" — Master TODO P6.
 *   Player playable template ne sme da padne kada GDD lista "PsyOps
 *   Rain" ili "Quantum Pulse" — feature_generic kind je catch-all sa
 *   verbatim labelom za UI.
 */
import { extractGenericFeatures, extractFeatures, parseMarkdownGDD } from '../../src/parser.mjs';

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('Wave P6 — Generic feature fallback');

/* ─── extractGenericFeatures isolation ─────────────────────────── */

t('null / undefined / non-string returns []', () => {
  assert(Array.isArray(extractGenericFeatures(null)));
  assert(extractGenericFeatures(null).length === 0);
  assert(extractGenericFeatures(undefined).length === 0);
  assert(extractGenericFeatures(123).length === 0);
  assert(extractGenericFeatures({}).length === 0);
  assert(extractGenericFeatures([]).length === 0);
});

t('empty / whitespace string returns []', () => {
  assert(extractGenericFeatures('').length === 0);
  assert(extractGenericFeatures('   \n\n  ').length === 0);
});

t('discovers `## PsyOps Rain Feature` heading', () => {
  const md = '# Game\n\n## PsyOps Rain Feature\n\nPlayer drops cards.';
  const out = extractGenericFeatures(md);
  assert(out.length >= 1, `expected ≥1, got ${out.length}`);
  assert(out.some(f => /PsyOps Rain/i.test(f.label)), `got labels: ${out.map(f=>f.label)}`);
  assert(out.every(f => f.kind === 'feature_generic'));
  assert(out.every(f => f._discovered === true));
});

t('discovers `## Quantum Pulse Mechanic` heading', () => {
  const md = '## Quantum Pulse Mechanic\n\nReels resonate.';
  const out = extractGenericFeatures(md);
  assert(out.some(f => /Quantum Pulse/i.test(f.label)));
});

t('discovers `## Dimensional Rift Bonus` heading', () => {
  const md = '## Dimensional Rift Bonus\n\nRift opens.';
  const out = extractGenericFeatures(md);
  assert(out.some(f => /Dimensional Rift/i.test(f.label)));
});

t('discovers `**Hyperdrive Mechanic**` bold tag', () => {
  const md = 'Normal prose. Then **Hyperdrive Mechanic** kicks in.';
  const out = extractGenericFeatures(md);
  assert(out.some(f => /Hyperdrive Mechanic/i.test(f.label)));
});

t('discovers bullets under `## Features` section', () => {
  const md = `
## Features

- Aether Surge Mechanic
- Void Echo Feature
- Phase Lock Bonus
`;
  const out = extractGenericFeatures(md);
  const labels = out.map(f => f.label).join('|');
  assert(/Aether Surge/i.test(labels), `missing Aether Surge in ${labels}`);
  assert(/Void Echo/i.test(labels), `missing Void Echo in ${labels}`);
});

t('does NOT pick up known features (Free Spins / Wild / Multiplier)', () => {
  const md = '## Free Spins Feature\n\n## Wild Feature\n\n## Multiplier Mechanic\n';
  const known = new Set(['Free Spins', 'Wild', 'Multiplier']);
  const out = extractGenericFeatures(md, known);
  for (const f of out) {
    assert(!/^(Free Spins|Wild|Multiplier)/i.test(f.label),
      `should skip known feature, got: ${f.label}`);
  }
});

t('respects "## Out of scope" negation sections', () => {
  const md = `
## Out of scope

- Hyperdrive Mechanic (not in this product)
- Tachyon Feature (deferred to v2)

## Real Features

- Aether Surge Mechanic
`;
  const out = extractGenericFeatures(md);
  const labels = out.map(f => f.label).join('|');
  assert(!/Hyperdrive/i.test(labels), `negated feature leaked: ${labels}`);
  assert(!/Tachyon/i.test(labels), `negated feature leaked: ${labels}`);
  assert(/Aether Surge/i.test(labels), `real feature missing: ${labels}`);
});

t('dedupes case-insensitive same-label discovery', () => {
  const md = `
## Aether Surge Mechanic

**Aether Surge Mechanic** repeats.

## Features

- Aether Surge Mechanic
`;
  const out = extractGenericFeatures(md);
  const aether = out.filter(f => /aether surge/i.test(f.label));
  assert(aether.length === 1, `expected 1 Aether Surge entry, got ${aether.length}`);
});

t('blocklist filters pure noise tokens', () => {
  const md = `
## Feature

## Mechanic

**Feature** standalone.

- Bonus
- The Feature
`;
  const out = extractGenericFeatures(md);
  /* All these are explicitly in _GENERIC_FEATURE_BLOCKLIST so out should be empty. */
  assert(out.length === 0, `expected 0 noise, got ${out.length}: ${out.map(f => f.label).join('|')}`);
});

t('caps at 12 discovered generics per GDD', () => {
  let md = '## Features\n\n';
  for (let i = 1; i <= 30; i++) {
    md += `- Synthetic Feature ${i} Mechanic\n`;
  }
  const out = extractGenericFeatures(md);
  assert(out.length <= 12, `expected ≤12, got ${out.length}`);
});

t('idempotent — second pass yields same generics', () => {
  const md = `
## PsyOps Rain Feature
**Quantum Pulse Mechanic** activates.
- Void Echo Feature
`;
  const a = extractGenericFeatures(md);
  const b = extractGenericFeatures(md);
  assert(a.length === b.length, `count diff: ${a.length} vs ${b.length}`);
  assert(JSON.stringify(a) === JSON.stringify(b), 'JSON diff');
});

t('label too short / too long skipped', () => {
  const md = `
## ab Feature
## ${'x'.repeat(80)} Feature
## Mid Length Feature
`;
  const out = extractGenericFeatures(md);
  const labels = out.map(f => f.label);
  assert(!labels.some(l => l.length < 3), `short label leaked: ${labels}`);
  assert(!labels.some(l => l.length > 60), `long label leaked: ${labels}`);
  assert(labels.some(l => /Mid Length/i.test(l)), `mid-length missing: ${labels}`);
});

t('pure-symbol / pure-number labels skipped', () => {
  const md = `
## 123 Feature
## ★★★ Mechanic
## Real Mechanic
`;
  const out = extractGenericFeatures(md);
  const labels = out.map(f => f.label);
  assert(!labels.some(l => /^\d+\s/.test(l)), `numeric label leaked: ${labels}`);
  assert(labels.some(l => /Real Mechanic/i.test(l)), `real mechanic missing: ${labels}`);
});

/* ─── end-to-end via parseMarkdownGDD ───────────────────────────── */

t('parseMarkdownGDD wires generics into model.features', () => {
  const md = `
# PsyTitan
## Free Spins
Standard 3-scatter trigger.
## PsyOps Rain Feature
Pyrotechnic VFX.
## Quantum Pulse Mechanic
Reel resonance.
`;
  const model = parseMarkdownGDD(md);
  assert(Array.isArray(model.features));
  const generics = model.features.filter(f => f.kind === 'feature_generic');
  assert(generics.length >= 2,
    `expected ≥2 generics, got ${generics.length}: ${model.features.map(f => f.kind + ':' + f.label).join(' | ')}`);
  const labels = generics.map(g => g.label).join('|');
  assert(/PsyOps Rain/i.test(labels), `missing PsyOps Rain in: ${labels}`);
  assert(/Quantum Pulse/i.test(labels), `missing Quantum Pulse in: ${labels}`);
});

t('parseMarkdownGDD does NOT silently drop unknown features', () => {
  const md = `
# Test Game

## Features

- Cinder Drift Mechanic
- Void Echo Feature
`;
  const model = parseMarkdownGDD(md);
  const generics = (model.features || []).filter(f => f.kind === 'feature_generic');
  assert(generics.length >= 2, `lost generics. features=${JSON.stringify(model.features)}`);
});

t('extractFeatures includes generics in result set', () => {
  const md = `
## Free Spins

Standard FS.

## Velocity Shift Mechanic

Custom thing.
`;
  const features = extractFeatures(md);
  const kinds = features.map(f => f.kind);
  assert(kinds.includes('free_spins'), `lost free_spins. kinds=${kinds.join(',')}`);
  assert(kinds.includes('feature_generic'), `lost generic. kinds=${kinds.join(',')}`);
});

t('generic discovery does not corrupt known patterns', () => {
  const md = `
## Free Spins Feature
3 scatters trigger 10 spins.

## Sticky Wild Feature
Sticks for the round.

## Aether Surge Mechanic
Custom resonance.
`;
  const features = extractFeatures(md);
  const kinds = features.map(f => f.kind);
  assert(kinds.includes('free_spins'));
  assert(kinds.includes('sticky_wild'));
  assert(kinds.includes('feature_generic'));
  /* known patterns must come first in extractFeatures output. */
  const fsIdx = kinds.indexOf('free_spins');
  const gIdx = kinds.indexOf('feature_generic');
  assert(fsIdx < gIdx, `known should precede generic, got: ${kinds.join(',')}`);
});

t('parser does not throw on adversarial generic-noise GDD', () => {
  let m;
  for (const evil of [
    '#'.repeat(1000) + ' Feature',
    '## ' + 'A'.repeat(2000) + ' Feature',
    '##\n##\n##\n## Mechanic\n',
    '## 🐍🐍🐍 Mechanic',
    '## \\\\\\ Feature',
  ]) {
    try { m = parseMarkdownGDD(evil); }
    catch (e) { assert(false, `threw on adversarial: ${e.message}`); }
    assert(m && typeof m === 'object', 'no model returned');
    assert(Array.isArray(m.features), 'no features array');
  }
});

console.log(`\nP6 result: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
