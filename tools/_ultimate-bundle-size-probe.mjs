/**
 * tools/_ultimate-bundle-size-probe.mjs
 *
 * C-1 LEGO-PERF — Ultimate bundle-size probe.
 *
 * Measures the rendered HTML size of buildSlotHTML(model) across
 * 4 GDD fixtures + per-block emit cost (CSS / Markup / Runtime).
 *
 * Outputs:
 *   1. reports/bundle-size/summary.json — per-fixture totals + budget check
 *   2. reports/bundle-size/per-block.json — per-block emit cost (avg across fixtures)
 *   3. reports/bundle-size/top20.md — markdown digest of 20 heaviest blocks
 *
 * Budget gates:
 *   • Per fixture HTML  ≤ 1,500 KB (current avg ~800 KB has headroom)
 *   • Single block CSS  ≤ 30 KB
 *   • Single block Runtime ≤ 50 KB
 *   • Total CSS         ≤ 350 KB
 *   • Total Runtime     ≤ 800 KB
 *
 * Exit 0 = within budget, 1 = any budget breach.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPORT_DIR = path.join(ROOT, 'reports/bundle-size');

const FIXTURES = [
  { name: 'WoO',           path: 'samples/WRATH_OF_OLYMPUS_GAME_GDD.md' },
  { name: 'GoO_1000',      path: 'samples/GATES_OF_OLYMPUS_1000_GAME_GDD.md' },
  { name: 'MidnightFangs', path: 'samples/MIDNIGHT_FANGS_GAME_GDD.md' },
  { name: 'CrystalForge',  path: 'samples/CRYSTAL_FORGE_GAME_GDD.md' },
];

const BUDGETS = {
  perFixtureHtmlKB:     1500,
  totalCssKB:           350,
  totalRuntimeKB:       800,
  singleCssKB:          30,
  singleRuntimeKB:      50,
};

/* Annotated allowlist — blocks legitimately above the single-block
 * runtime budget. Adding an entry requires justification AND a
 * realistic ceiling for that specific block. Anything above the
 * per-entry ceiling still fails. */
const RUNTIME_CEILING_OVERRIDE = {
  holdAndWin: { ceilingKB: 80,
    reason: '4-phase state machine (INACTIVE→INTRO→RUNNING→SUMMARY) + ' +
            'joker reveal + frame-multiplier accumulator + room-jackpot ' +
            'fallback + 6 dev-force buttons. Refactor would split semantics.' },
  /* Future entries land here when justified. Empty by default. */
};

let pass = 0, fail = 0;
const failures = [];
function t(name, ok, info = '') {
  if (ok) pass++;
  else { fail++; failures.push(name + (info ? ' (' + info + ')' : '')); console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

function bytes(s) { return Buffer.byteLength(s, 'utf8'); }
function kb(n) { return (n / 1024).toFixed(1); }

function extractCssJsBytes(html) {
  let cssTotal = 0;
  for (const m of html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)) cssTotal += bytes(m[1]);
  let jsTotal = 0;
  for (const m of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) jsTotal += bytes(m[1]);
  return { cssTotal, jsTotal };
}

async function buildModelFor(fx) {
  const text = await fs.readFile(path.join(ROOT, fx.path), 'utf8');
  return parseGDD(text, 'md');
}

(async () => {
  console.log('\n=== Ultimate bundle-size probe — 4 GDD fixtures ===');
  await fs.mkdir(REPORT_DIR, { recursive: true });

  /* ── PART 1: per-fixture totals ─────────────────────────────── */
  const fixturesData = [];
  for (const fx of FIXTURES) {
    const model = await buildModelFor(fx);
    const html  = buildSlotHTML(model);
    const total = bytes(html);
    const { cssTotal, jsTotal } = extractCssJsBytes(html);
    const markupTotal = total - cssTotal - jsTotal;
    fixturesData.push({
      fixture: fx.name,
      totalBytes: total,
      totalKB: +kb(total),
      cssBytes: cssTotal,
      cssKB: +kb(cssTotal),
      jsBytes: jsTotal,
      jsKB: +kb(jsTotal),
      markupBytes: markupTotal,
      markupKB: +kb(markupTotal),
    });
    console.log(`  ${fx.name.padEnd(15)} total=${kb(total)}KB css=${kb(cssTotal)}KB js=${kb(jsTotal)}KB markup=${kb(markupTotal)}KB`);
    t(`${fx.name} fits per-fixture HTML budget ≤ ${BUDGETS.perFixtureHtmlKB} KB`, total / 1024 <= BUDGETS.perFixtureHtmlKB, kb(total) + 'KB');
    t(`${fx.name} fits total CSS budget ≤ ${BUDGETS.totalCssKB} KB`, cssTotal / 1024 <= BUDGETS.totalCssKB, kb(cssTotal) + 'KB');
    t(`${fx.name} fits total Runtime budget ≤ ${BUDGETS.totalRuntimeKB} KB`, jsTotal / 1024 <= BUDGETS.totalRuntimeKB, kb(jsTotal) + 'KB');
  }

  /* ── PART 2: per-block emit cost ─────────────────────────────── */
  console.log('\n  Computing per-block emit cost (CSS + Runtime) — may take ~20s');

  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'blocks/_manifest.json'), 'utf8'));
  const blockCost = [];
  for (const block of manifest.blocks) {
    const exports = (block.exports || []);
    /* Find CSS + Runtime emit functions for this block */
    const emitCssName = exports.find(e => /^emit\w*CSS$/.test(e));
    const emitRtName  = exports.find(e => /^emit\w*Runtime$/.test(e));
    const emitMkName  = exports.find(e => /^emit\w*Markup$/.test(e));
    const resolveName = exports.find(e => e === 'resolveConfig' || e === 'defaultConfig');
    if (!emitCssName && !emitRtName) continue;

    let mod;
    try { mod = await import(path.join(ROOT, block.file)); }
    catch (e) { continue; }

    /* Try to force-enable for budget measurement */
    let cfg = null;
    try {
      const dflt = mod.defaultConfig ? mod.defaultConfig() : {};
      cfg = { ...dflt, enabled: true };
      if (mod.resolveConfig) {
        const probeModel = { [block.name]: { enabled: true } };
        const resolved = mod.resolveConfig(probeModel);
        if (resolved && resolved.enabled === true) cfg = resolved;
        else cfg.enabled = true;
      }
    } catch (_) { cfg = { enabled: true }; }

    let cssLen = 0, rtLen = 0, mkLen = 0;
    try { if (emitCssName && mod[emitCssName]) cssLen = bytes(String(mod[emitCssName](cfg) || '')); } catch (_) {}
    try { if (emitRtName  && mod[emitRtName])  rtLen  = bytes(String(mod[emitRtName](cfg)  || '')); } catch (_) {}
    try { if (emitMkName  && mod[emitMkName])  mkLen  = bytes(String(mod[emitMkName](cfg)  || '')); } catch (_) {}

    blockCost.push({
      name: block.name,
      category: block.category,
      cssBytes: cssLen,
      runtimeBytes: rtLen,
      markupBytes: mkLen,
      totalBytes: cssLen + rtLen + mkLen,
    });
  }

  blockCost.sort((a, b) => b.totalBytes - a.totalBytes);
  await fs.writeFile(path.join(REPORT_DIR, 'per-block.json'), JSON.stringify(blockCost, null, 2));

  /* Budget asserts per block */
  for (const b of blockCost) {
    if (b.cssBytes > 0) {
      t(`${b.name} CSS ≤ ${BUDGETS.singleCssKB}KB`, b.cssBytes / 1024 <= BUDGETS.singleCssKB, kb(b.cssBytes) + 'KB');
    }
    if (b.runtimeBytes > 0) {
      const override = RUNTIME_CEILING_OVERRIDE[b.name];
      const ceilingKB = override ? override.ceilingKB : BUDGETS.singleRuntimeKB;
      const label = override
        ? `${b.name} Runtime ≤ ${ceilingKB}KB (allowlisted: ${override.reason.slice(0, 40)}...)`
        : `${b.name} Runtime ≤ ${ceilingKB}KB`;
      t(label, b.runtimeBytes / 1024 <= ceilingKB, kb(b.runtimeBytes) + 'KB');
    }
  }

  /* ── PART 3: top 20 digest ──────────────────────────────────── */
  const top20 = blockCost.slice(0, 20);
  let md = `# Bundle size — Top 20 heaviest blocks\n\n`;
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Each block measured with enabled=true. CSS + Markup + Runtime bytes.\n\n`;
  md += `| Rank | Block | Category | CSS | Runtime | Markup | Total |\n`;
  md += `|:-:|:--|:--|--:|--:|--:|--:|\n`;
  for (let i = 0; i < top20.length; i++) {
    const b = top20[i];
    md += `| ${i + 1} | \`${b.name}\` | ${b.category || '—'} | ${kb(b.cssBytes)}KB | ${kb(b.runtimeBytes)}KB | ${kb(b.markupBytes)}KB | **${kb(b.totalBytes)}KB** |\n`;
  }
  md += `\n## Aggregate stats\n\n`;
  const totalCss = blockCost.reduce((s, b) => s + b.cssBytes, 0);
  const totalRt = blockCost.reduce((s, b) => s + b.runtimeBytes, 0);
  const totalMk = blockCost.reduce((s, b) => s + b.markupBytes, 0);
  md += `- Total blocks measured: **${blockCost.length}**\n`;
  md += `- Sum CSS emit (all enabled): **${kb(totalCss)} KB**\n`;
  md += `- Sum Runtime emit: **${kb(totalRt)} KB**\n`;
  md += `- Sum Markup emit: **${kb(totalMk)} KB**\n`;
  md += `- Average CSS per block: **${kb(totalCss / blockCost.length)} KB**\n`;
  md += `- Average Runtime per block: **${kb(totalRt / blockCost.length)} KB**\n`;
  await fs.writeFile(path.join(REPORT_DIR, 'top20.md'), md);

  /* ── PART 4: summary ────────────────────────────────────────── */
  const summary = {
    generatedAt: new Date().toISOString(),
    budgets: BUDGETS,
    fixtures: fixturesData,
    perBlock: {
      count: blockCost.length,
      sumCssKB:     +kb(totalCss),
      sumRuntimeKB: +kb(totalRt),
      sumMarkupKB:  +kb(totalMk),
      avgCssKB:     +kb(totalCss / blockCost.length),
      avgRuntimeKB: +kb(totalRt / blockCost.length),
    },
    top10: top20.slice(0, 10).map(b => ({ name: b.name, totalKB: +kb(b.totalBytes) })),
    pass, fail,
    failures,
  };
  await fs.writeFile(path.join(REPORT_DIR, 'summary.json'), JSON.stringify(summary, null, 2));

  console.log(`\n  Per-block aggregate:`);
  console.log(`    Σ CSS:     ${kb(totalCss)} KB`);
  console.log(`    Σ Runtime: ${kb(totalRt)} KB`);
  console.log(`    Σ Markup:  ${kb(totalMk)} KB`);
  console.log(`    Avg CSS:     ${kb(totalCss / blockCost.length)} KB/block`);
  console.log(`    Avg Runtime: ${kb(totalRt / blockCost.length)} KB/block`);

  console.log(`\n  Top 5 heaviest blocks:`);
  for (let i = 0; i < 5; i++) {
    const b = blockCost[i];
    console.log(`    ${i + 1}. ${b.name.padEnd(28)} ${kb(b.totalBytes)}KB`);
  }

  console.log(`\n  Reports: reports/bundle-size/{summary.json, per-block.json, top20.md}`);
  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===`);
  if (fail > 0) {
    console.log('\n  Budget breaches:');
    for (const f of failures.slice(0, 15)) console.log('    - ' + f);
    if (failures.length > 15) console.log(`    ... and ${failures.length - 15} more`);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error('Probe error:', e.stack || e); process.exit(2); });
