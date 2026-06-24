#!/usr/bin/env node
/**
 * UQ-DEEP-G deep-QA — exhaustive runtime audit of the web-uploader F atom.
 * 7 scenarios in a single chromium run.
 */
import { chromium } from 'playwright';
import { readFileSync, existsSync } from 'node:fs';

const URL = 'http://127.0.0.1:5181/';
const SAMPLES = [
  '/Users/vanvinklstudio/Projects/slot-gdd-factory/samples/CRYSTAL_FORGE_GAME_GDD.md',
  '/Users/vanvinklstudio/Projects/slot-gdd-factory/samples/MIDNIGHT_FANGS_GAME_GDD.md',
  '/Users/vanvinklstudio/Projects/slot-gdd-factory/samples/WRATH_OF_OLYMPUS_GAME_GDD.md',
].filter(existsSync);

const findings = [];
function note(sev, scen, msg) { findings.push({ sev, scen, msg }); console.log(`[${sev}] ${scen} — ${msg}`); }

async function ingest(page, samplePath, slug = null) {
  const bytes = readFileSync(samplePath);
  const fname = samplePath.split('/').pop();
  await page.evaluate(async ({ b64, fn }) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bin], fn, { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, { b64: Buffer.from(bytes).toString('base64'), fn: fname });
  await page.waitForTimeout(200);
  if (slug !== null) await page.fill('#slug', slug);
  await page.click('#go');
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    const last = await page.$$eval('#timeline .step', els => {
      const last = els[els.length - 1];
      return last ? { text: last.textContent, ok: last.className.includes('ok') } : null;
    });
    if (last && (/done/i.test(last.text) || /fail|error/.test(last.text.toLowerCase()))) {
      return { last, elapsed: Date.now() - t0 };
    }
    await page.waitForTimeout(150);
  }
  return null;
}

const browser = await chromium.launch({ headless: true });

/* ── Scenario 1: baseline ingest CRYSTAL_FORGE ──────────────────── */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) note('PAGEERR', 'S1', e.message); });
  await page.goto(URL); await page.waitForSelector('#go');
  const r = await ingest(page, SAMPLES[0]);
  if (!r) note('CRIT', 'S1', '30s timeout on baseline');
  else if (!/done/i.test(r.last.text)) note('FAIL', 'S1', 'baseline ended with: ' + r.last.text.slice(0, 100));
  else note('OK', 'S1', `baseline ingest done in ${r.elapsed}ms`);
  await ctx.close();
}

/* ── Scenario 2: rapid double-click on ingest (re-entrance) ──────── */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) note('PAGEERR', 'S2', e.message); });
  await page.goto(URL); await page.waitForSelector('#go');
  const bytes = readFileSync(SAMPLES[0]);
  await page.evaluate(async (b64) => {
    const bin = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
    const file = new File([bin], 'X.md', { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, Buffer.from(bytes).toString('base64'));
  await page.waitForTimeout(200);
  /* Spam-click 5× in 50ms. */
  for (let i = 0; i < 5; i++) { page.click('#go').catch(() => {}); await page.waitForTimeout(10); }
  await page.waitForTimeout(5000);
  const errs = await page.$$eval('#timeline .step.fail', els => els.length);
  if (errs > 0) note('MED', 'S2', `${errs} fail steps after spam-click — re-entrance risk`);
  else note('OK', 'S2', 'spam-click handled gracefully');
  await ctx.close();
}

/* ── Scenario 3: ingest invalid file (empty buffer) ──────────────── */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) note('PAGEERR', 'S3', e.message); });
  await page.goto(URL); await page.waitForSelector('#go');
  await page.evaluate(async () => {
    const file = new File([new Uint8Array(0)], 'empty.md', { type: 'text/markdown' });
    const dt = new DataTransfer();
    dt.items.add(file);
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  });
  await page.waitForTimeout(200);
  await page.click('#go');
  await page.waitForTimeout(5000);
  const last = await page.$$eval('#timeline .step', els => {
    const x = els[els.length - 1];
    return x ? { text: x.textContent, cls: x.className } : null;
  });
  if (!last) note('CRIT', 'S3', 'no timeline step for empty file');
  else if (/done/i.test(last.text)) note('MED', 'S3', 'empty file produced done (expected fail or graceful skip)');
  else note('OK', 'S3', 'empty file surfaced as: ' + last.text.slice(0, 80));
  await ctx.close();
}

/* ── Scenario 4: ingest sequence (back-to-back 3 GDDs) ───────────── */
if (SAMPLES.length >= 2) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', e => { if (!/serviceWorker/i.test(e.message)) note('PAGEERR', 'S4', e.message); });
  await page.goto(URL); await page.waitForSelector('#go');
  let prevSlug = null;
  for (const s of SAMPLES.slice(0, 2)) {
    const slug = 'qa-' + Date.now().toString(36);
    const r = await ingest(page, s, slug);
    if (!r) { note('FAIL', 'S4', `${s.split('/').pop()} timeout`); break; }
    if (!/done/i.test(r.last.text)) { note('FAIL', 'S4', `${s.split('/').pop()} fail: ${r.last.text.slice(0, 80)}`); break; }
    /* Clear timeline for next iter so previous events don't pollute lookup. */
    await page.evaluate(() => { document.getElementById('timeline').innerHTML = '<div class="empty">drop a file</div>'; });
    prevSlug = slug;
  }
  if (prevSlug) note('OK', 'S4', `sequential ingest x${SAMPLES.length >= 2 ? 2 : 1} done`);
  await ctx.close();
}

/* ── Scenario 5: status endpoint stable ──────────────────────────── */
{
  const r = await fetch(URL + 'status');
  const j = await r.json();
  if (j.ok && j.server === 'web-uploader') note('OK', 'S5', `status liveness ok (uptime ${j.uptimeSec}s)`);
  else note('FAIL', 'S5', 'status endpoint malformed: ' + JSON.stringify(j));
}

/* ── Scenario 6: preview iframe sandbox restrictions ─────────────── */
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(URL); await page.waitForSelector('#go');
  await ingest(page, SAMPLES[0]);
  await page.waitForTimeout(1500);
  const sandbox = await page.$eval('#preview iframe', el => el.getAttribute('sandbox')).catch(() => null);
  if (!sandbox) note('HIGH', 'S6', 'preview iframe missing sandbox attribute');
  else if (!sandbox.includes('allow-scripts')) note('HIGH', 'S6', 'sandbox missing allow-scripts: ' + sandbox);
  else if (sandbox.includes('allow-same-origin')) note('CRIT', 'S6', 'sandbox has allow-same-origin (XSS-out-of-sandbox risk): ' + sandbox);
  else note('OK', 'S6', 'iframe sandbox: ' + sandbox);
  await ctx.close();
}

/* ── Scenario 7: /report/<slug> JSON shape ───────────────────────── */
{
  const r = await fetch(URL + 'report/crystal-forge-game-gdd');
  if (!r.ok) note('FAIL', 'S7', `report fetch HTTP ${r.status}`);
  else {
    const j = await r.json();
    if (!j.slug) note('HIGH', 'S7', 'report missing slug field');
    else if (!j.v8) note('MED', 'S7', 'report missing v8 — was ingest --no-llm?');
    else note('OK', 'S7', `report shape ok (v8=${!!j.v8}, v9=${!!j.v9}, par=${!!j.par})`);
  }
}

console.log(`\nTotal: ${findings.length}`);
const sevCounts = findings.reduce((acc, f) => (acc[f.sev] = (acc[f.sev] || 0) + 1, acc), {});
console.log('By severity:', sevCounts);
await browser.close();
process.exit(findings.some(f => f.sev === 'CRIT' || f.sev === 'FAIL') ? 1 : 0);
