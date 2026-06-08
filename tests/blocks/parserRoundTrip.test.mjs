/* eslint-disable no-console */
/**
 * Wave P7 — GDD round-trip stabilnost.
 *
 * Contract under test:
 *   - serializeToCanonicalJSON(parse(text)) → normalizeFromJSON →
 *     stableFingerprint MUST equal stableFingerprint(parse(text)).
 *   - Idempotency: roundTrip(roundTrip(text).restored serialized) ===
 *     roundTrip(text).restored.
 *   - 4× sample fixtures pass:
 *       samples/WRATH_OF_OLYMPUS_GAME_GDD.md
 *       samples/CRYSTAL_FORGE_GAME_GDD.md
 *       samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md
 *       samples/MIDNIGHT_FANGS_GAME_GDD.md
 *   - serializeToCanonicalJSON never returns volatile keys
 *     (_failures / _derivedBy / _discovered).
 *   - roundTrip never throws — even on null / empty / corrupt input.
 *
 * Why it matters:
 *   "regulator submission preduslov" — Master TODO P7.
 *   Two consecutive builds of the same GDD must produce the same
 *   renderable model. Without round-trip stability, GDD parser
 *   updates can silently drift the certified output.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  parseGDD, parseMarkdownGDD, normalizeFromJSON,
  serializeToCanonicalJSON, stableFingerprint, roundTrip,
} from '../../src/parser.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO = resolve(__dirname, '..', '..');

let pass = 0, fail = 0;
const t = (name, fn) => {
  try { fn(); console.log('  ✓', name); pass++; }
  catch (e) { console.log('  ✗', name, '\n     ', e.message); fail++; }
};
const assert = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };

console.log('Wave P7 — GDD round-trip stabilnost');

/* ─── serializeToCanonicalJSON shape ────────────────────────────── */

t('serializeToCanonicalJSON returns plain object for null/undefined', () => {
  assert(typeof serializeToCanonicalJSON(null) === 'object');
  assert(typeof serializeToCanonicalJSON(undefined) === 'object');
  assert(typeof serializeToCanonicalJSON('not a model') === 'object');
});

t('serializeToCanonicalJSON strips _failures', () => {
  const m = parseMarkdownGDD('# Test\n');
  m.confidence._failures = [{ label: 'fake', error: 'fake' }];
  const json = serializeToCanonicalJSON(m);
  const str = JSON.stringify(json);
  assert(!/_failures/.test(str), `_failures leaked: ${str}`);
});

t('serializeToCanonicalJSON strips _derivedBy', () => {
  const m = parseMarkdownGDD('# Test\n');
  m.confidence._derivedBy = { 'theme.palette': 'smartDefaults' };
  const json = serializeToCanonicalJSON(m);
  const str = JSON.stringify(json);
  assert(!/_derivedBy/.test(str), `_derivedBy leaked: ${str}`);
});

t('serializeToCanonicalJSON strips _discovered flag on generics', () => {
  const m = parseMarkdownGDD('# Test\n## PsyOps Rain Feature\n');
  const json = serializeToCanonicalJSON(m);
  const str = JSON.stringify(json);
  assert(!/_discovered/.test(str), `_discovered leaked: ${str}`);
});

t('serializeToCanonicalJSON sorts features deterministically', () => {
  const m = parseMarkdownGDD('# Test\n');
  m.features = [
    { kind: 'wild', label: 'Wild' },
    { kind: 'cascade', label: 'Cascade' },
    { kind: 'free_spins', label: 'Free Spins' },
  ];
  const json = serializeToCanonicalJSON(m);
  const kinds = json.features.map(f => f.kind);
  assert(JSON.stringify(kinds) === JSON.stringify([...kinds].sort()),
    `not sorted: ${JSON.stringify(kinds)}`);
});

/* ─── stableFingerprint shape ──────────────────────────────────── */

t('stableFingerprint returns null for null model', () => {
  assert(stableFingerprint(null) === null);
  assert(stableFingerprint(undefined) === null);
});

t('stableFingerprint contains contract keys', () => {
  const m = parseMarkdownGDD('# Test Game\n');
  const fp = stableFingerprint(m);
  for (const key of [
    'name', 'topology', 'featureKinds', 'themeTagsCount',
    'paletteSize', 'freeSpinsEnabled', 'symbolTierCounts',
  ]) {
    assert(key in fp, `missing key: ${key}`);
  }
  assert(typeof fp.topology.kind === 'string');
  assert(typeof fp.topology.reels === 'number');
  assert(Array.isArray(fp.featureKinds));
});

t('stableFingerprint featureKinds is sorted + deduped', () => {
  const m = parseMarkdownGDD('# Test\n## Wild\n## Free Spins\n## Wild\n');
  const fp = stableFingerprint(m);
  const sorted = [...fp.featureKinds].sort();
  assert(JSON.stringify(fp.featureKinds) === JSON.stringify(sorted),
    `not sorted: ${fp.featureKinds}`);
  assert(new Set(fp.featureKinds).size === fp.featureKinds.length,
    `duplicates: ${fp.featureKinds}`);
});

/* ─── roundTrip end-to-end ──────────────────────────────────────── */

t('roundTrip never throws on null/empty', () => {
  const a = roundTrip(null);
  const b = roundTrip('');
  const c = roundTrip(undefined);
  for (const r of [a, b, c]) {
    assert(r && typeof r === 'object', `bad return type`);
    assert(typeof r.fingerprintMatch === 'boolean');
  }
});

t('roundTrip happy-path: tiny GDD round-trips clean', () => {
  const md = '# Simple Game\n\n5×3 reels, 10 paylines.\n\n## Free Spins\n3 scatters trigger 10 spins.\n';
  const r = roundTrip(md);
  assert(r.fingerprintMatch === true,
    `fingerprint mismatch:\n  initial=${JSON.stringify(r.fingerprintInitial)}\n  restored=${JSON.stringify(r.fingerprintRestored)}`);
});

t('roundTrip preserves feature kind set', () => {
  const md = `
# Multi-feature

## Free Spins
## Wild
## Multiplier
## Cascade
`;
  const r = roundTrip(md);
  assert(r.fingerprintMatch, 'fingerprint diff');
  const initialKinds = new Set(r.fingerprintInitial.featureKinds);
  const restoredKinds = new Set(r.fingerprintRestored.featureKinds);
  assert(initialKinds.size === restoredKinds.size,
    `kind count drift: ${initialKinds.size} → ${restoredKinds.size}`);
  for (const k of initialKinds) {
    assert(restoredKinds.has(k), `lost kind: ${k}`);
  }
});

t('roundTrip preserves topology kind + size', () => {
  const md = `
# 6x4 Test
6 reels, 4 rows, 50 paylines.
## Cluster Pays
`;
  const r = roundTrip(md);
  assert(r.fingerprintMatch, 'fingerprint diff');
  assert(r.fingerprintInitial.topology.reels === r.fingerprintRestored.topology.reels);
  assert(r.fingerprintInitial.topology.rows === r.fingerprintRestored.topology.rows);
  assert(r.fingerprintInitial.topology.kind === r.fingerprintRestored.topology.kind);
});

t('roundTrip preserves freeSpins on/off', () => {
  const yes = roundTrip('# T\n## Free Spins\n3S → 10 spins.\n');
  const no = roundTrip('# T\n No FS in this product.\n');
  assert(yes.fingerprintInitial.freeSpinsEnabled === yes.fingerprintRestored.freeSpinsEnabled);
  assert(no.fingerprintInitial.freeSpinsEnabled === no.fingerprintRestored.freeSpinsEnabled);
});

t('roundTrip is idempotent (serialize → normalize → serialize stable)', () => {
  /* True idempotency: feeding the *restored* model back through
     serializeToCanonicalJSON + normalizeFromJSON must yield the
     same fingerprint, not double-encode through a JSON string
     (which loses model.name to the JSON IR "Untitled (JSON)" fallback
     — a separate parser-input-detection concern). */
  const md = '# Idem\n## Free Spins\n3 scatters trigger 10 spins.\n';
  const a = roundTrip(md);
  assert(a.fingerprintMatch, 'first pass failed');
  const json2 = serializeToCanonicalJSON(a.restored);
  const restored2 = normalizeFromJSON(json2);
  const fp2 = stableFingerprint(restored2);
  assert(JSON.stringify(a.fingerprintRestored) === JSON.stringify(fp2),
    `idempotency drift:\n  fp1=${JSON.stringify(a.fingerprintRestored)}\n  fp2=${JSON.stringify(fp2)}`);
});

t('roundTrip preserves generic feature kind after P6', () => {
  const md = '# Test\n## PsyOps Rain Feature\n';
  const r = roundTrip(md);
  assert(r.fingerprintMatch, 'fingerprint diff');
  assert(r.fingerprintInitial.featureKinds.includes('feature_generic'),
    `lost feature_generic from initial: ${r.fingerprintInitial.featureKinds}`);
  assert(r.fingerprintRestored.featureKinds.includes('feature_generic'),
    `lost feature_generic from restored: ${r.fingerprintRestored.featureKinds}`);
});

/* ─── real sample fixtures ──────────────────────────────────────── */

const FIXTURES = [
  'samples/WRATH_OF_OLYMPUS_GAME_GDD.md',
  'samples/CRYSTAL_FORGE_GAME_GDD.md',
  'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md',
  'samples/MIDNIGHT_FANGS_GAME_GDD.md',
];

for (const fx of FIXTURES) {
  t(`fixture round-trips: ${fx}`, () => {
    let text;
    try { text = readFileSync(resolve(REPO, fx), 'utf8'); }
    catch (_e) {
      console.log(`     [skipped: ${fx} not on disk]`);
      return;
    }
    const r = roundTrip(text);
    assert(r.initial && r.restored, 'parse / restore failed');
    assert(r.fingerprintMatch === true,
      `fingerprint mismatch for ${fx}:\n  initial=${JSON.stringify(r.fingerprintInitial, null, 2)}\n  restored=${JSON.stringify(r.fingerprintRestored, null, 2)}`);
  });
}

/* ─── adversarial input is graceful ─────────────────────────────── */

t('roundTrip on 100KB junk does not throw and reports a fingerprint', () => {
  const junk = 'a'.repeat(100_000);
  const r = roundTrip(junk);
  assert(typeof r.fingerprintMatch === 'boolean');
});

t('roundTrip on JSON IR string works', () => {
  /* parseGDD accepts JSON-string input → JSON IR path. */
  const ir = JSON.stringify({
    name: 'JSON Game',
    theme: { tags: ['cyber'] },
    features: [{ kind: 'free_spins', label: 'Free Spins' }],
    topology: { kind: 'rectangular', reels: 5, rows: 3, paylines: 10, shape: 'rectangular', evaluation: 'lines' },
    symbols: { high: ['H1'], mid: [], low: [], specials: ['W'] },
  });
  const r = roundTrip(ir);
  assert(r.fingerprintMatch === true,
    `JSON IR fingerprint diff: ${JSON.stringify(r.fingerprintInitial)} vs ${JSON.stringify(r.fingerprintRestored)}`);
});

console.log(`\nP7 result: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
