#!/usr/bin/env node
/**
 * UQ-DEEP-AL · QA-1 · LIVE PLAYWRIGHT DEEP PROBE
 *
 * Ultra-deep runtime QA on 5 rendered preview slots. NOT a happy-path
 * demo — actively hunts for: console errors, page errors, dialogs,
 * vendor-brand leaks, NaN/Infinity bleed, grid-dim drift, HookBus
 * starvation, RTP HUD NaN.
 *
 * Usage: node tools/_uq-deep-al-live-deep-qa.mjs [--spins=100]
 */
import { chromium } from 'playwright';

const PORT = Number(process.env.PORT || 5181);
const BASE = `http://127.0.0.1:${PORT}/preview`;
const SPINS = Number((process.argv.find((a) => a.startsWith('--spins=')) || '').split('=')[1] || 100);

const SLUGS = [
  'cash-eruption-foundry-gdd',
  'crystal-forge-game-gdd',
  'midnight-fangs-game-gdd',
  'wrath-of-olympus-game-gdd',
  'gates-of-olympus-1000-game-gdd',
];

/** Vendor-brand leak detector — case-insensitive substring. */
const BANNED = [
  'IGT', 'Pragmatic', 'Cash Eruption', 'Wolf Run', 'Cleopatra',
  'Buffalo', 'Gates of Olympus', 'Wrath of Olympus', 'NetEnt', 'Microgaming',
];
const BANNED_RE = new RegExp(BANNED.map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'i');

/** NaN / Infinity / "undefined" string-bleed detector. */
const NAN_RE = /\b(NaN|Infinity|undefined)\b/;

function fmtList(arr, n = 5) {
  if (!arr.length) return '(none)';
  const head = arr.slice(0, n).map((x) => '    • ' + String(x).replace(/\n/g, ' ').slice(0, 160)).join('\n');
  const rest = arr.length > n ? `\n    … +${arr.length - n} more` : '';
  return head + rest;
}

async function probeSlug(browser, slug) {
  const url = `${BASE}/${slug}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();

  const consoleErrors = [];
  const consoleWarnings = [];
  const pageErrors = [];
  const dialogs = [];
  const requestFailures = [];

  page.on('console', (msg) => {
    const t = msg.type();
    const text = msg.text();
    if (t === 'error') consoleErrors.push(text);
    else if (t === 'warning') consoleWarnings.push(text);
  });
  page.on('pageerror', (e) => {
    /* Drop service-worker noise that the existing suite tolerates. */
    if (/serviceWorker/i.test(e.message)) return;
    pageErrors.push(e.message);
  });
  page.on('dialog', async (d) => {
    dialogs.push({ type: d.type(), message: d.message() });
    try { await d.dismiss(); } catch {}
  });
  page.on('requestfailed', (req) => {
    requestFailures.push(`${req.method()} ${req.url()} — ${req.failure()?.errorText || 'fail'}`);
  });
  page.on('response', (res) => {
    const s = res.status();
    if (s >= 400) requestFailures.push(`${s} ${res.url()}`);
  });

  let gotoErr = null;
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 20000 });
  } catch (e) {
    gotoErr = e.message;
  }

  /* ── HookBus tap installed early so first spins are captured. ── */
  await page.evaluate(() => {
    window.__UQ_AL_HOOK_COUNTS__ = {};
    const tryInstall = () => {
      const bus = window.HookBus;
      if (!bus || typeof bus.on !== 'function' || window.__UQ_AL_TAPPED__) return false;
      window.__UQ_AL_TAPPED__ = true;
      const orig = bus.emit && bus.emit.bind(bus);
      if (orig) {
        bus.emit = function (evt, ...args) {
          try { window.__UQ_AL_HOOK_COUNTS__[evt] = (window.__UQ_AL_HOOK_COUNTS__[evt] || 0) + 1; } catch {}
          return orig(evt, ...args);
        };
      }
      return true;
    };
    if (!tryInstall()) {
      const iv = setInterval(() => { if (tryInstall()) clearInterval(iv); }, 50);
      setTimeout(() => clearInterval(iv), 5000);
    }
  });

  /* Install grid MutationObserver. Real container id in this codebase is
   * `gridHost`; fall back to `grid` for forward-compat. */
  await page.evaluate(() => {
    window.__UQ_AL_MUT__ = { total: 0, byType: { childList: 0, attributes: 0, characterData: 0 } };
    const target = document.getElementById('gridHost') || document.getElementById('grid');
    if (!target) { window.__UQ_AL_MUT__.noGrid = true; return; }
    window.__UQ_AL_MUT__.containerId = target.id;
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        window.__UQ_AL_MUT__.total++;
        window.__UQ_AL_MUT__.byType[r.type] = (window.__UQ_AL_MUT__.byType[r.type] || 0) + 1;
      }
    });
    mo.observe(target, { childList: true, subtree: true, attributes: true, characterData: true });
    window.__UQ_AL_MUT__.observer = '_installed_';
  });

  /* ── Static sanity (title, body, RTP HUD, spin btn, grid). ── */
  const title = await page.title().catch(() => '');
  const bodyText = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  const bodyHTML = await page.evaluate(() => document.body.innerHTML || '').catch(() => '');

  const titleVendorLeak = BANNED_RE.test(title) ? (title.match(BANNED_RE) || [''])[0] : null;
  const bodyVendorMatches = [];
  for (const v of BANNED) {
    const re = new RegExp(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    if (re.test(bodyText)) bodyVendorMatches.push(v);
  }

  /* Look for literal NaN/Infinity/undefined in rendered text (not in scripts). */
  const nanInBody = NAN_RE.test(bodyText);
  let nanSamples = [];
  if (nanInBody) {
    const lines = bodyText.split('\n').filter((l) => NAN_RE.test(l));
    nanSamples = lines.slice(0, 5);
  }

  const rtpHudPresent = await page.$('#liveRtpHud') !== null;
  const measuredRtpEarly = await page.$eval('#lrhMeasured', (el) => el.textContent).catch(() => null);
  const spinBtnPresent = await page.$('#spinBtn') !== null;
  const gridPresent = await page.evaluate(() => !!(document.getElementById('gridHost') || document.getElementById('grid')));
  const gridDims = await page.evaluate(() => {
    const g = document.getElementById('gridHost') || document.getElementById('grid');
    if (!g) return null;
    const cells = g.querySelectorAll('[data-cell], .cell, [data-r][data-reel]');
    const reels = new Set(); const rows = new Set();
    cells.forEach((c) => {
      const r = c.getAttribute('data-reel') || c.getAttribute('data-r');
      const w = c.getAttribute('data-row') || c.getAttribute('data-i');
      if (r != null) reels.add(r);
      if (w != null) rows.add(w);
    });
    return { cellCount: cells.length, reels: reels.size, rows: rows.size };
  });

  /* ── Spin loop. Wait actively for re-enable so we actually complete
   * spins rather than spamming during animation. */
  let spinsCompleted = 0;
  let spinsAttempted = 0;
  let lastClickErr = null;
  const rtpSamples = [];
  for (let i = 0; i < SPINS; i++) {
    spinsAttempted++;
    try {
      /* Poll for re-enable up to 2.5s — slot anim/tumble may take ~1.5s. */
      const enabled = await page.waitForFunction(() => {
        const b = document.getElementById('spinBtn');
        return !!b && !b.disabled && b.offsetParent !== null;
      }, { timeout: 2500 }).then(() => true).catch(() => false);
      if (!enabled) continue;
      await page.click('#spinBtn', { timeout: 1500 });
      spinsCompleted++;
    } catch (e) {
      lastClickErr = e.message.slice(0, 120);
    }
    await page.waitForTimeout(50);
    if (i > 0 && i % 10 === 0) {
      const m = await page.$eval('#lrhMeasured', (el) => el.textContent).catch(() => null);
      if (m) rtpSamples.push({ at: i, value: m });
    }
  }

  /* ── Final dump. ── */
  const hookCounts = await page.evaluate(() => window.__UQ_AL_HOOK_COUNTS__ || {});
  const mut = await page.evaluate(() => window.__UQ_AL_MUT__ || {});
  const finalRtp = await page.$eval('#lrhMeasured', (el) => el.textContent).catch(() => null);
  const finalGridDims = await page.evaluate(() => {
    const g = document.getElementById('gridHost') || document.getElementById('grid');
    if (!g) return null;
    const cells = g.querySelectorAll('[data-cell], .cell, [data-r][data-reel]');
    return cells.length;
  });

  /* Re-check NaN in body after spins (numeric values may have updated). */
  const bodyTextAfter = await page.evaluate(() => document.body.innerText || '').catch(() => '');
  const nanAfter = NAN_RE.test(bodyTextAfter);
  let nanAfterSamples = [];
  if (nanAfter) {
    nanAfterSamples = bodyTextAfter.split('\n').filter((l) => NAN_RE.test(l)).slice(0, 5);
  }

  await ctx.close();

  /* ── Verdict. ── */
  const fails = [];
  if (gotoErr) fails.push('goto: ' + gotoErr);
  if (titleVendorLeak) fails.push(`title vendor leak: "${titleVendorLeak}"`);
  if (bodyVendorMatches.length) fails.push('body vendor leaks: ' + bodyVendorMatches.join(', '));
  if (consoleErrors.length) fails.push(`console errors: ${consoleErrors.length}`);
  if (pageErrors.length) fails.push(`page errors: ${pageErrors.length}`);
  if (dialogs.length) fails.push(`dialogs: ${dialogs.length}`);
  if (nanInBody || nanAfter) fails.push('NaN/Infinity/undefined in body');
  if (!rtpHudPresent) fails.push('liveRtpHud missing');
  if (!spinBtnPresent) fails.push('spinBtn missing');
  if (!gridPresent) fails.push('grid missing');
  if (spinsCompleted < Math.floor(SPINS * 0.8)) fails.push(`only ${spinsCompleted}/${SPINS} spins completed`);
  /* finalRtp NaN check: "—" is acceptable (warming). "NaN" literal is not. */
  if (finalRtp && /NaN/.test(finalRtp)) fails.push('finalRtp = NaN');

  return {
    slug,
    url,
    verdict: fails.length === 0 ? 'PASS' : 'FAIL',
    fails,
    gotoErr,
    title,
    titleVendorLeak,
    bodyVendorMatches,
    nanInBody, nanSamples,
    nanAfter, nanAfterSamples,
    rtpHudPresent, measuredRtpEarly, finalRtp,
    rtpSamples,
    spinBtnPresent, gridPresent, gridDims, finalGridDims,
    spinsAttempted, spinsCompleted, lastClickErr,
    consoleErrors, consoleWarnings, pageErrors, dialogs, requestFailures,
    hookCounts, mut,
  };
}

const browser = await chromium.launch({ headless: true });
const results = [];
const tStart = Date.now();
for (const slug of SLUGS) {
  process.stderr.write(`\n▶ ${slug} … `);
  const t0 = Date.now();
  try {
    const r = await probeSlug(browser, slug);
    results.push(r);
    process.stderr.write(`${r.verdict} (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  } catch (e) {
    results.push({ slug, verdict: 'FAIL', fails: ['probe crashed: ' + e.message] });
    process.stderr.write(`CRASH: ${e.message}`);
  }
}
await browser.close();
const wall = ((Date.now() - tStart) / 1000).toFixed(1);

/* ── Markdown report ── */
console.log('\n\n# UQ-DEEP-AL · QA-1 · LIVE PLAYWRIGHT DEEP PROBE — Report');
console.log(`Wallclock: ${wall}s · Spins/slug: ${SPINS} · Slugs: ${SLUGS.length}`);
console.log(`Verdict: ${results.every((r) => r.verdict === 'PASS') ? 'ALL PASS' : 'FAIL'}`);
console.log('');
for (const r of results) {
  console.log(`## ${r.verdict === 'PASS' ? '✓ PASS' : '✗ FAIL'} — ${r.slug}`);
  console.log(`URL: ${r.url || '(n/a)'}`);
  console.log(`Title: ${JSON.stringify(r.title || '')}`);
  if (r.fails && r.fails.length) {
    console.log(`Fails (${r.fails.length}):`);
    r.fails.forEach((f) => console.log('  • ' + f));
  }
  console.log(`Spins completed: ${r.spinsCompleted ?? '?'}/${r.spinsAttempted ?? SPINS}` + (r.lastClickErr ? ` · lastClickErr: ${r.lastClickErr}` : ''));
  console.log(`Console errors (${(r.consoleErrors || []).length}):`);
  console.log(fmtList(r.consoleErrors || []));
  console.log(`Console warnings (${(r.consoleWarnings || []).length}):`);
  console.log(fmtList(r.consoleWarnings || [], 3));
  console.log(`Page errors (${(r.pageErrors || []).length}):`);
  console.log(fmtList(r.pageErrors || []));
  console.log(`Dialogs (${(r.dialogs || []).length}): ${(r.dialogs || []).map((d) => `${d.type}:${d.message}`.slice(0, 80)).join(' | ') || '(none)'}`);
  console.log(`Request failures (${(r.requestFailures || []).length}):`);
  console.log(fmtList(r.requestFailures || [], 5));
  console.log(`Vendor leaks — title: ${r.titleVendorLeak || '(none)'} · body: ${(r.bodyVendorMatches || []).join(', ') || '(none)'}`);
  console.log(`NaN/Infinity in body — initial: ${r.nanInBody ? 'YES' : 'no'} · after spins: ${r.nanAfter ? 'YES' : 'no'}`);
  if (r.nanSamples && r.nanSamples.length) {
    console.log('  initial NaN lines:');
    r.nanSamples.forEach((s) => console.log('    • ' + s.slice(0, 160)));
  }
  if (r.nanAfterSamples && r.nanAfterSamples.length) {
    console.log('  after-spin NaN lines:');
    r.nanAfterSamples.forEach((s) => console.log('    • ' + s.slice(0, 160)));
  }
  if (r.gridDims) {
    console.log(`Grid (initial): cells=${r.gridDims.cellCount} reels=${r.gridDims.reels} rows=${r.gridDims.rows} · expected: ${r.gridDims.reels * r.gridDims.rows}`);
  } else {
    console.log('Grid (initial): (no #grid found)');
  }
  console.log(`Grid (final cell count): ${r.finalGridDims ?? '(n/a)'}`);
  console.log(`Grid mutations: total=${r.mut?.total ?? 0} childList=${r.mut?.byType?.childList ?? 0} attr=${r.mut?.byType?.attributes ?? 0}` + (r.mut?.noGrid ? ' · NO #grid AT INSTALL' : ''));
  const hookEntries = Object.entries(r.hookCounts || {}).sort((a, b) => b[1] - a[1]);
  console.log(`HookBus events (${hookEntries.length} distinct, top 5):`);
  if (!hookEntries.length) console.log('  (none captured — tap may have installed after first events)');
  hookEntries.slice(0, 5).forEach(([k, v]) => console.log(`  • ${k}: ${v}`));
  console.log(`RTP HUD: present=${r.rtpHudPresent} · early=${JSON.stringify(r.measuredRtpEarly)} · final=${JSON.stringify(r.finalRtp)}`);
  if (r.rtpSamples && r.rtpSamples.length) {
    console.log('  RTP samples (every 10 spins): ' + r.rtpSamples.map((s) => `@${s.at}:${s.value}`).join(' '));
  }
  console.log('');
}

/* Exit non-zero if any FAIL — caller can ignore but it surfaces in CI. */
process.exit(results.every((r) => r.verdict === 'PASS') ? 0 : 1);
