#!/usr/bin/env node
/**
 * tests/contracts/expanding-wild-animation-deep-x.test.mjs
 *
 * UQ-DEEP-X (Boki 2026-06-24): expanding wild animacija — 3-stage
 * industry-grade pipeline per Cash Eruption GDD §13.3 + NetEnt baseline.
 *
 * Pre fix-a: single-keyframe scale animation, bouncy overshoot, no
 * top-down stagger, no anticipation flash, no hold pulse loop, no
 * lava gradient, no gold rim, no per-stage HookBus events. Boki: "ne
 * vidim pravilnu animaciju u cash eruption, nema nikakvog ekspandovanja
 * Wild simbola a mora da bude."
 *
 * Posle fix-a:
 *   Stage 1 (180ms anticipation glow on seed cell)
 *   Stage 2 (350ms column flood-fill, top-down, 60ms row stagger,
 *            lava gradient + gold rim)
 *   Stage 3 (1200ms hold pulse loop while wild active)
 *   Stage 4 (150ms clear fade-out on preSpin)
 *   Per-stage HookBus events emitted za audio sync.
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

console.log('═══ expanding-wild-animation-deep-x.test.mjs ═══');

/* ────────────────────────────────────────────────────────────────────── */
/* CSS stamps */

await test('CSS: 4 stage keyframes defined (ewAnticipate/ewExpand/ewHoldPulse/ewClear)', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const cfg = { ...mod.defaultConfig(), enabled: true };
  const css = mod.emitExpandingWildCSS(cfg);
  assert(css.includes('@keyframes ewAnticipate'), 'ewAnticipate keyframe missing');
  assert(css.includes('@keyframes ewExpand'), 'ewExpand keyframe missing');
  assert(css.includes('@keyframes ewHoldPulse'), 'ewHoldPulse keyframe missing');
  assert(css.includes('@keyframes ewClear'), 'ewClear keyframe missing');
});

await test('CSS: lava gradient + gold rim present', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const css = mod.emitExpandingWildCSS({ ...mod.defaultConfig(), enabled: true });
  assert(css.includes('#FF6A1A'), 'lava hot color missing');
  assert(css.includes('#FFB347'), 'lava warm color missing');
  assert(css.includes('rgba(255, 215, 100'), 'gold rim color missing');
  assert(css.includes('linear-gradient(135deg'), 'lava gradient missing');
});

await test('CSS: stage durations match industry standard spec', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const css = mod.emitExpandingWildCSS({ ...mod.defaultConfig(), enabled: true });
  /* Stage 2 duration 350ms = Cash Eruption GDD §13.3 exact. */
  assert(/animation: ewExpand 350ms/.test(css), 'Stage 2 not 350ms');
  /* Stage 1 anticipation 180ms (industry baseline). */
  assert(/animation: ewAnticipate 180ms/.test(css), 'Stage 1 not 180ms');
  /* Stage 3 hold pulse 1200ms loop. */
  assert(/animation: ewHoldPulse 1200ms/.test(css), 'Stage 3 not 1200ms');
});

await test('CSS: stagger via --ew-row-delay CSS var', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const css = mod.emitExpandingWildCSS({ ...mod.defaultConfig(), enabled: true });
  assert(css.includes('--ew-row-delay'), 'row delay CSS var missing');
  assert(css.includes('animation-delay: var(--ew-row-delay'), 'stagger animation-delay missing');
});

await test('CSS: reduced-motion override skips animations', async () => {
  const mod = await import(resolve(REPO, 'src/blocks/expandingWild.mjs'));
  const css = mod.emitExpandingWildCSS({ ...mod.defaultConfig(), enabled: true });
  assert(css.includes('@media (prefers-reduced-motion: reduce)'), 'reduced-motion media missing');
  assert(/is-wild-expanding[\s\S]*animation: none/.test(css), 'expanding animation not killed under reduced-motion');
});

/* ────────────────────────────────────────────────────────────────────── */
/* Runtime stamps */

await test('Runtime: 3-stage timeline using setTimeout sa STAGE1+2 delays', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('const STAGE1_MS = 180'), 'STAGE1_MS constant missing');
  assert(src.includes('const STAGE2_ROW_STAGGER_MS = 60'), 'row stagger constant missing');
  assert(src.includes('const STAGE2_MS = 350'), 'STAGE2_MS constant missing');
});

await test('Runtime: per-stage HookBus events emit', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes("'expandingWild:stage1:anticipation'"), 'Stage 1 event missing');
  assert(src.includes("'expandingWild:stage2:expandStart'"), 'Stage 2 start event missing');
  assert(src.includes("'expandingWild:stage2:rowSettle'"), 'rowSettle event missing');
  assert(src.includes("'expandingWild:stage2:expandComplete'"), 'Stage 2 complete event missing');
  assert(src.includes("'expandingWild:stage3:pulseStart'"), 'Stage 3 pulse start event missing');
});

await test('Runtime: per-row setTimeout sa rowDelay calculation', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('rowDelay = r * STAGE2_ROW_STAGGER_MS'), 'row delay calc missing');
  assert(src.includes("setProperty('--ew-row-delay'"), 'CSS var set missing');
});

await test('Runtime: prefers-reduced-motion early-skip path', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('reducedMotion'), 'reducedMotion flag missing');
  assert(/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(src),
    'matchMedia query missing');
});

await test('Runtime: Stage 4 clearExpandingWilds fade-out path', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/expandingWild.mjs'), 'utf8');
  assert(src.includes('STAGE4_MS = 150'), 'Stage 4 ms missing');
  assert(src.includes('is-wild-clearing'), 'clear class missing');
});

/* ────────────────────────────────────────────────────────────────────── */
/* HookBus whitelist */

await test('HookBus: 5 new stage events whitelisted', async () => {
  const src = readFileSync(resolve(REPO, 'src/blocks/hookBus.mjs'), 'utf8');
  assert(src.includes("'expandingWild:stage1:anticipation'"), 'stage1 not whitelisted');
  assert(src.includes("'expandingWild:stage2:expandStart'"), 'stage2 start not whitelisted');
  assert(src.includes("'expandingWild:stage2:rowSettle'"), 'rowSettle not whitelisted');
  assert(src.includes("'expandingWild:stage2:expandComplete'"), 'stage2 complete not whitelisted');
  assert(src.includes("'expandingWild:stage3:pulseStart'"), 'stage3 pulse not whitelisted');
});

/* ────────────────────────────────────────────────────────────────────── */
/* E2E live: Cash Eruption rebuilt HTML */

await test('E2E: Cash Eruption HTML sadrzi sve 4 stage class-ove', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  if (!existsSync(distPath)) throw new Error('Cash Eruption dist not built — run ingest');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('is-wild-anticipation'), 'anticipation class not rendered');
  assert(html.includes('is-wild-expanding'), 'expanding class not rendered');
  assert(html.includes('is-wild-hold'), 'hold class not rendered');
  assert(html.includes('is-wild-clearing'), 'clearing class not rendered');
});

await test('E2E: Cash Eruption HTML sadrzi sve 4 stage keyframes', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('@keyframes ewAnticipate'), 'Stage 1 keyframe not in HTML');
  assert(html.includes('@keyframes ewExpand'), 'Stage 2 keyframe not in HTML');
  assert(html.includes('@keyframes ewHoldPulse'), 'Stage 3 keyframe not in HTML');
  assert(html.includes('@keyframes ewClear'), 'Stage 4 keyframe not in HTML');
});

await test('E2E: Cash Eruption HTML emits stage event names in runtime', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes("expandingWild:stage2:rowSettle"), 'rowSettle event name not in runtime');
  assert(html.includes("expandingWild:stage3:pulseStart"), 'pulseStart event name not in runtime');
});

await test('E2E: Cash Eruption HTML sadrzi lava gradient + gold rim CSS', async () => {
  const distPath = resolve(REPO, 'dist/ingest/cash-eruption-foundry-gdd/index.html');
  const html = readFileSync(distPath, 'utf8');
  assert(html.includes('#FF6A1A'), 'lava hot color not in HTML');
  assert(html.includes('#FFB347'), 'lava warm color not in HTML');
  assert(html.includes('rgba(255, 215, 100'), 'gold rim not in HTML');
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
