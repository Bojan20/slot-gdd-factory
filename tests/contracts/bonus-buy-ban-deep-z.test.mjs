#!/usr/bin/env node
/**
 * tests/contracts/bonus-buy-ban-deep-z.test.mjs
 *
 * UQ-DEEP-Z (Boki 2026-06-24): "ako gdd nema bonus buy, ne prikazuj
 * taj blok u igri."
 *
 * Bug: Cash Eruption GDD eksplicitno bani bonus buy. Parser stampa
 * model.confidence._derivedBy.bonusBuy = 'gdd-explicit-ban-detected' i
 * postavi model.bonusBuy.enabled = false. ALI features[] može imati
 * 'bonus_buy' kind dodato iz drugog izvora (Wave V reconcile / smart
 * defaults). bonusBuy.mjs auto-enable iz features brisao ban. Rendered
 * Cash Eruption HTML imao 12 bonus-buy-btn markera.
 *
 * Fix: ban-precedence — _derivedBy.bonusBuy === 'gdd-explicit-ban-detected'
 * (ili m.enabled === false) hard-override-uje features auto-enable.
 * Mirror u sve 3 blok-a (bonusBuy, bonusBuyMenu, bonusBuyDeterministic).
 *
 * Exit 0 PASS, 1 FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..', '..');

let pass = 0, fail = 0;
const failures = [];

function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

async function test(name, fn) {
  try { await fn(); pass++; console.log(`  ✓ ${name}`); }
  catch (e) { fail++; failures.push({ name, error: e.message }); console.log(`  ✗ ${name} — ${e.message}`); }
}

console.log('═══ bonus-buy-ban-deep-z.test.mjs ═══');

const bannedModel = {
  confidence: { _derivedBy: { bonusBuy: 'gdd-explicit-ban-detected' } },
  bonusBuy: { enabled: false },
  features: [{ kind: 'bonus_buy' }],  /* Wave V / smart defaults can add this even when banned */
  topology: { reels: 5, rows: 3, paylines: 20, kind: 'lock_respin' },
};

const cleanModel = {
  features: [{ kind: 'bonus_buy' }],
  topology: { reels: 5, rows: 3, paylines: 20, kind: 'rectangular' },
};

/* ────────────────────────────────────────────────────────────────────── */

await test('bonusBuy: ban-detected → enabled=false despite features[bonus_buy]', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/bonusBuy.mjs'));
  const cfg = mod.resolveConfig(bannedModel);
  assert(cfg.enabled === false, `enabled=${cfg.enabled}, expected false`);
});

await test('bonusBuy: clean model with features[bonus_buy] → enabled=true (regression guard)', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/bonusBuy.mjs'));
  const cfg = mod.resolveConfig(cleanModel);
  assert(cfg.enabled === true, `clean model should auto-enable, got: ${cfg.enabled}`);
});

await test('bonusBuyMenu: ban-detected → enabled=false', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/bonusBuyMenu.mjs'));
  const cfg = mod.resolveConfig(bannedModel);
  assert(cfg.enabled === false, `enabled=${cfg.enabled}, expected false`);
});

await test('bonusBuyMenu: clean model with menu feature + 2 tiers → enabled=true', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/bonusBuyMenu.mjs'));
  const cfg = mod.resolveConfig({
    features: [{ kind: 'bonus_buy', tiers: [
      { label: 'Standard', costX: 75, forceScatters: 3 },
      { label: 'Super', costX: 200, forceScatters: 4 },
    ]}],
    topology: { reels: 5, rows: 3, paylines: 20, kind: 'rectangular' },
  });
  assert(cfg.enabled === true, `clean menu model should enable, got: ${cfg.enabled}`);
});

await test('bonusBuyDeterministic: ban-detected → enabled=false', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/bonusBuyDeterministic.mjs'));
  const cfg = mod.resolveConfig({
    ...bannedModel,
    bonusBuyDeterministic: { enabled: true, plants: [
      { tier: 'STD', costX: 50, positions: [[0, 2], [0, 3]] },
    ]},
  });
  assert(cfg.enabled === false, `enabled=${cfg.enabled}, expected false despite explicit enabled:true`);
});

/* ────────────────────────────────────────────────────────────────────── */
/* Source stamps */

await test('SOURCE: bonusBuy.mjs has ban-precedence guard', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/bonusBuy.mjs'), 'utf8');
  assert(src.includes("'gdd-explicit-ban-detected'"), 'ban string check missing');
  assert(src.includes('banDetected'), 'banDetected variable missing');
});

await test('SOURCE: bonusBuyMenu.mjs has ban-precedence guard', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/bonusBuyMenu.mjs'), 'utf8');
  assert(src.includes("'gdd-explicit-ban-detected'"), 'ban string check missing');
});

await test('SOURCE: bonusBuyDeterministic.mjs has ban-precedence guard', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/bonusBuyDeterministic.mjs'), 'utf8');
  assert(src.includes("'gdd-explicit-ban-detected'"), 'ban string check missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E: Cash Eruption rebuilt HTML has zero bonus buy markers. */

await test('E2E: Cash Eruption rebuilt HTML has 0 bonus-buy markers (was 12)', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) throw new Error('dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  const matches = html.match(/bonus-buy-btn|bonusBuyBtn|bonus-buy-menu/gi);
  const count = matches ? matches.length : 0;
  assert(count === 0, `${count} bonus buy markers still in Cash Eruption HTML — ban override failed`);
});

/* ────────────────────────────────────────────────────────────────────── */

console.log('');
console.log(`═══ ${pass} PASS · ${fail} FAIL ═══`);
if (fail > 0) {
  console.log('\nFailures:');
  for (const f of failures) console.log(`  ✗ ${f.name}\n      ${f.error}`);
  process.exit(1);
}
process.exit(0);
