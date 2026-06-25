#!/usr/bin/env node
/**
 * tools/v9-vision-orchestrator.mjs
 *
 * N+2 atom J (Boki 2026-06-25) — Live activation of the V9 Vision
 * mode for WARN/FAIL receipts, gated by `visionCostGuard`.
 *
 * # FLOW
 *
 *   for each slug:
 *     receipt ← verifyHtml(slug, model, html)                ← deterministic
 *     if receipt.verdict ∈ {WARN, FAIL} and --vision flag:
 *         decision ← guard.shouldCallVision()
 *         if decision.ok:
 *             screenshots ← captureScreenshots(slug)         ← Playwright
 *             visionReceipt ← visionMode(slug, model, …)     ← Opus 4.8
 *             guard.recordCall({ usd: visionReceipt.estUsd })
 *             receipt.vision ← visionReceipt
 *         else:
 *             receipt.vision ← { verdict: 'SKIP', reason: decision.reason }
 *     persist receipt
 *
 *   Vision NEVER fires for PASS — the deterministic check is enough.
 *
 * # USAGE
 *
 *   node tools/v9-vision-orchestrator.mjs            walk all slugs (vision OFF)
 *   node tools/v9-vision-orchestrator.mjs --vision   enable vision for WARN/FAIL
 *   node tools/v9-vision-orchestrator.mjs --slug=X   single slug
 *   node tools/v9-vision-orchestrator.mjs --limit N  first N slugs
 *   node tools/v9-vision-orchestrator.mjs --dry-run  plan only, no LLM call
 *   node tools/v9-vision-orchestrator.mjs --mock-wrapper=PATH
 *                                                    inject mock wrapper for tests
 *
 * # ENV
 *
 *   V9_MAX_VISION_CALLS   default 20    — hard ceiling on calls
 *   V9_MAX_VISION_USD     default 2.50  — soft $$ ceiling
 *   V9_EST_USD_PER_CALL   default 0.05  — accountant's per-call estimate
 *
 * # WHY A SEPARATE ORCHESTRATOR (not inside v9-visual-qa.mjs)
 *
 * `tools/v9-visual-qa.mjs` is the deterministic library + walker.
 * Wiring vision + cost guard + Playwright snapshot capture into its
 * main path would bloat the gate-suitable code with concerns it never
 * needs at pre-commit time. Keeping them separate means:
 *   - `verify:quick` (which calls v9-visual-qa as a library) never
 *     accidentally triggers a $$ call.
 *   - The vision orchestrator can evolve (Playwright variants,
 *     screenshot strategies, alt LLM wrappers) without touching the
 *     gate path.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

import { verifyHtml } from './v9-visual-qa.mjs';
import { createGuard } from '../src/registry/visionCostGuard.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;

/* ── tiny argv parser ──────────────────────────────────────────────── */

function parseArgv(argv) {
  const out = { _: [], flags: new Set() };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--vision' || a === '--dry-run') {
      out.flags.add(a.slice(2));
    } else if (a.startsWith('--slug=')) {
      out.slug = a.slice('--slug='.length);
    } else if (a === '--slug') {
      out.slug = argv[++i];
    } else if (a.startsWith('--limit=')) {
      out.limit = parseInt(a.slice('--limit='.length), 10);
    } else if (a === '--limit') {
      out.limit = parseInt(argv[++i], 10);
    } else if (a.startsWith('--mock-wrapper=')) {
      out.mockWrapper = a.slice('--mock-wrapper='.length);
    } else if (a === '--mock-wrapper') {
      out.mockWrapper = argv[++i];
    } else if (a === '--help' || a === '-h') {
      out.help = true;
    } else {
      out._.push(a);
    }
  }
  return out;
}

/* ── slug discovery (shared shape with v9-visual-qa) ───────────────── */

function listSlugs(slug, limit) {
  if (slug) {
    if (!existsSync(join(REAL_GAMES, slug, 'slot.html'))) return [];
    return [slug];
  }
  if (!existsSync(REAL_GAMES)) return [];
  const entries = readdirSync(REAL_GAMES, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((s) => existsSync(join(REAL_GAMES, s, 'slot.html'))
                && existsSync(join(REAL_GAMES, s, 'model.json')))
    .sort();
  return limit ? entries.slice(0, limit) : entries;
}

/* ── screenshot capture (Playwright headless) ──────────────────────── */

/**
 * Capture up to 4 screenshots per slug: boot/idle, base-spin, win,
 * feature-trigger. Returns absolute paths to the PNGs. The function
 * intentionally swallows Playwright launch failures (browser binary
 * missing, headless DRM) and returns `[]` — vision call then SKIPs
 * with "no screenshots available" which is a sane fail-closed default.
 *
 * @param {string} slug
 * @param {string} runDir
 * @returns {Promise<string[]>}
 */
async function captureScreenshots(slug, runDir) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch (_) {
    return [];
  }

  const htmlPath = join(REAL_GAMES, slug, 'slot.html');
  if (!existsSync(htmlPath)) return [];
  const url = pathToFileURL(htmlPath).href;

  let browser;
  try {
    browser = await chromium.launch({ headless: true });
  } catch (_) {
    return [];
  }

  const paths = [];
  try {
    const ctx  = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 8000 });
    /* Give animations a beat to settle before snapshot. */
    await page.waitForTimeout(400);

    const states = ['boot', 'after-wait', 'after-spin', 'after-win'];
    for (let i = 0; i < states.length; i++) {
      const p = join(runDir, `${slug}-${String(i).padStart(2, '0')}-${states[i]}.png`);
      try {
        await page.screenshot({ path: p, fullPage: false });
        paths.push(p);
      } catch (_) {
        /* skip this state; keep going */
      }
      if (i === 0) {
        /* Trigger a synthetic spin button if exposed. */
        try {
          await page.evaluate(() => {
            const b = document.querySelector('button[data-role=spin], #spinBtn, .spin-btn');
            if (b) b.click();
          });
        } catch (_) { /* ignore */ }
        await page.waitForTimeout(600);
      }
      if (i === 1) {
        /* Synthetic force-win if dev hook is wired. */
        try {
          await page.evaluate(() => {
            if (typeof window.__forceWin === 'function') window.__forceWin();
          });
        } catch (_) { /* ignore */ }
        await page.waitForTimeout(600);
      }
    }
  } finally {
    try { await browser.close(); } catch (_) { /* ignore */ }
  }
  return paths;
}

/* ── vision call (LLM wrapper, mockable for tests) ─────────────────── */

/**
 * Run the Opus 4.8 vision call. The wrapper path is injectable so
 * tests can pass a fixture script that emits canned JSON. Returns a
 * receipt the orchestrator can attach to the deterministic receipt.
 *
 * @param {object} model
 * @param {string[]} screenshotPaths
 * @param {{wrapperPath?: string}} opts
 * @returns {{verdict: string, score?: number, observed?: string, estUsd?: number}}
 */
function visionCall(model, screenshotPaths, opts = {}) {
  const wrapper = opts.wrapperPath
    || `${process.env.HOME}/Projects/cortex/scripts/cortex-fable-ask`;
  if (!existsSync(wrapper)) {
    return { verdict: 'SKIP', observed: 'wrapper missing', estUsd: 0 };
  }
  if (!Array.isArray(screenshotPaths) || screenshotPaths.length === 0) {
    return { verdict: 'SKIP', observed: 'no screenshots', estUsd: 0 };
  }
  const prompt = [
    'V9_VISUAL_QA call: compare rendered slot screenshots vs GDD model.',
    `title: ${model.name || 'unknown'}`,
    `topology: ${model.topology?.kind} (${model.topology?.reels}×${model.topology?.rows} ${model.topology?.evaluation})`,
    `features: ${(model.features || []).map((f) => f.kind || f).join(', ')}`,
    '',
    'Output STRICT JSON only: { "verdict":"PASS|WARN|FAIL", "score":0..10, "checks":[...] }',
    'Industry-neutral language only (no vendor names).',
  ].join('\n');
  const argv = ['--mode', 'opus-4.8', '--max-tokens', '600'];
  for (const p of screenshotPaths) argv.push('--image', p);
  const r = spawnSync(wrapper, argv, {
    input: prompt,
    encoding: 'utf-8',
    timeout: 60000,
  });
  if (r.status !== 0) {
    return {
      verdict: 'SKIP',
      observed: `wrapper exit ${r.status}: ${(r.stderr || '').slice(-160)}`,
      estUsd: 0,
    };
  }
  let parsed = null;
  try {
    const txt = (r.stdout || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(txt);
  } catch (e) {
    return {
      verdict: 'WARN',
      observed: `non-JSON reply: ${(r.stdout || '').slice(0, 160)}`,
      estUsd: 0.05,
    };
  }
  return {
    verdict: parsed.verdict || 'WARN',
    score: parsed.score,
    checks: parsed.checks || [],
    observed: `Opus 4.8 verdict ${parsed.verdict} (score ${parsed.score})`,
    /* Real cost would come from token counts; we use the env-default
       estimate so the guard accumulator stays meaningful even when the
       wrapper doesn't surface a $$ line. */
    estUsd: typeof parsed.estUsd === 'number' ? parsed.estUsd : 0.05,
  };
}

/* ── high-level run (testable as library) ──────────────────────────── */

/**
 * Process one slug. Pure function over (slug, model, html, opts) — no
 * disk writes (the caller persists the receipt). The orchestrator
 * exports this so unit tests can drive it with mocks.
 *
 * @param {object} args
 * @param {string} args.slug
 * @param {object} args.model
 * @param {string} args.html
 * @param {boolean} args.vision        true to attempt the vision call
 * @param {boolean} args.dryRun        plan only; never invoke wrapper
 * @param {ReturnType<typeof createGuard>} args.guard
 * @param {(slug: string) => Promise<string[]>} args.capture
 * @param {(model: object, paths: string[]) => Awaitable<object>} [args.visionFn]
 * @returns {Promise<object>}
 */
export async function processSlug({
  slug, model, html, vision, dryRun, guard, capture, visionFn,
}) {
  const receipt = verifyHtml(slug, model, html);

  if (!vision) return receipt;
  if (receipt.verdict === 'PASS') return receipt; /* never burn $$ on PASS */

  const decision = guard.shouldCallVision();
  if (!decision.ok) {
    receipt.vision = { verdict: 'SKIP', reason: decision.reason };
    return receipt;
  }

  if (dryRun) {
    receipt.vision = { verdict: 'SKIP', reason: 'dry-run' };
    return receipt;
  }

  const paths = await capture(slug);
  const visionReceipt = await visionFn(model, paths);
  guard.recordCall({ usd: visionReceipt.estUsd });
  receipt.vision = visionReceipt;
  return receipt;
}

/* ── CLI entry point ──────────────────────────────────────────────── */

async function main() {
  const args = parseArgv(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`v9-vision-orchestrator.mjs — N+2-J · vision-mode activation with $$ guard

USAGE
  node tools/v9-vision-orchestrator.mjs [--vision] [--slug=X] [--limit N] [--dry-run]
ENV
  V9_MAX_VISION_CALLS  default 20
  V9_MAX_VISION_USD    default 2.50
  V9_EST_USD_PER_CALL  default 0.05
`);
    process.exit(0);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const slugs = listSlugs(args.slug, args.limit);
  if (slugs.length === 0) {
    process.stderr.write('▸ no slot.html + model.json pairs found\n');
    process.exit(2);
  }

  const guard   = createGuard();
  const vision  = args.flags.has('vision');
  const dryRun  = args.flags.has('dry-run');
  const runDir  = join(tmpdir(), `v9-vision-${process.pid}-${Date.now()}`);
  if (vision && !dryRun) mkdirSync(runDir, { recursive: true });

  process.stdout.write(
    `V9 Vision orchestrator · ${slugs.length} slug(s) · vision=${vision} dry-run=${dryRun}\n`,
  );

  const receipts = [];
  let pass = 0, warn = 0, fail = 0, skip = 0, visionFired = 0;

  for (const slug of slugs) {
    let model, html;
    try {
      model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
      html  = readFileSync(join(REAL_GAMES, slug, 'slot.html'), 'utf8');
    } catch (e) {
      receipts.push({ slug, verdict: 'FAIL', error: `read: ${e.message}` });
      fail++;
      continue;
    }
    const receipt = await processSlug({
      slug, model, html, vision, dryRun, guard,
      capture: (s) => captureScreenshots(s, runDir),
      visionFn: (m, paths) => visionCall(m, paths, { wrapperPath: args.mockWrapper }),
    });
    receipts.push(receipt);
    if (receipt.verdict === 'PASS') pass++;
    else if (receipt.verdict === 'WARN') warn++;
    else if (receipt.verdict === 'FAIL') fail++;
    if (receipt.vision) {
      if (receipt.vision.verdict === 'SKIP') skip++;
      else visionFired++;
    }
  }

  if (vision && !dryRun) {
    try { rmSync(runDir, { recursive: true, force: true }); } catch (_) { /* ignore */ }
  }

  const ts = new Date().toISOString();
  const summary = {
    generatedAt: ts,
    tool: 'tools/v9-vision-orchestrator.mjs',
    slugsProcessed: receipts.length,
    pass, warn, fail,
    visionFired,
    visionSkipped: skip,
    costAccumulator: guard.report(),
  };
  const reportFile = join(OUT_DIR, `v9-vision-${ts.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportFile, JSON.stringify({ summary, receipts }, null, 2));

  process.stdout.write('\n');
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.stdout.write(`V9 Vision orchestrator · ${receipts.length} slug(s)\n`);
  process.stdout.write(`  PASS: ${pass}   WARN: ${warn}   FAIL: ${fail}\n`);
  process.stdout.write(`  vision fired: ${visionFired}   skipped (guard / dry-run): ${skip}\n`);
  const r = guard.report();
  process.stdout.write(
    `  cost: ${r.calls}/${r.maxCalls} calls · $${r.usd.toFixed(2)}/${r.maxUsd.toFixed(2)}\n`,
  );
  process.stdout.write(`  report: ${reportFile}\n`);
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  process.exit(fail > 0 ? 1 : 0);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    process.stderr.write(`fatal: ${err && err.stack || err}\n`);
    process.exit(1);
  });
}
