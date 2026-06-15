#!/usr/bin/env node
/**
 * tools/contrast-audit.mjs — W47.S5 / Wave A1
 *
 * Pre-Math Roadmap Faza 4 #A1: "svi tekst-tokeni ≥ 7:1, ne 4.5:1 —
 * axe-core u CI per fixture". Slot-gdd-factory ships without
 * axe-core (axe pulls in jsdom/cheerio etc); this is a focused
 * pure-Playwright probe that computes WCAG contrast directly.
 *
 * Strategy
 * --------
 * For each canonical sample fixture (samples/*.md), build the slot HTML,
 * boot it headless, walk every user-visible text node, compute the
 * effective foreground vs background contrast via getComputedStyle,
 * and assert WCAG 2.x ratios:
 *
 *   AAA  normal text : ≥ 7:1
 *   AAA  large text  : ≥ 4.5:1 (text ≥ 18 px regular OR ≥ 14 px bold)
 *   AA   normal text : ≥ 4.5:1
 *   AA   large text  : ≥ 3:1
 *
 * The audit reports BOTH AA and AAA results so the operator sees where
 * the slot already meets the stricter bar and where it sits between AA
 * and AAA. Default exit gate is AAA — `--aa-gate` falls back to AA for
 * dark-theme themes the regulators haven't bumped yet.
 *
 * Output
 * ------
 *   - Per-fixture summary (text nodes audited, AA pass, AAA pass).
 *   - Top failing elements (selector, sample text, ratio).
 *   - reports/contrast-audit.json — structured for downstream tools.
 *
 * Exit codes
 * ----------
 *   0   all checked nodes meet the active gate (AAA by default).
 *   1   at least one node fails the active gate.
 *   2   tool-internal error (Playwright down, HTML emit failed, etc.).
 *
 * Run
 * ---
 *   node tools/contrast-audit.mjs                 # AAA gate, all samples
 *   node tools/contrast-audit.mjs --aa-gate       # AA fallback
 *   node tools/contrast-audit.mjs --filter=WRATH  # one fixture
 */

import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve as resolvePath, dirname, basename } from 'node:path';
import { chromium } from 'playwright';

import { parseGDD } from '../src/parser.mjs';
import { buildSlotHTML } from '../src/buildSlotHTML.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..');
const OUT_DIR = resolvePath(REPO_ROOT, 'tools/_qa/contrast-html');
const SAMPLES_DIR = resolvePath(REPO_ROOT, 'samples');
const REPORT = resolvePath(REPO_ROOT, 'reports/contrast-audit.json');
if (!existsSync(OUT_DIR)) await mkdir(OUT_DIR, { recursive: true });
if (!existsSync(dirname(REPORT))) await mkdir(dirname(REPORT), { recursive: true });

const ARGS = new Set(process.argv.slice(2));
const FILTER = process.argv.find(a => a.startsWith('--filter='))?.split('=')[1] || '';
const AA_GATE = ARGS.has('--aa-gate');

const C = {
  red:    s => `\x1b[31m${s}\x1b[0m`,
  green:  s => `\x1b[32m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

/* Pure WCAG contrast helpers — copy in browser via page.evaluate. */
const browserEvaluator = () => {
  function parseColor(s) {
    // rgb / rgba / "transparent" / named colors that getComputedStyle has resolved
    if (!s) return null;
    if (s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return null;
    return {
      r: +m[1], g: +m[2], b: +m[3], a: m[4] !== undefined ? +m[4] : 1,
    };
  }
  function blend(top, bot) {
    if (!top || top.a === 1) return top;
    if (!bot) return { ...top, a: 1 };
    const a = top.a + bot.a * (1 - top.a);
    return {
      r: Math.round((top.r * top.a + bot.r * bot.a * (1 - top.a)) / a),
      g: Math.round((top.g * top.a + bot.g * bot.a * (1 - top.a)) / a),
      b: Math.round((top.b * top.a + bot.b * bot.a * (1 - top.a)) / a),
      a,
    };
  }
  function effectiveBg(el) {
    let cur = el;
    let stack = null;
    while (cur && cur.nodeType === 1) {
      const cs = getComputedStyle(cur);
      const c = parseColor(cs.backgroundColor);
      if (c) stack = stack ? blend(stack, c) : c;
      if (stack && stack.a >= 1) return stack;
      cur = cur.parentElement;
    }
    /* Fallback to page background (body / html). */
    const html = document.documentElement;
    const body = document.body;
    const fb = parseColor(getComputedStyle(body || html).backgroundColor)
            || parseColor(getComputedStyle(html).backgroundColor)
            || { r: 255, g: 255, b: 255, a: 1 };
    return stack ? blend(stack, fb) : fb;
  }
  function relLum({ r, g, b }) {
    const c = [r, g, b].map(v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  }
  function ratio(a, b) {
    const la = relLum(a), lb = relLum(b);
    const [hi, lo] = la > lb ? [la, lb] : [lb, la];
    return (hi + 0.05) / (lo + 0.05);
  }
  function isLargeText(cs) {
    const px = parseFloat(cs.fontSize) || 0;
    const weight = parseInt(cs.fontWeight, 10) || 400;
    /* WCAG: "large" = ≥ 24 px regular OR ≥ 18.66 px (14 pt) bold. */
    if (px >= 24) return true;
    if (px >= 18.66 && weight >= 700) return true;
    return false;
  }

  const findings = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const text = (node.nodeValue || '').trim();
    if (!text) continue;
    const el = node.parentElement;
    if (!el) continue;
    const cs = getComputedStyle(el);
    /* Skip invisible. */
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    if (parseFloat(cs.opacity || '1') < 0.1) continue;
    /* Skip aria-hidden subtrees + sr-only. */
    if (el.closest('[aria-hidden="true"]')) continue;
    if (el.closest('.sr-only,.big-win-tier-sr')) continue;
    const fg = parseColor(cs.color);
    if (!fg) continue;
    const bg = effectiveBg(el);
    const r = ratio(fg, bg);
    const large = isLargeText(cs);
    findings.push({
      tag: el.tagName.toLowerCase(),
      id: el.id || '',
      cls: el.className && typeof el.className === 'string' ? el.className.slice(0, 80) : '',
      text: text.slice(0, 60),
      fontPx: parseFloat(cs.fontSize) || 0,
      weight: parseInt(cs.fontWeight, 10) || 400,
      large,
      ratio: Math.round(r * 100) / 100,
      fgRgb: `rgb(${fg.r},${fg.g},${fg.b})`,
      bgRgb: `rgb(${bg.r},${bg.g},${bg.b})`,
    });
  }
  return findings;
};

function applyGate(findings, gate) {
  const aaaNormal = 7;
  const aaaLarge = 4.5;
  const aaNormal = 4.5;
  const aaLarge = 3.0;
  let pass = 0, fail = 0;
  const failures = [];
  for (const f of findings) {
    let threshold;
    if (gate === 'aaa') {
      threshold = f.large ? aaaLarge : aaaNormal;
    } else {
      threshold = f.large ? aaLarge : aaNormal;
    }
    if (f.ratio >= threshold) {
      pass++;
    } else {
      fail++;
      failures.push({ ...f, gate, threshold });
    }
  }
  return { pass, fail, failures };
}

async function buildFixtureHtml(samplePath) {
  const md = await readFile(samplePath, 'utf8');
  const model = parseGDD(md);
  const html = buildSlotHTML(model);
  const outFile = resolvePath(OUT_DIR, basename(samplePath, '.md') + '.html');
  await writeFile(outFile, html);
  return outFile;
}

async function main() {
  const entries = await readdir(SAMPLES_DIR);
  let samples = entries.filter(f => f.endsWith('_GDD.md')).sort();
  if (FILTER) samples = samples.filter(f => f.includes(FILTER));
  if (samples.length === 0) {
    console.error(C.red('no samples to audit (filter empty?)'));
    process.exit(2);
  }

  console.log(C.bold(C.cyan('\n🎨  Contrast audit (W47.S5 / Wave A1)')));
  console.log(C.dim(`   gate: ${AA_GATE ? 'AA (fallback)' : 'AAA (default)'}`));
  console.log(C.dim(`   samples: ${samples.length}\n`));

  const browser = await chromium.launch({ headless: true });
  const report = { gate: AA_GATE ? 'aa' : 'aaa', fixtures: [], aggregate: {} };
  let totalAaa = { pass: 0, fail: 0 };
  let totalAa = { pass: 0, fail: 0 };

  for (const sample of samples) {
    const samplePath = resolvePath(SAMPLES_DIR, sample);
    let htmlPath;
    try {
      htmlPath = await buildFixtureHtml(samplePath);
    } catch (e) {
      console.log(`  ${C.red('emit-fail')} ${sample} ${C.dim(e.message)}`);
      report.fixtures.push({ sample, error: 'emit-failed', message: e.message });
      continue;
    }
    const page = await browser.newPage();
    page.on('pageerror', err => {
      console.log(`  ${C.yellow('pageerror')} ${sample} ${C.dim(err.message.slice(0, 80))}`);
    });
    try {
      await page.goto('file://' + htmlPath, { waitUntil: 'load', timeout: 15000 });
      await page.waitForTimeout(700);
      const findings = await page.evaluate(browserEvaluator);
      const aaa = applyGate(findings, 'aaa');
      const aa = applyGate(findings, 'aa');
      totalAaa.pass += aaa.pass; totalAaa.fail += aaa.fail;
      totalAa.pass += aa.pass; totalAa.fail += aa.fail;
      const gateRes = AA_GATE ? aa : aaa;
      const status = gateRes.fail === 0 ? C.green('✓ pass') : C.red('✗ fail');
      console.log(`  ${status}  ${sample.padEnd(48)}  AA ${aa.pass}/${aa.pass + aa.fail}  AAA ${aaa.pass}/${aaa.pass + aaa.fail}`);
      report.fixtures.push({
        sample, findings_total: findings.length,
        aa, aaa,
      });
      /* Surface up to 3 worst failures for the active gate. */
      const worst = gateRes.failures.sort((a, b) => a.ratio - b.ratio).slice(0, 3);
      for (const w of worst) {
        console.log(C.dim(`        - <${w.tag}${w.id ? '#' + w.id : ''}> ratio=${w.ratio} (need ≥${w.threshold}) "${w.text.replace(/\s+/g, ' ').slice(0, 40)}"`));
      }
    } finally {
      await page.close();
    }
  }

  await browser.close();

  report.aggregate = { aa: totalAa, aaa: totalAaa };
  await writeFile(REPORT, JSON.stringify(report, null, 2));

  console.log('');
  console.log(C.bold('  aggregate:'));
  console.log(`    AA  : ${totalAa.pass} pass / ${totalAa.fail} fail`);
  console.log(`    AAA : ${totalAaa.pass} pass / ${totalAaa.fail} fail`);
  console.log(C.dim(`    report: ${REPORT}`));
  console.log('');

  const gateFail = AA_GATE ? totalAa.fail : totalAaa.fail;
  if (gateFail > 0) {
    console.log(C.red(C.bold(`❌ ${gateFail} node(s) fail the ${AA_GATE ? 'AA' : 'AAA'} gate.\n`)));
    process.exit(1);
  }
  console.log(C.green(C.bold(`✅ All text nodes meet the ${AA_GATE ? 'AA' : 'AAA'} contrast gate.\n`)));
}

main().catch(err => {
  console.error(C.red(`audit failed: ${err && err.stack || err}`));
  process.exit(2);
});
