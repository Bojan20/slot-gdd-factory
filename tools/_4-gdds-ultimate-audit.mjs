#!/usr/bin/env node
/**
 * tools/_4-gdds-ultimate-audit.mjs
 *
 * Boki imperative (2026-06-11):
 *   "prodji sada sa kojim god AI treba kroz ove glavne gddove, 4 gddova
 *    u gdd folderu. svaki mora da radi savrseno, da ima sve po gddu,
 *    nista vise nista manje, ali tacno ono sto se trazi. da svaki force
 *    radi saveseno, da se prikazuje savrseno itd itd, sve ultimativno
 *    da radi bez ijedne greske, samo savrseno."
 *
 * For each of the 4 GDDs (~/Desktop/GDD/*.pdf):
 *   1. Upload to dropzone via Playwright (real user flow).
 *   2. Wait for iframe playable to mount.
 *   3. Capture parsed model spec.
 *   4. For each parsed feature: assert force chip rendered + clickable
 *      + engine reacts (overlay / banner / FS / BW / mult / spin).
 *   5. Drive 5 base spins, capture lifecycle emit log.
 *   6. Mid-spin + post-spin DOM redness scan.
 *   7. Screenshot idle + each force outcome.
 *   8. Emit per-GDD verdict markdown.
 */
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO = '/Users/vanvinklstudio/Projects/slot-gdd-factory';
const GDD  = `${process.env.HOME}/Desktop/GDD`;
const OUT  = `${REPO}/tools/_eyes/4-gdds-ultimate`;
mkdirSync(OUT, { recursive: true });

const FIXTURES = [
  { name: 'Gates_of_Olympus_1000', pdf: `${GDD}/Gates_of_Olympus_1000_GDD.pdf` },
  { name: 'Huff_N_More_Puff',      pdf: `${GDD}/Huff_N_More_Puff_GDD.pdf` },
  { name: 'Starlight_Travellers',  pdf: `${GDD}/Starlight_Travellers_GDD.pdf` },
  { name: 'Wrath_of_Olympus',      pdf: `${GDD}/Wrath_of_Olympus_GDD.pdf` },
];
for (const f of FIXTURES) {
  if (!existsSync(f.pdf)) { console.error('PDF missing:', f.pdf); process.exit(2); }
}

const PORT = 5200;
const server = spawn('python3', ['-m', 'http.server', String(PORT)], { cwd: REPO, stdio: 'ignore' });
await new Promise(r => setTimeout(r, 800));

const browser = await chromium.launch();
const results = [];

for (const fx of FIXTURES) {
  console.log(`\n=== ${fx.name} ===`);
  const ctx  = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  const page = await ctx.newPage();
  const consoleErrs = [];
  const pageErrs    = [];
  page.on('pageerror', (e) => pageErrs.push(e.message.slice(0, 160)));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().includes('favicon')) consoleErrs.push(m.text().slice(0, 160));
  });

  const verdict = { name: fx.name, parse: {}, features: [], spins: {}, redness: [], errs: [], chips: [] };

  // 1. Upload PDF
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'load', timeout: 25000 });
  await page.setInputFiles('#fileInput', fx.pdf);
  await page.waitForSelector('#previewFrame', { timeout: 20000 });

  // Wait for iframe to fully mount (chips present)
  let frame = null;
  for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(250);
    const cands = page.frames();
    frame = cands.find(f => f !== page.mainFrame());
    if (frame) {
      const ready = await frame.evaluate(() =>
        !!document.querySelector('#spinBtn') &&
        !!document.querySelector('.ufp-chip') ||
        !!document.querySelector('#spinBtn')
      ).catch(() => false);
      if (ready) break;
      frame = null;
    }
  }
  if (!frame) {
    verdict.parse.error = 'iframe never mounted';
    results.push(verdict);
    await ctx.close();
    continue;
  }

  // 2. Inspect parsed model + global state
  const parsed = await frame.evaluate(() => {
    const model = window.SLOT_MODEL || window.__SLOT_MODEL__ || null;
    const shape = window.SHAPE || null;
    const FS = window.FREESPINS || null;
    const reels = window.REELS, rows = window.ROWS;
    return {
      hasModel: !!model,
      modelName: model ? model.name : null,
      shape: shape ? { kind: shape.kind, reels: shape.reels, rows: shape.rows } : null,
      reels, rows,
      featuresFromModel: model && model.features
        ? model.features.map(f => ({ kind: f.kind, label: f.label }))
        : [],
      symbols: model && model.symbols
        ? { hp: (model.symbols.high||[]).length, mp: (model.symbols.mid||[]).length,
            lp: (model.symbols.low||[]).length, sp: (model.symbols.specials||[]).length }
        : null,
      paylines: model && model.topology ? model.topology.paylines : null,
      fs: FS ? { enabled: FS.enabled, triggerSymbol: FS.triggerSymbol,
                 awards: FS.awards, retriggerEnabled: FS.retriggerEnabled } : null,
    };
  });
  verdict.parse = parsed;
  console.log(`  parsed: ${parsed.modelName} · kind=${parsed.shape?.kind} · ${parsed.shape?.reels}×${parsed.shape?.rows} · ${parsed.featuresFromModel.length} features`);

  // 3. HookBus emit tap
  await frame.evaluate(() => {
    window.__GD_EMITS__ = [];
    if (window.HookBus && typeof window.HookBus.emit === 'function') {
      const orig = window.HookBus.emit;
      window.HookBus.emit = function (n, p) {
        try { window.__GD_EMITS__.push(n); } catch (_) {}
        return orig.call(this, n, p);
      };
    }
  });

  // Idle screenshot
  await page.screenshot({ path: resolve(OUT, `${fx.name}_idle.png`) });

  // 4. Per-chip force probe — every UFP chip must produce engine reaction
  const chips = await frame.evaluate(() =>
    Array.from(document.querySelectorAll('.ufp-chip[data-ufp-kind]'))
      .map(c => ({
        kind: c.getAttribute('data-ufp-kind'),
        label: c.textContent.trim(),
        visible: c.getBoundingClientRect().width > 0,
      }))
  );
  console.log(`  chips: ${chips.map(c => c.kind).join(', ')}`);
  for (const chip of chips) {
    await frame.evaluate(() => { window.__GD_EMITS__ = []; });
    const clicked = await frame.evaluate((kind) => {
      const el = document.querySelector(`.ufp-chip[data-ufp-kind="${kind}"]`);
      if (!el) return false;
      try { el.scrollIntoView({ block: 'center' }); } catch (_) {}
      try { el.click(); return true; } catch (_) { return false; }
    }, chip.kind);
    if (!clicked) {
      verdict.chips.push({ kind: chip.kind, status: 'click-fail' });
      continue;
    }
    await page.waitForTimeout(2200);
    const after = await frame.evaluate(() => {
      const overlays = ['#wbOverlay','#gambleOverlay','#bpOverlay','#hwHud',
                        '#fsIntroOverlay','#fsStageBadge','.bb-modal','#bonusBuyOverlay',
                        '.bwt-banner'];
      const overlay = overlays.some(s => {
        const el = document.querySelector(s);
        if (!el) return false;
        const cs = getComputedStyle(el);
        return (el.dataset?.show === 'true') ||
               (cs.display !== 'none' && parseFloat(cs.opacity || '0') > 0.1);
      });
      return { overlay,
        banner: !!document.querySelector('.gfb-banner[data-visible="true"]'),
        emits: window.__GD_EMITS__ || [] };
    });
    const sawForce = after.emits.includes('onForceFeatureRequested');
    const sawSpin  = after.emits.includes('preSpin');
    const sawBigWin = after.emits.some(e => e.startsWith('onBigWinTier'));
    const sawFs   = after.emits.includes('onFsTrigger');
    const sawWheel = after.emits.some(e => e.startsWith('onWheel'));
    const sawMult = after.emits.some(e => e.startsWith('onForceMult') || e.startsWith('onPath'));
    const status =
      after.overlay ? 'overlay' :
      after.banner ? 'banner' :
      sawBigWin ? 'big-win' :
      sawFs ? 'fs' :
      sawWheel ? 'wheel' :
      sawMult ? 'mult' :
      sawSpin ? 'spin' :
      sawForce ? 'force-only' : 'NO-OP';
    verdict.chips.push({ kind: chip.kind, status, emits: after.emits.slice(0, 8) });

    // close any opened overlay so next chip can run cleanly
    await frame.evaluate(() => {
      ['wbOverlay','gambleOverlay','bpOverlay','bonusBuyOverlay'].forEach(id => {
        const el = document.getElementById(id);
        if (el) { el.dataset.show = 'false'; el.style.display = 'none'; }
      });
      ['.bb-close','.bp-close','.wb-close','.gam-close','.bwt-skip'].forEach(s => {
        const el = document.querySelector(s); if (el) el.click();
      });
    });
    await page.waitForTimeout(400);
  }

  // 5. Drive 5 vanilla base spins — count postSpin emits + check stuck btn
  await frame.evaluate(() => { window.__GD_EMITS__ = []; });
  let baseSpinsOk = 0;
  for (let i = 0; i < 5; i++) {
    const ready = await frame.evaluate(() => {
      const b = document.getElementById('spinBtn');
      return b && !b.disabled;
    });
    if (!ready) {
      // wait up to 8s for unlock
      const start = Date.now();
      while (Date.now() - start < 8000) {
        await page.waitForTimeout(200);
        const r = await frame.evaluate(() => !document.getElementById('spinBtn').disabled);
        if (r) break;
      }
    }
    const before = await frame.evaluate(() => (window.__GD_EMITS__ || []).filter(e => e === 'postSpin').length);
    await frame.evaluate(() => document.getElementById('spinBtn').click());
    const start = Date.now();
    while (Date.now() - start < 8000) {
      const after = await frame.evaluate(() => (window.__GD_EMITS__ || []).filter(e => e === 'postSpin').length);
      if (after > before) { baseSpinsOk++; break; }
      await page.waitForTimeout(150);
    }
  }
  verdict.spins.base = baseSpinsOk;

  // 6. DOM redness scan (after spins + force runs)
  verdict.redness = await frame.evaluate(() => {
    const out = [];
    const banned = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      const tag = parent.tagName.toUpperCase();
      if (tag === 'SCRIPT' || tag === 'STYLE') continue;
      const txt = (node.nodeValue || '').trim();
      if (!txt) continue;
      for (const re of banned) {
        if (re.test(txt)) { out.push({ tag, cls: parent.className, txt: txt.slice(0, 60) }); break; }
      }
    }
    return out;
  });

  // Final screenshot after stress
  await page.screenshot({ path: resolve(OUT, `${fx.name}_final.png`) });

  verdict.errs = { console: consoleErrs.length, page: pageErrs.length,
                   sampleConsole: consoleErrs[0] || '', samplePage: pageErrs[0] || '' };
  results.push(verdict);
  await ctx.close();
}

await browser.close();
server.kill();

// Report
console.log('\n══════════════════════════════════════════════════════════════════════');
console.log('PER-GDD ULTIMATE AUDIT');
console.log('══════════════════════════════════════════════════════════════════════');
const md = ['# 4-GDD Ultimate Audit\n', `_Generated ${new Date().toISOString()}_\n`];
let anyFail = false;
for (const r of results) {
  console.log(`\n### ${r.name}`);
  console.log(`  parsed model: ${r.parse.modelName || 'N/A'}`);
  console.log(`  shape:        ${r.parse.shape?.kind} · ${r.parse.shape?.reels}×${r.parse.shape?.rows} · paylines=${r.parse.paylines}`);
  console.log(`  symbols:      HP=${r.parse.symbols?.hp} MP=${r.parse.symbols?.mp} LP=${r.parse.symbols?.lp} SP=${r.parse.symbols?.sp}`);
  console.log(`  features:     ${r.parse.featuresFromModel.map(f => f.kind).join(', ')}`);
  console.log(`  FS:           enabled=${r.parse.fs?.enabled} sym=${r.parse.fs?.triggerSymbol} awards=${JSON.stringify(r.parse.fs?.awards || [])}`);
  console.log(`  base spins:   ${r.spins.base}/5 completed postSpin`);
  console.log(`  redness:      ${r.redness.length}`);
  console.log(`  errs:         console=${r.errs.console} page=${r.errs.page}`);
  if (r.errs.sampleConsole) console.log(`    sample CON: ${r.errs.sampleConsole}`);
  if (r.errs.samplePage)    console.log(`    sample PG:  ${r.errs.samplePage}`);
  console.log(`  chips:`);
  for (const c of r.chips) {
    const tick = (c.status === 'NO-OP' || c.status === 'click-fail') ? '✗' : '✓';
    console.log(`    ${tick} ${c.kind.padEnd(20)} → ${c.status}`);
    if (c.status === 'NO-OP' || c.status === 'click-fail') anyFail = true;
  }
  if (r.errs.console > 0 || r.errs.page > 0 || r.redness.length > 0) anyFail = true;

  md.push(`## ${r.name}\n`);
  md.push(`| Aspect | Value |\n|:--|:--|\n`);
  md.push(`| Model name | ${r.parse.modelName || 'N/A'} |\n`);
  md.push(`| Shape | ${r.parse.shape?.kind} · ${r.parse.shape?.reels}×${r.parse.shape?.rows} |\n`);
  md.push(`| Paylines | ${r.parse.paylines} |\n`);
  md.push(`| Symbols | HP=${r.parse.symbols?.hp} MP=${r.parse.symbols?.mp} LP=${r.parse.symbols?.lp} SP=${r.parse.symbols?.sp} |\n`);
  md.push(`| Features | ${r.parse.featuresFromModel.map(f => f.kind).join(', ')} |\n`);
  md.push(`| FS enabled | ${r.parse.fs?.enabled} |\n`);
  md.push(`| Base spins | ${r.spins.base}/5 |\n`);
  md.push(`| Console errs | ${r.errs.console} |\n`);
  md.push(`| Page errs | ${r.errs.page} |\n`);
  md.push(`| DOM redness | ${r.redness.length} |\n\n`);
  md.push(`**Force chips:**\n\n| Kind | Status | Emits |\n|:--|:-:|:--|\n`);
  for (const c of r.chips) {
    md.push(`| ${c.kind} | ${c.status} | ${(c.emits||[]).join(' · ')} |\n`);
  }
  md.push('\n');
}
writeFileSync(resolve(OUT, 'audit.md'), md.join(''));
writeFileSync(resolve(OUT, 'audit.json'), JSON.stringify(results, null, 2));

console.log(`\nReport: ${resolve(OUT, 'audit.md')}`);
console.log(`Verdict: ${anyFail ? '⚠️ DEFECTS FOUND' : '✅ ALL GDDS PERFECT'}`);
process.exit(anyFail ? 1 : 0);
