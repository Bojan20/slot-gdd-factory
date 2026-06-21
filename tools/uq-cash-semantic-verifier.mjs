#!/usr/bin/env node
/**
 * tools/uq-cash-semantic-verifier.mjs · Wave UQ-CASH A6
 *
 * Boki direktiva: "posel svakog fixa qa ultimativna provera najdublja na
 * realnim primerima da se uveris da sve radi savreseno".
 *
 * Earlier gates (UQ-11, lw-25, parse-real, verify) check that the parser
 * does NOT THROW and the slot DOES BUILD. None of them check that the
 * model is SEMANTICALLY CORRECT vis-à-vis what the PDF actually says.
 *
 * A6 closes that hole. For 5 pinned baseline GDDs (Cash Eruption + 4
 * vendor-neutral GDDs in the corpus), this tool:
 *
 *   1. pdftotext-extracts the PDF
 *   2. parseGDD + applySmartDefaults (no Kimi — pure deterministic path)
 *   3. Asserts each pinned field in tests/fixtures/semantic-expected.json:
 *      - name matches OR is non-empty (if pinned to null = "any name ok")
 *      - topology.reels matches PDF declared value
 *      - topology.rows matches
 *      - topology.paylines OR topology.ways matches
 *      - features.length >= minCount
 *      - symbols.specials.length >= minSpecials
 *      - all namedSymbols appear in some bucket (case-insensitive)
 *
 * Exit codes:
 *   0  all fixtures pass all assertions
 *   1  ≥ 1 assertion failed
 *   2  tool-internal error (PDF missing, fixture file missing)
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

const fixturePath = resolve(REPO, 'tests/fixtures/semantic-expected.json');
if (!existsSync(fixturePath)) {
  console.error('[uq-cash-semantic] fixture missing:', fixturePath);
  process.exit(2);
}
const fixture = JSON.parse(readFileSync(fixturePath, 'utf8'));

function pdfToText(pdfPath) {
  const r = spawnSync('pdftotext', ['-layout', pdfPath, '-'], { encoding: 'utf8', maxBuffer: 50_000_000 });
  if (r.status === 0 && r.stdout && r.stdout.length > 100) return r.stdout;
  return '';
}

function resolveHome(p) { return p.replace(/^~/, process.env.HOME || ''); }

/* Wave UQ-FORTIFY F10 — PDF SHA drift detector.
 * Each fixture in semantic-expected.json may carry a __pdf_sha__ field.
 * On verifier run, we recompute the SHA-256 of the actual PDF file and
 * warn if it differs from the pinned value. Drift means the source PDF
 * has been replaced; the ground truth may no longer apply. */
import { createHash } from 'node:crypto';
function _sha256(path) {
  try {
    const buf = readFileSync(path);
    return createHash('sha256').update(buf).digest('hex');
  } catch { return null; }
}

function symbolLabels(model) {
  const out = [];
  const s = (model && model.symbols) || {};
  for (const bucket of ['high', 'mid', 'low', 'specials']) {
    for (const sym of (Array.isArray(s[bucket]) ? s[bucket] : [])) {
      out.push((sym.label || sym.name || sym.id || '').toString().toLowerCase());
    }
  }
  return out;
}

const { parseGDD } = await import('../src/parser.mjs');

const results = [];
let totalAsserts = 0;
let totalFails = 0;

console.log('UQ-CASH A6 — semantic accuracy verifier');
console.log('═'.repeat(60));

for (const [slug, expected] of Object.entries(fixture.fixtures)) {
  const pdfPath = resolveHome(expected.pdf);
  const result = { slug, asserts: [], passCount: 0, failCount: 0 };

  if (!existsSync(pdfPath)) {
    console.log(`  ${slug.padEnd(40)} ❌ PDF missing: ${pdfPath}`);
    result.asserts.push({ name: 'pdf-exists', pass: false, reason: 'pdf missing' });
    result.failCount++;
    totalFails++;
    totalAsserts++;
    results.push(result);
    continue;
  }

  /* Wave UQ-FORTIFY F10 — PDF SHA drift check. Non-fatal warning when the
   * pinned __pdf_sha__ doesn't match the actual PDF — caller knows ground
   * truth may be stale. First-time runs (no pinned SHA) bake the current. */
  const pdfSha = _sha256(pdfPath);
  if (expected.__pdf_sha__) {
    if (pdfSha !== expected.__pdf_sha__) {
      console.log(`  ${slug.padEnd(40)} ⚠️  PDF SHA drift: pinned ${expected.__pdf_sha__.slice(0, 12)} ≠ actual ${(pdfSha || 'null').slice(0, 12)}`);
    }
  } else if (process.env.UQ_BAKE_PDF_SHA === '1') {
    /* Operator opt-in: stamp the current SHA into the fixture file. */
    expected.__pdf_sha__ = pdfSha;
    console.log(`  ${slug.padEnd(40)} 📝 baked PDF SHA ${(pdfSha || '').slice(0, 12)}`);
  }

  const raw = pdfToText(pdfPath);
  const model = parseGDD(raw, 'md');

  function assert(name, pass, reason) {
    result.asserts.push({ name, pass, reason });
    if (pass) result.passCount++;
    else result.failCount++;
    totalAsserts++;
    if (!pass) totalFails++;
  }

  /* Name */
  if (expected.name !== null) {
    assert(`name = "${expected.name}"`,
      (model.name || '').toLowerCase() === expected.name.toLowerCase(),
      `got "${model.name}"`);
  } else {
    /* Allow any non-empty name. */
    assert('name non-empty', !!(model.name && model.name.length > 0), `got "${model.name}"`);
  }

  /* Topology */
  const t = model.topology || {};
  if (Number.isFinite(expected.topology.reels)) {
    assert(`topology.reels = ${expected.topology.reels}`,
      t.reels === expected.topology.reels,
      `got ${t.reels}`);
  }
  if (Number.isFinite(expected.topology.rows)) {
    assert(`topology.rows = ${expected.topology.rows}`,
      t.rows === expected.topology.rows,
      `got ${t.rows}`);
  }
  if (expected.topology.paylines_or_ways !== null) {
    const got = t.paylines || t.ways || t.ways_count;
    assert(`topology.paylines/ways = ${expected.topology.paylines_or_ways}`,
      got === expected.topology.paylines_or_ways,
      `got ${got}`);
  }

  /* Features */
  const featCount = Array.isArray(model.features) ? model.features.length : 0;
  assert(`features.length >= ${expected.features.minCount}`,
    featCount >= expected.features.minCount,
    `got ${featCount}`);

  /* Symbols.specials */
  const specCount = (model.symbols && Array.isArray(model.symbols.specials))
    ? model.symbols.specials.length : 0;
  assert(`symbols.specials.length >= ${expected.symbols.minSpecials}`,
    specCount >= expected.symbols.minSpecials,
    `got ${specCount}`);

  /* Named symbols */
  if (Array.isArray(expected.namedSymbols) && expected.namedSymbols.length > 0) {
    const allLabels = symbolLabels(model);
    for (const want of expected.namedSymbols) {
      assert(`symbol "${want}" appears`,
        allLabels.some(l => l.includes(want.toLowerCase())),
        `not in [${allLabels.slice(0, 8).join(', ')}…]`);
    }
  }

  const verdict = result.failCount === 0 ? '✅' : '❌';
  console.log(`  ${slug.padEnd(40)} ${verdict} ${result.passCount}/${result.passCount + result.failCount}`);
  if (result.failCount > 0) {
    for (const a of result.asserts) {
      if (!a.pass) console.log(`      ✗ ${a.name} — ${a.reason}`);
    }
  }
  results.push(result);
}

console.log('═'.repeat(60));
console.log(`Asserts: ${totalAsserts - totalFails}/${totalAsserts} passed (${totalFails} fails)`);

/* Wave UQ-FORTIFY2 G5 — auto-discover GDDs missing from ground truth.
 * Scans ~/Desktop/GDD/ for `*.pdf` files that are NOT in semantic-expected.
 * Operator can either pin them manually OR run with UQ_BAKE_GROUND_TRUTH=1
 * to seed minimal entries (parser baseline as "expected"). */
try {
  const gddDir = (process.env.HOME || '/tmp') + '/Desktop/GDD';
  if (existsSync(gddDir)) {
    const { readdirSync } = await import('node:fs');
    const pinned = new Set(Object.keys(fixture.fixtures).map(k => k.toLowerCase()));
    const allPdfs = readdirSync(gddDir).filter(f => f.toLowerCase().endsWith('.pdf'));
    const missing = allPdfs.filter(f => !pinned.has(f.replace(/\.pdf$/i, '').toLowerCase()));
    if (missing.length > 0) {
      console.log('');
      console.log(`📋 ${missing.length} PDF(s) in ~/Desktop/GDD/ have NO ground truth:`);
      for (const m of missing.slice(0, 8)) console.log('  - ' + m);
      if (missing.length > 8) console.log(`  … +${missing.length - 8} more`);
      console.log('  Add them to tests/fixtures/semantic-expected.json or run with');
      console.log('  UQ_BAKE_GROUND_TRUTH=1 to seed parser-baseline entries.');
    }
  }
} catch { /* non-fatal */ }

/* F10 — if UQ_BAKE_PDF_SHA=1 mode was used and at least one fixture got a
 * fresh SHA baked, write the updated fixture file back. */
if (process.env.UQ_BAKE_PDF_SHA === '1') {
  const { writeFileSync } = await import('node:fs');
  writeFileSync(fixturePath, JSON.stringify(fixture, null, 2) + '\n');
  console.log(`Baked PDF SHAs into ${fixturePath}`);
}

process.exit(totalFails > 0 ? 1 : 0);
