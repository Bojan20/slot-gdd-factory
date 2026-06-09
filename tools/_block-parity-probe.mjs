#!/usr/bin/env node
/**
 * tools/_block-parity-probe.mjs
 *
 * Boki imperative (09.06.2026): "svi blokovi i forsovi i win prezentacije,
 * i counteri i big winovi, sve radi u rectangle. sad samo napravi da se
 * blokovi ucitaju tako kao u rectangle na osnovu gdd-a, ali da rade kao u
 * rectangle, potpuno savrseno."
 *
 * What this probe does
 * ────────────────────
 * For TWO baselines:
 *   A) rectangle    (samples/grids/01_rectangular_5x3_GAME_GDD.md)
 *   B) Huff & Puff  (~/Desktop/GDD/Huff_N_More_Puff_GDD.pdf)
 *
 * It opens the playable in a real browser, then collects evidence for
 * EVERY block that should be present in the rectangle baseline:
 *
 *   1. CSS class footprint    — does the block emit any CSS at all?
 *   2. Markup DOM presence    — does the canonical selector exist?
 *   3. Runtime exposure       — does the global API surface exist?
 *
 * It then DIFFs the two and prints a per-block parity table:
 *
 *   block               rectangle    huff
 *   uiToast             ✓✓✓          ✓✓✓
 *   bigWinTier          ✓✓✓          ✗✗✗   ← gap: needs template fix
 *   …
 *
 * Exit 0 = parity reached (every block live in rectangle is also live in
 * huff). Exit 1 = at least one block is enabled in rectangle but missing
 * in huff (a template gap, NOT a game-specific quirk).
 */

import { chromium } from 'playwright';
import { spawn }    from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname }                     from 'node:path';
import { fileURLToPath }                        from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes/block-parity');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const HOME = process.env.HOME;
function _resolveGdd(filename) {
  const newP = `${HOME}/Desktop/GDD/${filename}`;
  const oldP = `${HOME}/Desktop/${filename}`;
  return existsSync(newP) ? newP : oldP;
}
const HUFF_PDF = _resolveGdd('Huff_N_More_Puff_GDD.pdf');
if (!existsSync(HUFF_PDF)) {
  console.error(`PDF not found: ${HUFF_PDF}`);
  process.exit(2);
}

const PORT = 5258;
const URL  = `http://127.0.0.1:${PORT}/`;
const srv = spawn('node', ['-e', `
const http=require('http'),fs=require('fs'),path=require('path'),url=require('url');
const R='${REPO}';
http.createServer((req,res)=>{
  let p=decodeURIComponent(url.parse(req.url).pathname); if(p==='/')p='/index.html';
  const f=path.normalize(path.join(R,p));
  if(!f.startsWith(R)){res.writeHead(403);return res.end();}
  fs.stat(f,(e,st)=>{
    if(e||!st.isFile()){res.writeHead(404);return res.end('404 '+p);}
    const M={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.pdf':'application/pdf'};
    const ext=path.extname(f).toLowerCase();
    res.writeHead(200,{'Content-Type':M[ext]||'application/octet-stream','Cache-Control':'no-store'});
    fs.createReadStream(f).pipe(res);
  });
}).listen(${PORT},'127.0.0.1');
`], { cwd: REPO, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise(r => setTimeout(r, 700));

/**
 * Each row = a block in the rectangle baseline.
 * cssClass = a class that the block emits (any one match suffices).
 * markupSel = canonical DOM selector that proves the markup is in DOM.
 * runtimeFn = a `window.*` property the block exposes (any one match).
 */
const BLOCKS = [
  { name: 'spinControl',            cssClass: 'spin-control-btn',  markupSel: '#spinBtn',                runtimeFn: 'runOneBaseSpin' },
  { name: 'reelEngine',             cssClass: 'reelCol',           markupSel: '.cell, [data-cell], text', runtimeFn: 'runOneBaseSpin' },
  { name: 'autoplay',               cssClass: 'autoplay-toggle',   markupSel: '#autoBtn',                runtimeFn: 'autoplayStop' },
  { name: 'betSelector',            cssClass: 'bet-chip',          markupSel: '#betChip',                runtimeFn: '__SLOT_BET__' },
  { name: 'turboMode',              cssClass: 'turbo-btn',         markupSel: '#turboBtn',               runtimeFn: 'turboModeToggle' },
  { name: 'settingsPanel',          cssClass: 'settings-btn',      markupSel: '.settings-btn',           runtimeFn: 'settingsPanelToggle' },
  { name: 'paytable',               cssClass: 'paytable-btn',      markupSel: '.paytable-btn',           runtimeFn: 'paytableShow' },
  { name: 'historyLog',             cssClass: 'history-btn',       markupSel: '.history-btn',            runtimeFn: 'historyLogShow' },
  { name: 'balanceHud',             cssClass: 'balance-hud',       markupSel: '.balance-hud, .hub',      runtimeFn: '__SLOT_BALANCE__' },
  { name: 'winRollup',              cssClass: 'win-rollup',        markupSel: '.win-rollup, [data-win-rollup]', runtimeFn: '__WIN_AWARD__' },
  { name: 'bigWinTier',             cssClass: 'big-win-tier',      markupSel: '.big-win-tier-banner, .bigwin-banner', runtimeFn: 'bigWinTierEnter' },
  { name: 'uiToast',                cssClass: 'ui-toast',          markupSel: '.ui-toast, .toast',       runtimeFn: 'uiToast' },
  { name: 'freeSpins',              cssClass: 'fs-hud',            markupSel: '.fs-hud, .freespins-hud', runtimeFn: 'FREESPINS' },
  { name: 'scatterCelebration',     cssClass: 'scatter-celebrate', markupSel: 'body',                    runtimeFn: 'playScatterCelebration' },
  { name: 'anticipation',           cssClass: 'reelCol--anticipating', markupSel: 'body',                runtimeFn: 'maybeArmAnticipation' },
  { name: 'paylineOverlay',         cssClass: 'payline-overlay',   markupSel: '.payline-overlay',        runtimeFn: 'ensurePaylineOverlay' },
  { name: 'winPresentation',        cssClass: 'win-cycle',         markupSel: 'body',                    runtimeFn: 'applyWinHighlight' },
  { name: 'hookBus',                cssClass: 'fs-hud',            markupSel: 'body',                    runtimeFn: 'HookBus' },
  { name: 'stageBadge',             cssClass: 'stage-badge',       markupSel: '.stage-badge, .header .badge', runtimeFn: 'HookBus' },
  { name: 'universalForcePanel',    cssClass: 'ufp-panel',         markupSel: '.ufp-panel',              runtimeFn: 'universalForcePanelShow' },
  { name: 'genericFeatureBanner',   cssClass: 'gfb-banner',        markupSel: '.gfb-banner',             runtimeFn: 'HookBus' },
  { name: 'realityCheck',           cssClass: 'reality-check',     markupSel: '.reality-check-modal, .rc-backdrop', runtimeFn: 'realityCheckShow' },
  { name: 'sessionTimeout',         cssClass: 'session-timeout',   markupSel: '.session-timeout-modal, .stm-backdrop', runtimeFn: 'sessionTimeoutForceShow' },
  { name: 'netLossIndicator',       cssClass: 'net-loss',          markupSel: '.net-loss-chip, .nli-chip', runtimeFn: 'HookBus' },
];

async function probeURL(label, page, navUrl, dropPdf = null) {
  const errs = [];
  const warns = [];
  page.on('console', m => {
    if (m.type() === 'error')   errs.push(m.text());
    if (m.type() === 'warning') warns.push(m.text());
  });
  page.on('pageerror', e => errs.push(String(e)));

  if (dropPdf) {
    await page.goto(URL, { waitUntil: 'networkidle' });
    const fi = page.locator('input[type="file"]').first();
    await fi.setInputFiles(dropPdf);
    await page.waitForSelector('iframe', { timeout: 30000 });
    const fe = await page.$('iframe');
    const fr = await fe.contentFrame();
    await fr.waitForSelector('.cell, text, [data-cell]', { timeout: 15000 });
    return { frame: fr, errs, warns };
  } else {
    await page.goto(navUrl, { waitUntil: 'networkidle' });
    await page.waitForSelector('.cell, text, [data-cell]', { timeout: 15000 });
    return { frame: page, errs, warns };
  }
}

async function checkBlock(frame, b) {
  const cssMatch = await frame.evaluate(cls => {
    const head = document.querySelector('style, head');
    const styles = Array.from(document.querySelectorAll('style')).map(s => s.textContent).join('\n');
    return styles.includes('.' + cls);
  }, b.cssClass);
  const domMatch = await frame.$(b.markupSel).then(el => !!el).catch(() => false);
  const rtMatch  = await frame.evaluate(name => {
    try { return typeof window[name] !== 'undefined' && window[name] !== null; }
    catch (_) { return false; }
  }, b.runtimeFn);
  return { css: !!cssMatch, dom: !!domMatch, rt: !!rtMatch };
}

console.log('\n🔬 Block parity probe — rectangle vs Huff & Puff\n');

const browser = await chromium.launch({ headless: true });

/* A) Rectangle baseline — pre-built dist HTML */
let ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let pageA = await ctxA.newPage();
const rectURL = `${URL}dist/01_rectangular_5x3_playable.html`;
const A = await probeURL('rect', pageA, rectURL, null);
const rectResults = {};
for (const b of BLOCKS) rectResults[b.name] = await checkBlock(A.frame, b);

/* B) Huff & Puff — PDF drag through real app */
let ctxB = await browser.newContext({ viewport: { width: 1440, height: 900 } });
let pageB = await ctxB.newPage();
const B = await probeURL('huff', pageB, URL, HUFF_PDF);
const huffResults = {};
for (const b of BLOCKS) huffResults[b.name] = await checkBlock(B.frame, b);

/* Print results */
const rpad = (s, n) => (s + ' '.repeat(n)).slice(0, n);
const tri  = (r) => `${r.css ? '✓' : '✗'}${r.dom ? '✓' : '✗'}${r.rt ? '✓' : '✗'}`;

console.log(rpad('block', 28) + rpad('rect (css|dom|rt)', 22) + rpad('huff (css|dom|rt)', 22) + 'gap');
console.log('─'.repeat(82));
let gapCount = 0;
const gaps = [];
for (const b of BLOCKS) {
  const r = rectResults[b.name];
  const h = huffResults[b.name];
  const rSig = tri(r);
  const hSig = tri(h);
  let gap = '';
  /* Gap = block green in rect but red in huff. Either css/dom/rt missing
     in huff while present in rect = template parity violation. */
  const cssGap = r.css && !h.css;
  const domGap = r.dom && !h.dom;
  const rtGap  = r.rt  && !h.rt;
  if (cssGap || domGap || rtGap) {
    gap = (cssGap ? 'css ' : '') + (domGap ? 'dom ' : '') + (rtGap ? 'rt' : '');
    gapCount++;
    gaps.push({ block: b.name, cssGap, domGap, rtGap });
  }
  console.log(rpad(b.name, 28) + rpad(rSig, 22) + rpad(hSig, 22) + gap);
}
console.log('─'.repeat(82));
console.log(`Frame console: rect errs=${A.errs.length} warns=${A.warns.length} · huff errs=${B.errs.length} warns=${B.warns.length}`);
if (A.errs.length) console.log('  rect errors:', A.errs.slice(0,5));
if (B.errs.length) console.log('  huff errors:', B.errs.slice(0,5));

writeFileSync(
  resolve(OUT, 'parity-report.json'),
  JSON.stringify({ rectResults, huffResults, gaps, rectErrs: A.errs, huffErrs: B.errs }, null, 2)
);

await browser.close();
try { srv.kill('SIGKILL'); } catch (_) {}

console.log(`\nResult: ${gapCount === 0 ? '✅ PARITY' : `❌ ${gapCount} block(s) live in rect, missing in huff`}\n`);
if (gaps.length) {
  console.log('Template gaps (block green in rect, red in huff):');
  for (const g of gaps) console.log(`  · ${g.block}: ${[g.cssGap && 'css', g.domGap && 'dom', g.rtGap && 'rt'].filter(Boolean).join('+')}`);
}
process.exit(gapCount === 0 ? 0 : 1);
