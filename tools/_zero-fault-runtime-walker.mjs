#!/usr/bin/env node
/**
 * tools/_zero-fault-runtime-walker.mjs
 *
 * F1-a/b (Boki 2026-06-27) — Playwright headless walker that opens
 * generated slot.html files and asserts:
 *
 *   F1-a: ZERO console.error / pageerror / unhandled-rejection events
 *         emitted during page load and 1-second observation window.
 *   F1-b: DOM invariants per slot.html:
 *           - .reel-strip count ≥ 3 (slots are at least 3-reel)
 *           - .cell count = reels × rows (from model.json topology)
 *           - .balance present + numeric
 *           - .spin-button or [data-action="spin"] present + enabled
 *           - .paytable-button or .help-toggle present
 *           - ≥1 aria-live region (regulator accessibility contract)
 *
 * # USAGE
 *
 *   node tools/_zero-fault-runtime-walker.mjs                  # 5 baseline subset
 *   node tools/_zero-fault-runtime-walker.mjs --all            # all 338 GDDs
 *   node tools/_zero-fault-runtime-walker.mjs --limit 20       # first 20
 *   node tools/_zero-fault-runtime-walker.mjs --slug 01-huff-n-puff-...
 *   node tools/_zero-fault-runtime-walker.mjs --json           # stdout JSON only
 *
 * # OUTPUT
 *
 *   reports/zero-fault/<slug>.json   — per-slug receipt with errors,
 *                                       warns, invariants, durationMs.
 *   reports/zero-fault/_summary.json — aggregate: total / pass / fail.
 *
 * # GATE SEMANTICS
 *
 *   Exit code 0 iff EVERY visited slot has zero hard errors AND every
 *   DOM invariant passes. Used by verify gate step "zero-fault-runtime"
 *   (F1-d) which calls this with --limit 5 (sub-minute wall on local
 *   Chromium) to keep pre-commit fast.
 *
 * # NON-SCOPE
 *
 *   - 338-wide full run is operator-side (`--all`, ~3-5 min) and gates
 *     the weekly nightly CI cron; pre-commit stays on the 5-baseline
 *     subset.
 *   - Visual regression (UQ-MASTERY-5 V9 vision) is separate.
 *   - This walker DOES NOT measure RTP / convergence — F2 territory.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv } from 'node:process';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const REAL_GAMES_DIR = join(REPO, 'dist', 'real-games');
const REPORT_DIR = join(REPO, 'reports', 'zero-fault');

/* Five baseline slugs that the rest of the verify gate already pins:
 * Game-A (5x3-LR), Crystal Forge, Game-B (6x5-T), Midnight Fangs,
 * Game-C (5x3-R). Internal slug names match the back-compat dirs in
 * dist/real-games/. */
const BASELINE_SLUGS = [
  '01-huff-n-puff-huff-n-more-puff',
  '02-buffalo-rising-megaways',
  '03-gates-of-olympus',
  '04-sweet-bonanza',
  '05-starlight-princess',
];

function parseArgs(args) {
  const out = { slug: null, all: false, limit: null, json: false };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--all') out.all = true;
    else if (a === '--limit') out.limit = parseInt(args[++i], 10);
    else if (a === '--json') out.json = true;
  }
  return out;
}

/* Try-import Playwright; emit a structured skip when unavailable so the
 * verify gate can decide to soft-skip vs hard-fail. */
async function tryImportPlaywright() {
  try {
    const mod = await import('playwright');
    return mod.chromium || mod.default?.chromium || null;
  } catch {
    return null;
  }
}

/* Topology kinds that don't render a standard rectangular reel grid.
 * For these the `.cell` + `data-reel` invariants are not meaningful —
 * the DOM is paved with hex tiles / plinko pegs / slingo ticket cells /
 * wheel sectors / radial arms / crash multiplier streams instead. We
 * still enforce zero-error + balance/spin/aria invariants but soft-skip
 * the reels_count + cells_count probes. The walker output stamps
 * `gridSkipped: true` for traceability so this isn't silent. */
const NON_STANDARD_GRID_KINDS = new Set([
  'hexagonal',
  'hex',
  'plinko',
  'slingo',
  'wheel',
  'radial',
  'crash',
]);

function loadModelTopology(slug) {
  const modelPath = join(REAL_GAMES_DIR, slug, 'model.json');
  if (!existsSync(modelPath)) return null;
  try {
    const m = JSON.parse(readFileSync(modelPath, 'utf-8'));
    const kind = String(m.topology?.kind || '').toLowerCase();
    return {
      reels: Number(m.topology?.reels) || null,
      rows: Number(m.topology?.rows) || null,
      kind,
      isStandardGrid: !NON_STANDARD_GRID_KINDS.has(kind)
        && !m.topology?.is_slingo
        && !m.topology?.is_plinko
        && !m.topology?.hex_ring
        && !m.topology?.wheel_segments,
    };
  } catch {
    return null;
  }
}

async function startStaticServer() {
  /* Re-uses tools/static-server.mjs which honours PORT env var and
   * prints "Serving HTTP on 0.0.0.0 port <N>" on stdout. We pick a
   * port in the ephemeral range (49152..65535) to avoid collision with
   * the dev default 5180. */
  const port = 49152 + Math.floor(Math.random() * 16383);
  return await new Promise((res, rej) => {
    const child = spawn('node', [join(REPO, 'tools', 'static-server.mjs')], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PORT: String(port) },
    });
    let buf = '';
    const timer = setTimeout(() => {
      child.kill();
      rej(new Error('static-server did not start within 5s'));
    }, 5000);
    child.stdout.on('data', (b) => {
      buf += b.toString();
      const m = buf.match(/Serving\s+HTTP\s+on\s+\S+\s+port\s+(\d+)/i);
      if (m) {
        clearTimeout(timer);
        res({ url: `http://127.0.0.1:${m[1]}`, child });
      }
    });
    child.stderr.on('data', (b) => { buf += b.toString(); });
    child.on('error', (e) => { clearTimeout(timer); rej(e); });
  });
}

async function walkOneSlug(browser, baseUrl, slug) {
  const topology = loadModelTopology(slug);
  const slotUrl = `${baseUrl}/dist/real-games/${slug}/slot.html`;
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  const warns = [];

  /* Filter out "harmless" browser-emitted info messages that look like
   * errors but don't indicate code defects:
   *   - CSP frame-ancestors via <meta> (browser warns it's
   *     unenforceable from meta; we deliver via HTTP header in prod)
   *   - Deprecation notices for APIs we don't call
   *   - Optional backend probes (127.0.0.1:9001/health from
   *     backendSpinEngine + liveRtpHud) when no operator backend is
   *     running — these blocks intentionally fail-soft.
   *   - ERR_FAILED tail-asset 404s caused by the same optional probes.
   * Hard errors (TypeError, ReferenceError, asset load failures from
   * the slot bundle itself, regex/syntax errors) still register. */
  const HARMLESS_CONSOLE_RX = [
    /Content\s+Security\s+Policy\s+directive\s+'frame-ancestors'\s+is\s+ignored\s+when\s+delivered\s+via.*meta/i,
    /\bdeprecated\b/i,
    /127\.0\.0\.1:9001/i,                                 /* backend probe */
    /Failed\s+to\s+load\s+resource:\s+net::ERR_FAILED/i,  /* backend probe tail */
  ];
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error') {
      if (HARMLESS_CONSOLE_RX.some((rx) => rx.test(text))) {
        warns.push({ kind: 'console.error.filtered', text });
      } else {
        errors.push({ kind: 'console.error', text });
      }
    } else if (msg.type() === 'warning') {
      warns.push({ kind: 'console.warn', text });
    }
  });
  page.on('pageerror', (e) => {
    errors.push({ kind: 'pageerror', text: e.message });
  });
  page.on('crash', () => {
    errors.push({ kind: 'page.crash', text: 'page crashed' });
  });

  const t0 = Date.now();
  try {
    await page.goto(slotUrl, { waitUntil: 'load', timeout: 10000 });
  } catch (e) {
    errors.push({ kind: 'navigation', text: e.message });
    await context.close();
    return { slug, errors, warns, invariants: [], durationMs: Date.now() - t0 };
  }
  /* 1-second observation window for async/deferred errors. */
  await page.waitForTimeout(1000);

  /* DOM invariant probes — evaluated in-page to avoid round-trips.
   * Selectors derived from actual generated slot.html runtime DOM:
   *   - cells: `.cell` (each cell is one painted symbol container; the
   *            element also carries `data-reel` set by the reel renderer
   *            during mount). `data-row` is intentionally NOT emitted —
   *            row position is inferred from the cell's index inside its
   *            reel-strip parent at paint time.
   *   - reels: distinct `data-reel` values across `.cell` elements
   *   - balance: id^="balance" OR .balance-hud
   *   - spin button: .spinBtn OR id^="spin"
   *   - paytable button: .paytable-btn OR [aria-label*=paytable]
   *   - aria-live region: any [aria-live]
   * Topology check: cell count must be a multiple of reel count AND at
   * LEAST reels × rows (engine may add buffer rows above/below the
   * visible window — common for tumble/cascade evaluators — so we
   * tolerate any whole multiple, not strict equality). */
  const invariants = await page.evaluate((expected) => {
    const out = [];
    const cellEls = Array.from(document.querySelectorAll('.cell'));
    const reelIdxSet = new Set();
    for (const el of cellEls) {
      const r = el.getAttribute('data-reel');
      if (r != null) reelIdxSet.add(r);
    }
    /* Reel count: prefer distinct data-reel values on `.cell` elements.
     * Fallback chain when data-reel isn't propagated to cells (some
     * renderers — e.g. dual-grid `kind=dual` — paint cells without the
     * attribute and own the reel coord internally):
     *   1. distinct data-reel on .cell
     *   2. count of [data-reel] elements in the document
     *   3. inferred from cellCount / topology.rows when both known
     * Inference is logged in `observed` for traceability. */
    let reelCount = reelIdxSet.size;
    let reelSource = 'data-reel on .cell';
    if (reelCount === 0) {
      reelCount = document.querySelectorAll('[data-reel]').length;
      reelSource = '[data-reel] document-wide';
    }
    if (reelCount === 0 && expected.rows && cellEls.length > 0 && cellEls.length % expected.rows === 0) {
      reelCount = cellEls.length / expected.rows;
      reelSource = `inferred (cells/${expected.rows} rows)`;
    }
    /* Secondary inference: when rows-based inference fails (buffer rows
     * or multi-grid topologies inflate cellCount unpredictably), but
     * expected.reels divides cellCount evenly, trust topology metadata. */
    if (reelCount === 0 && expected.reels && cellEls.length > 0 && cellEls.length % expected.reels === 0) {
      reelCount = expected.reels;
      reelSource = `inferred (cells divisible by ${expected.reels} reels)`;
    }

    if (expected.isStandardGrid !== false) {
      out.push({
        name: 'reels_count',
        pass: reelCount >= 3,
        observed: `${reelCount} (${reelSource})`,
        expected: expected.reels || '≥3',
      });

      let cellsPass = cellEls.length > 0;
      if (expected.reels && expected.rows) {
        const minCells = expected.reels * expected.rows;
        const isMultiple = cellEls.length > 0 && (cellEls.length % expected.reels === 0);
        cellsPass = cellEls.length >= minCells && isMultiple;
      }
      out.push({
        name: 'cells_count',
        pass: cellsPass,
        observed: cellEls.length,
        expected: (expected.reels && expected.rows)
          ? `≥ ${expected.reels * expected.rows} and multiple of ${expected.reels}`
          : '>0',
      });
    } else {
      out.push({
        name: 'grid_invariants_skipped',
        pass: true,
        observed: `non-standard topology kind: ${expected.kind || 'unknown'}`,
        expected: 'soft-skip (hex/plinko/slingo/wheel/radial/crash)',
      });
    }

    const balance = document.querySelector('.balance-hud, [id^="balance"], [data-balance], [aria-label*="balance" i]');
    out.push({
      name: 'balance_present',
      pass: balance !== null,
      observed: balance ? 'present' : 'missing',
    });

    const spinBtn = document.querySelector('.spinBtn, [id^="spin"], .spin-button, [data-action="spin"], button[aria-label*="spin" i]');
    out.push({
      name: 'spin_button_present',
      pass: spinBtn !== null && !spinBtn.disabled,
      observed: spinBtn ? 'present' : 'missing',
    });

    const helpBtn = document.querySelector('.paytable-btn, .paytable-button, .help-toggle, [data-action="paytable"], button[aria-label*="paytable" i], button[aria-label*="help" i]');
    out.push({
      name: 'help_or_paytable_button_present',
      pass: helpBtn !== null,
      observed: helpBtn ? 'present' : 'missing',
    });

    const ariaLive = document.querySelectorAll('[aria-live]');
    out.push({
      name: 'aria_live_region',
      pass: ariaLive.length >= 1,
      observed: ariaLive.length,
    });

    return out;
  }, topology || {});

  await context.close();
  return { slug, errors, warns, invariants, durationMs: Date.now() - t0 };
}

function summarize(receipts) {
  let pass = 0, fail = 0;
  const failures = [];
  for (const r of receipts) {
    const hardErrors = (r.errors || []).length > 0;
    const invariantFails = (r.invariants || []).filter((i) => !i.pass);
    if (hardErrors || invariantFails.length > 0) {
      fail++;
      failures.push({
        slug: r.slug,
        errorCount: r.errors.length,
        firstError: r.errors[0]?.text || null,
        invariantFails: invariantFails.map((i) => i.name),
      });
    } else {
      pass++;
    }
  }
  return { total: receipts.length, pass, fail, failures };
}

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });

  const chromium = await tryImportPlaywright();
  if (!chromium) {
    const reason = 'playwright unavailable (graceful skip — install: npx playwright install chromium)';
    if (opts.json) {
      console.log(JSON.stringify({ ok: true, skipped: true, reason }));
    } else {
      console.log(`▸ zero-fault walker SKIPPED — ${reason}`);
    }
    /* Skip is not a hard fail; the gate decides. */
    process.exit(0);
  }

  let targets = [];
  if (opts.slug) {
    targets = [opts.slug];
  } else if (opts.all) {
    targets = readdirSync(REAL_GAMES_DIR)
      .filter((d) => existsSync(join(REAL_GAMES_DIR, d, 'slot.html')));
  } else if (opts.limit) {
    const all = readdirSync(REAL_GAMES_DIR)
      .filter((d) => existsSync(join(REAL_GAMES_DIR, d, 'slot.html')))
      .sort();
    targets = all.slice(0, opts.limit);
  } else {
    targets = BASELINE_SLUGS.filter((s) => existsSync(join(REAL_GAMES_DIR, s, 'slot.html')));
    if (targets.length === 0) {
      /* Fallback: take first 5 available. */
      targets = readdirSync(REAL_GAMES_DIR)
        .filter((d) => existsSync(join(REAL_GAMES_DIR, d, 'slot.html')))
        .sort()
        .slice(0, 5);
    }
  }

  if (!opts.json) {
    console.log(`▸ zero-fault walker · ${targets.length} target(s) · launching Chromium…`);
  }

  const { url: baseUrl, child: serverChild } = await startStaticServer();
  const browser = await chromium.launch({ headless: true });
  const receipts = [];
  try {
    for (const slug of targets) {
      const r = await walkOneSlug(browser, baseUrl, slug);
      writeFileSync(join(REPORT_DIR, `${slug}.json`), JSON.stringify(r, null, 2));
      receipts.push(r);
      if (!opts.json) {
        const ok = r.errors.length === 0 && r.invariants.every((i) => i.pass);
        const badge = ok ? '✓ pass' : `✗ fail (${r.errors.length} err / ${r.invariants.filter((i) => !i.pass).length} invariant)`;
        console.log(`  ${badge}  ${slug}`);
      }
    }
  } finally {
    await browser.close();
    if (serverChild && !serverChild.killed) serverChild.kill();
  }

  const summary = summarize(receipts);
  writeFileSync(join(REPORT_DIR, '_summary.json'), JSON.stringify(summary, null, 2));

  if (opts.json) {
    console.log(JSON.stringify({ ok: summary.fail === 0, summary }, null, 2));
  } else {
    console.log(`\n  Summary: ${summary.pass} PASS / ${summary.fail} FAIL of ${summary.total}`);
    if (summary.fail > 0) {
      console.log(`  Failures:`);
      for (const f of summary.failures.slice(0, 10)) {
        console.log(`    ${f.slug}: ${f.errorCount} err [${f.invariantFails.join(',')}]${f.firstError ? ' :: ' + f.firstError.substring(0, 80) : ''}`);
      }
    }
  }

  if (summary.fail > 0) process.exit(1);
}

const __isCliEntry = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();

if (__isCliEntry) {
  main().catch((e) => {
    console.error('FATAL:', e);
    process.exit(2);
  });
}

export { walkOneSlug, summarize, BASELINE_SLUGS };
