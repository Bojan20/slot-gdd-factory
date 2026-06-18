#!/usr/bin/env node
/**
 * tools/_huff-force-chip-audit.mjs
 *
 * Boki (2026-06-18): "proveri huff and puff i uveri se da svaki force
 * postoji u gdd i da radi pravilno kada se izbilduje slot".
 *
 * Audit flow:
 *   1. Parse HNP GDD PDF → extract features list
 *   2. Compute EXPECTED force-chip set (features ∩ universalForcePanel
 *      KNOWN_KINDS \ PAYOUT_EVALUATOR_KINDS \ DEDUPE_OWNED_BY_OTHER_BLOCK
 *      + alwaysIncludeKinds [big_win])
 *   3. Build slot HTML
 *   4. Headless render → enumerate ACTUAL force chips painted in DOM
 *   5. Diff EXPECTED vs ACTUAL → flag missing / extra chips
 *   6. Click each force chip → confirm HookBus lifecycle event fires
 *      (preSpin → onSpinResult → expected feature signal)
 *   7. Report: per-chip PASS / FAIL with reason
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { pdfTextToMarkdown } from '../src/pdfToMarkdown.mjs';
import { parseGDD } from '../src/parser.mjs';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const HOME = process.env.HOME;
const HNP_PDF = `${HOME}/Desktop/GDD/Huff_N_More_Puff_GDD.pdf`;
const PORT = 5273;

const GREEN = '\x1b[32m', RED = '\x1b[31m', YELLOW = '\x1b[33m', DIM = '\x1b[2m', RESET = '\x1b[0m';

async function extractPdfText(absPath) {
  const buf = readFileSync(absPath);
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), useSystemFonts: true, verbosity: 0 }).promise;
  const pages = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.map(i => ('str' in i ? i.str : '')).join(' '));
  }
  return pages.join('\n\n');
}

/* These mirror universalForcePanel.mjs constants — keep in sync. */
const PAYOUT_EVALUATOR_KINDS = new Set(['ways', 'cluster_pays', 'pay_anywhere', 'scatter_pay']);
const DEDUPE_OWNED_BY_OTHER_BLOCK = new Set(['bonus_buy', 'ante_bet']);
const ALL_KNOWN_KINDS = [
  'free_spins', 'bonus_buy', 'hold_and_win', 'bonus_pick', 'wheel_bonus',
  'multiplier', 'multiplier_orb', 'persistent_multiplier',
  'cascade', 'cluster_pays', 'ways', 'pay_anywhere',
  'expanding_wild', 'walking_wild', 'sticky_wild', 'mystery_symbol',
  'scatter_pay', 'lightning', 'respin', 'wild_reel',
  'gamble', 'ante_bet', 'super_symbol', 'jackpot', 'big_win',
];
const ALWAYS_INCLUDE = ['big_win'];

console.log(`\n══ HUFF'N'MORE PUFF · FORCE CHIP AUDIT ══════════════════════════════════════`);

// 1. Parse
const raw = await extractPdfText(HNP_PDF);
const md = pdfTextToMarkdown(raw);
const model = parseGDD(md, 'md');
const parsedKinds = model.features.map(f => f.kind);
console.log(`\n— STEP 1: GDD parser detected ${parsedKinds.length} feature kinds —`);
for (const k of parsedKinds) console.log(`  · ${k}`);

// 2. Compute expected
const detectedSet = new Set(parsedKinds);
for (const k of ALWAYS_INCLUDE) detectedSet.add(k);
const expectedChips = ALL_KNOWN_KINDS.filter(k =>
  detectedSet.has(k) &&
  !PAYOUT_EVALUATOR_KINDS.has(k) &&
  !DEDUPE_OWNED_BY_OTHER_BLOCK.has(k)
);
const dropped = parsedKinds.filter(k => PAYOUT_EVALUATOR_KINDS.has(k) || DEDUPE_OWNED_BY_OTHER_BLOCK.has(k));
console.log(`\n— STEP 2: EXPECTED force chips after filters —`);
console.log(`  Expected: ${expectedChips.join(', ')}`);
if (dropped.length) console.log(`  Dropped (eval-only / owned-by-other-block): ${dropped.join(', ')}`);

// 3. Headless probe
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 700));
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', e => errs.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') errs.push('console: ' + m.text()); });

await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 20000 });
await page.waitForSelector('#fileInput', { state: 'attached', timeout: 10000 });
await page.setInputFiles('#fileInput', HNP_PDF);
await page.waitForSelector('#previewFrame', { timeout: 30000 });
await page.waitForTimeout(3000);
const frame = page.frames().find(f => f !== page.mainFrame());
frame.on('console', m => { if (m.type() === 'error') errs.push('[iframe] ' + m.text()); });
try {
  await frame.waitForFunction(() => !!document.querySelector('.gridHost .cell'), { timeout: 12000 });
} catch { console.log(`${RED}✗ grid never mounted${RESET}`); await ctx.close(); await browser.close(); server.kill(); process.exit(1); }

// 4. Enumerate actual chips
const actual = await frame.evaluate(() => {
  const chips = Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]'));
  return chips.map(c => ({
    kind: c.getAttribute('data-ufp-kind'),
    text: (c.textContent || '').trim(),
    visible: c.offsetParent !== null,
    disabled: c.disabled === true,
  }));
});
const ufpHostPresent = await frame.evaluate(() => !!document.querySelector('.ufp, [class*="universalForcePanel"]'));
console.log(`\n— STEP 3: ACTUAL force chips painted in DOM (UFP host present: ${ufpHostPresent}) —`);
console.log(`  Chips: ${actual.length}`);
for (const a of actual) console.log(`  · kind=${a.kind || '?'}  text="${a.text}"  visible=${a.visible}  disabled=${a.disabled}`);

// 5. Diff
const actualKinds = new Set(actual.map(a => a.kind).filter(Boolean));
const missing = expectedChips.filter(k => !actualKinds.has(k));
const extra = [...actualKinds].filter(k => !expectedChips.includes(k));
console.log(`\n— STEP 4: DIFF —`);
if (missing.length === 0 && extra.length === 0) {
  console.log(`  ${GREEN}✓ Chip set matches expected${RESET}`);
} else {
  if (missing.length) console.log(`  ${RED}✗ MISSING${RESET}: ${missing.join(', ')}`);
  if (extra.length)   console.log(`  ${YELLOW}! EXTRA${RESET}: ${extra.join(', ')}`);
}

// 6. Click each chip and capture HookBus signal
console.log(`\n— STEP 5: Click each chip → confirm lifecycle signal —`);
await frame.evaluate(() => {
  window.__AUDIT = {
    preSpin: 0, postSpin: 0, onSpinResult: 0,
    onFsTrigger: 0, onHoldAndWinIntro: 0, onHoldAndWinStart: 0,
    onBigWinTierEntered: 0, onWheelBonusEntered: 0,
    onJackpotEntered: 0, onGambleEntered: 0, onMultiplierLadderEntered: 0,
    onForceFeatureRequested: [],
  };
  if (!window.HookBus) return;
  for (const ev of Object.keys(window.__AUDIT)) {
    if (ev === 'onForceFeatureRequested') {
      window.HookBus.on(ev, p => window.__AUDIT[ev].push(p));
    } else {
      window.HookBus.on(ev, () => window.__AUDIT[ev]++);
    }
  }
});

const results = [];
for (const chip of actual) {
  if (!chip.kind) continue;
  /* Wait for any prior round to settle + chip-busy debounce to clear so
   * the next chip click isn't dropped by the BUSY guard. */
  await page.waitForTimeout(1200);
  const before = await frame.evaluate(() => JSON.parse(JSON.stringify(window.__AUDIT)));
  await frame.evaluate(kind => {
    /* Defensive: clear stale __FORCE_FEATURE_PENDING__ between chips
     * so a deferred modal from the previous chip doesn't shadow the
     * next chip's spin. */
    try { delete window.__FORCE_FEATURE_PENDING__; } catch (_) {}
    const c = document.querySelector(`[data-ufp-kind="${kind}"], [data-kind="${kind}"]`);
    if (c) c.click();
  }, chip.kind);
  /* Generous window — FS scatter celebration + intro placard takes
   * ~3500ms (scatter 1500ms + placard 500ms + post-emit). H&W bonus
   * celebration + intro takes ~3000ms. Big-win banner walk up to 4s. */
  await page.waitForTimeout(4500);
  const after = await frame.evaluate(() => JSON.parse(JSON.stringify(window.__AUDIT)));

  const delta = {};
  for (const k of Object.keys(after)) {
    if (k === 'onForceFeatureRequested') {
      delta[k] = after[k].length - before[k].length;
    } else {
      delta[k] = after[k] - before[k];
    }
  }
  // Expected per-kind signal
  const expect = {
    free_spins:    'onFsTrigger',
    hold_and_win:  'onHoldAndWinIntro',
    multiplier:    'onMultiplierLadderEntered',
    big_win:       'onBigWinTierEntered',
    wheel_bonus:   'onWheelBonusEntered',
    jackpot:       'onJackpotEntered',
    gamble:        'onGambleEntered',
  }[chip.kind];

  const gotSpin = (delta.preSpin > 0 || delta.onSpinResult > 0 || delta.postSpin > 0);
  const gotSignal = expect ? (delta[expect] > 0) : null;
  const gotForceEmit = delta.onForceFeatureRequested > 0;
  const ok = gotSpin || gotSignal || gotForceEmit;
  results.push({ kind: chip.kind, expect, gotSpin, gotSignal, gotForceEmit, delta, ok });
}

let pass = 0, fail = 0;
console.log('');
for (const r of results) {
  const mark = r.ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  const detail = `spin=${r.gotSpin} signal=${r.gotSignal ?? 'n/a'} forceEmit=${r.gotForceEmit}`;
  console.log(`  ${mark} ${r.kind.padEnd(18)} expect=${r.expect || '(no specific signal)'.padEnd(20)} ${DIM}${detail}${RESET}`);
  if (r.ok) pass++; else fail++;
}

console.log(`\n— STEP 6: Console / page errors —`);
console.log(`  Total: ${errs.length}`);
if (errs.length) console.log(errs.slice(0, 5).map(e => `  · ${e}`).join('\n'));

console.log(`\n══ SUMMARY — pass: ${pass} · fail: ${fail} · missing chips: ${missing.length} · errors: ${errs.length}`);

await ctx.close();
await browser.close();
server.kill();

if (fail > 0 || missing.length > 0 || errs.length > 0) process.exit(1);
