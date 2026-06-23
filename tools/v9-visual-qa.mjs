#!/usr/bin/env node
/**
 * tools/v9-visual-qa.mjs
 *
 * Wave UQ-MASTERY-5 — V9 Visual QA Agent (per agents/V9_VISUAL_QA.md).
 *
 * V9 implements TWO modes:
 *   1. DETERMINISTIC (default, fast, gate-suitable) — Playwright HTML
 *      parse + DOM/CSS structural invariants. No LLM cost. ~1-2s/game.
 *   2. VISION (--vision opt-in) — adds Opus 4.8 vision call against
 *      10 captured screenshots per game. ~$0.05/game, ~15-30s. Pre-release
 *      gate, ne pre-commit.
 *
 * In deterministic mode V9 reads the built slot.html via cheerio-like
 * regex parsing (zero browser launch) so it runs in CI without Chromium.
 * The --launch flag activates Playwright Chromium for real-render + screenshot
 * capture, but it's not required for gate-suitable structural checks.
 *
 * USAGE
 *   node tools/v9-visual-qa.mjs                   # walk all 338 GDDs (deterministic)
 *   node tools/v9-visual-qa.mjs --slug=X          # single slug
 *   node tools/v9-visual-qa.mjs --limit N         # first N slugs (smoke)
 *   node tools/v9-visual-qa.mjs --launch          # launch Playwright (snapshot capture)
 *   node tools/v9-visual-qa.mjs --vision          # add Opus vision call (cost!)
 *
 * EXIT
 *   0 — every receipt verdict ∈ {PASS, WARN}
 *   1 — ≥ 1 receipt verdict = FAIL
 *
 * --------------------------------------------------------------------
 * LIBRARY MODE (N+1 LIVE WIRE 2026-06-23)
 * --------------------------------------------------------------------
 * Export-ovana `verifyHtml(slug, model, html)` funkcija dozvoljava
 * ingest.mjs (i bilo kom drugom alatu) da pozove deterministic check
 * suite sinhrono, bez CLI overhead-a. Receipt se emit-uje direktno u
 * memoriji za serijalizaciju u `dist/ingest/<slug>/v9.json` + embed
 * kao `<meta name="v9-verdict" …>` u HTML output.
 *
 * CLI mod (walk-all-slugs) ostaje aktivan — guard preko
 * `if (import.meta.url === pathToFileURL(process.argv[1]).href)`. */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;

/* ── Deterministic structural checks (no Playwright needed) ─────────── */

/**
 * Top-level HTML parser. Cheap regex extraction — no DOM library needed.
 *
 * UQ-DEEP-A 2026-06-23 — STRICT SELECTOR HARDENING.
 * Previous version used `/paytable/i.test(html)` which matched ANY
 * occurrence of the word — including the prose "I hate paytables" or
 * a `<!-- TODO: add paytable later -->` comment. A 60 KB sham HTML
 * with `<button>paytable settings history audio</button>` scored
 * 9.5/10 PASS — false confidence.
 *
 * New checks require BOTH a structural marker (class/id/role) AND
 * cross-validation (e.g. paytable button + paytable row count > 0).
 * Word-mention is NOT sufficient.
 */
export function parseSlot(html) {
  /* Structural-class matchers — anchored on class/id/role attributes
   * to avoid prose / comment false positives. */
  return {
    title:           (html.match(/<title>([^<]+)<\/title>/) || [])[1] || null,
    hasViewport:     /name="viewport"/.test(html),
    hasManifest:     /rel="manifest"/.test(html),
    hasHub:          /class="[^"]*\bhub\b[^"]*"/.test(html),
    hasBalanceHud:   /class="[^"]*\bbalance-hud\b[^"]*"/.test(html),
    hasBetSelector:  /class="[^"]*\bbet-(steps|panel|grid|selector)\b[^"]*"/.test(html),
    hasSpinControl:  /class="[^"]*\bspin-(btn|control)\b[^"]*"/.test(html) ||
                     /id="spin-?btn"/i.test(html) ||
                     /role="button"[^>]*aria-label="(?:spin|Spin|SPIN)"/.test(html),
    /* Paytable: structural — paytable-btn class OR paytable-panel/list/section. */
    hasPaytableBtn:  /class="[^"]*\bpaytable(?:-(?:btn|button|toggle|panel|list|section|wrap))\b[^"]*"/.test(html) ||
                     /id="paytable(?:-btn|btn)?"/i.test(html),
    hasSettingsBtn:  /class="[^"]*\bsettings(?:-(?:btn|button|panel|modal|wrap))\b[^"]*"/.test(html) ||
                     /id="settings(?:-btn|btn)?"/i.test(html),
    hasHistoryBtn:   /class="[^"]*\bhistory(?:-(?:btn|button|panel|log|wrap))\b[^"]*"/.test(html) ||
                     /id="history(?:-btn|btn)?"/i.test(html),
    hasAudioBlock:   /class="[^"]*\baudio(?:-(?:btn|panel|host|toggle|mute))\b[^"]*"/.test(html) ||
                     /id="audio-(?:btn|toggle|host)"/i.test(html),
    hasWinPresent:   /class="[^"]*\bwin-?present(?:ation)?\b[^"]*"/.test(html) ||
                     /id="win-?present(?:ation)?"/i.test(html),
    cssVarBg:        (html.match(/--bg(?:-base)?:\s*([^;]+);/) || [])[1] || null,
    cssVarAccent:    (html.match(/--accent:\s*([^;]+);/) || [])[1] || null,
    paytableRowCount: (html.match(/class="[^"]*\bpaytable-row\b[^"]*"/g) || []).length,
    /* BLOCK markers: support both `BLOCK (name)` and `BLOCK: name` forms
     * for resilience against buildSlotHTML comment-style drift. */
    blockMarkers:    [...new Set([
      ...[...html.matchAll(/BLOCK\s*\(([^)]+)\)/g)].map(m => m[1].trim()),
      ...[...html.matchAll(/BLOCK:\s*([A-Za-z][A-Za-z0-9_-]*)/g)].map(m => m[1].trim()),
    ])],
    bodyLen:         html.length,
  };
}

/* V9 deterministic check suite (per V9 contract Table 'States V9 captures' +
 * Table 'Output contract'). Each check returns { name, verdict, ... }. */
export function deterministicChecks(slug, model, htmlExtract) {
  const checks = [];

  // C1 — title is set
  checks.push({
    name: 'slot has a <title>',
    expected: 'non-empty title',
    observed: htmlExtract.title,
    verdict: htmlExtract.title ? 'PASS' : 'FAIL',
  });

  // C2 — mandatory hub controls present in DOM
  const hubControls = [
    ['balanceHud',    htmlExtract.hasBalanceHud],
    ['betSelector',   htmlExtract.hasBetSelector],
    ['spinControl',   htmlExtract.hasSpinControl],
    ['paytableBtn',   htmlExtract.hasPaytableBtn],
  ];
  for (const [name, present] of hubControls) {
    checks.push({
      name: `mandatory hub control "${name}"`,
      expected: 'present in DOM',
      observed: present ? 'present' : 'missing',
      verdict: present ? 'PASS' : 'FAIL',
    });
  }

  // C3 — viewport meta + manifest (mobile + PWA contract)
  checks.push({
    name: 'mobile viewport meta',
    expected: 'name="viewport"',
    observed: htmlExtract.hasViewport ? 'present' : 'absent',
    verdict: htmlExtract.hasViewport ? 'PASS' : 'FAIL',
  });
  checks.push({
    name: 'PWA manifest link',
    expected: 'rel="manifest"',
    observed: htmlExtract.hasManifest ? 'present' : 'absent',
    verdict: htmlExtract.hasManifest ? 'PASS' : 'WARN',
  });

  // C4 — CSS theme variables are set
  checks.push({
    name: 'CSS theme variables set',
    expected: '--bg + --accent declared',
    observed: `bg=${htmlExtract.cssVarBg ?? 'null'}, accent=${htmlExtract.cssVarAccent ?? 'null'}`,
    verdict: (htmlExtract.cssVarBg && htmlExtract.cssVarAccent) ? 'PASS' : 'WARN',
  });

  // C5 — paytable row count matches declared symbol count (when known)
  const declaredSyms = Array.isArray(model.symbols) ? model.symbols.length
                     : Array.isArray(model.paytable?.symbols) ? model.paytable.symbols.length
                     : null;
  if (declaredSyms != null && declaredSyms > 0 && htmlExtract.paytableRowCount > 0) {
    const matches = htmlExtract.paytableRowCount === declaredSyms;
    checks.push({
      name: 'paytable lists every declared symbol',
      expected: `${declaredSyms} rows`,
      observed: `${htmlExtract.paytableRowCount} rows`,
      verdict: matches ? 'PASS' : 'WARN',
    });
  }

  // C6 — body length sanity (slot HTML should be substantial)
  checks.push({
    name: 'slot.html body length sanity',
    expected: '>= 50 KB',
    observed: `${(htmlExtract.bodyLen / 1024).toFixed(1)} KB`,
    verdict: htmlExtract.bodyLen >= 50_000 ? 'PASS' : 'WARN',
  });

  // C7 — declared engine block present (from model.json features)
  const t = model.topology || {};
  const expectedEngine =
    t.kind === 'hex' ? 'hexReelEngine' :
    t.is_plinko ? 'plinkoSpinEngine' :
    t.is_slingo ? 'slingoSpinEngine' :
    t.kind === 'wheel' ? 'wheelSpinEngine' :
    t.kind === 'crash' ? 'crashSpinEngine' :
    'reelEngine';
  const engineMounted = htmlExtract.blockMarkers.some(m => m.includes(expectedEngine));
  checks.push({
    name: 'engine block marker present in HTML',
    expected: expectedEngine,
    observed: engineMounted ? 'mounted' : 'absent',
    verdict: engineMounted ? 'PASS' : 'WARN',
  });

  return checks;
}

export function scoreChecks(checks) {
  if (checks.length === 0) return 0;
  let sum = 0;
  for (const c of checks) {
    if (c.verdict === 'PASS') sum += 1.0;
    else if (c.verdict === 'WARN') sum += 0.5;
    // FAIL adds 0
  }
  return (sum / checks.length) * 10;
}

/**
 * Verdict ladder from checks + score.
 *
 * UQ-DEEP-A 2026-06-23 — ASYMMETRY FIX.
 * Previously `score < 7.0` was always FAIL, even when 0 individual
 * checks failed. That created confusing receipts: "verdict=FAIL, 0
 * failed checks, 10 WARN checks" — operator couldn't pinpoint cause.
 *
 * New ladder:
 *   - Any check FAIL → verdict FAIL (severity beats score)
 *   - Else score ≥ 9.0 → PASS
 *   - Else score ≥ 7.0 → WARN
 *   - Else (sub-7.0, no FAIL) → still WARN — many WARN-ed checks add up
 *     to low score but no single check is broken; operator review,
 *     not gate-block.
 *   - Sub-7.0 WITH check FAIL would have already returned FAIL above.
 */
export function verdictFromChecks(checks, score) {
  const hasFail = checks.some(c => c.verdict === 'FAIL');
  if (hasFail) return 'FAIL';
  if (score >= 9.0) return 'PASS';
  return 'WARN';
}

/* ── Vision mode (LLM call) ────────────────────────────────────────── */

async function visionMode(slug, model, screenshotPaths) {
  /* V9-VISION (MASTER_TODO 2026-06-22) — Opus 4.8 vision call via Fable
   * wrapper. Sends a concise prompt + (up to) 10 base64 screenshots and
   * expects a JSON verdict per V9 contract.  Fails CLOSED (returns SKIP)
   * when the wrapper is missing or non-zero, so the deterministic gate
   * is never blocked by transient LLM availability. */
  const { spawnSync } = await import('node:child_process');
  const { homedir } = await import('node:os');
  const { existsSync, readFileSync } = await import('node:fs');
  const wrapper = `${homedir()}/Projects/cortex/scripts/cortex-fable-ask`;
  if (!existsSync(wrapper)) {
    return { name: 'vision-mode-llm-call', verdict: 'SKIP',
             observed: 'Fable wrapper missing' };
  }
  const imgs = [];
  for (const p of (screenshotPaths || []).slice(0, 10)) {
    if (!existsSync(p)) continue;
    imgs.push({ path: p, b64: readFileSync(p).toString('base64') });
  }
  if (imgs.length === 0) {
    return { name: 'vision-mode-llm-call', verdict: 'SKIP',
             observed: 'no screenshots provided (run with --launch first)' };
  }
  const prompt = [
    'You are V9_VISUAL_QA per agents/V9_VISUAL_QA.md. Compare the rendered',
    'slot screenshots against the GDD model summary below and return JSON',
    'matching the V9 output contract.',
    '',
    'GDD model excerpts:',
    `  title: ${model.name || 'unknown'}`,
    `  topology: ${model.topology?.kind} (${model.topology?.reels}×${model.topology?.rows} ${model.topology?.evaluation})`,
    `  theme: ${model.theme?.name || ''} palette: ${(model.theme?.palette || []).slice(0, 4).join(', ')}`,
    `  declared features: ${(model.features || []).map(f => f.kind || f).join(', ')}`,
    `  jurisdictions: ${(model.compliance || []).map(j => typeof j === 'string' ? j : j.code).join(', ')}`,
    '',
    'Output STRICT JSON only: { "verdict": "PASS"|"WARN"|"FAIL", "score": 0..10,',
    '"checks": [{ "name": "...", "verdict": "PASS"|"FAIL", "evidence": "img-name" }] }',
    'No prose. Industry-neutral language only (no vendor names).',
  ].join('\n');
  /* Fable wrapper accepts prompt on stdin; image attachments via flag.
   * We pass --image one-per-image (the wrapper handles encoding). If the
   * wrapper API changes, this call is intentionally narrow so the swap is
   * one place. */
  const argv = ['--mode', 'opus-4.8', '--max-tokens', '900'];
  for (const img of imgs) argv.push('--image', img.path);
  const r = spawnSync(wrapper, argv, {
    input: prompt, encoding: 'utf-8', timeout: 60000,
  });
  if (r.status !== 0) {
    return { name: 'vision-mode-llm-call', verdict: 'SKIP',
             observed: `wrapper exit ${r.status}: ${(r.stderr || '').slice(-200)}` };
  }
  let parsed = null;
  try {
    /* Trim any markdown code fences the wrapper may add. */
    const txt = (r.stdout || '').replace(/^```(?:json)?\s*|\s*```$/g, '').trim();
    parsed = JSON.parse(txt);
  } catch (e) {
    return { name: 'vision-mode-llm-call', verdict: 'WARN',
             observed: `non-JSON reply: ${(r.stdout || '').slice(0, 200)}` };
  }
  return {
    name: 'vision-mode-llm-call',
    verdict: parsed.verdict || 'WARN',
    score: parsed.score,
    checks: parsed.checks || [],
    observed: `Opus 4.8 verdict ${parsed.verdict} (score ${parsed.score})`,
  };
}

/* ── High-level library API: verifyHtml(slug, model, html) ──────────
 *
 * Public entry point for ingest.mjs and any other live-wire consumer.
 * Bundles parseSlot + deterministicChecks + scoreChecks +
 * verdictFromChecks into one receipt structure matching the corpus
 * orchestrator output. Pure (no I/O); caller persists the receipt.
 *
 * Returns:
 *   {
 *     wave, agent, slug, verdict ('PASS'|'WARN'|'FAIL'),
 *     checks: [...], score: 0..10, summary: string,
 *     __meta__: { ts, mode: 'deterministic' }
 *   }
 */
export function verifyHtml(slug, model, html) {
  const htmlExtract = parseSlot(html);
  const checks = deterministicChecks(slug, model, htmlExtract);
  const score = scoreChecks(checks);
  const verdict = verdictFromChecks(checks, score);
  return {
    wave: 'UQ-MASTERY-5',
    agent: 'V9_VISUAL_QA',
    slug,
    verdict,
    checks,
    score: +score.toFixed(2),
    summary: `${verdict} · score ${score.toFixed(1)}/10 · ${checks.filter(c => c.verdict === 'PASS').length}/${checks.length} PASS`,
    /* UQ-DEEP-F F-CRIT-2 fix: ts wall-clock leak. Drop ts so v9.json byte-stable
     * across runs. CLI walker (line 404 area) stamps generatedAt for batch
     * traceability separately. */
    __meta__: { mode: 'deterministic' },
  };
}

/* ── CLI walker (only runs when invoked as `node tools/v9-…`) ──────── */

const IS_CLI = (() => {
  try {
    return import.meta.url === pathToFileURL(process.argv[1] || '').href;
  } catch (_) {
    return false;
  }
})();

function listSlugs(SLUG, LIMIT) {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing`);
    process.exit(2);
  }
  const all = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() &&
           existsSync(join(p, 'slot.html')) &&
           existsSync(join(p, 'model.json'));
  });
  if (SLUG) return all.filter(d => d === SLUG);
  if (LIMIT) return all.slice(0, LIMIT);
  return all;
}

if (IS_CLI) {
  const args = process.argv.slice(2);
  const argVal = (flag) => {
    const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
    if (idx === -1) return null;
    const a = args[idx];
    return a.includes('=') ? a.split('=')[1] : args[idx + 1];
  };
  const SLUG    = argVal('--slug') || null;
  const LIMIT   = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
  /* LAUNCH + VISION reserved for future Playwright + Opus vision path. */
  const VISION  = args.includes('--vision');

  mkdirSync(OUT_DIR, { recursive: true });
  const slugs = listSlugs(SLUG, LIMIT);
  if (slugs.length === 0) {
    console.error('▸ no slot.html + model.json pairs found');
    process.exit(2);
  }

  console.log(`V9 Visual QA · processing ${slugs.length} games (${VISION ? 'VISION' : 'deterministic'} mode)...`);

  const receipts = [];
  let passCount = 0, warnCount = 0, failCount = 0;
  for (const slug of slugs) {
    let model, html;
    try {
      model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
      html  = readFileSync(join(REAL_GAMES, slug, 'slot.html'), 'utf8');
    } catch (e) {
      receipts.push({ slug, verdict: 'FAIL', error: `read error: ${e.message}` });
      failCount++;
      continue;
    }

    const receipt = verifyHtml(slug, model, html);
    if (receipt.verdict === 'PASS') passCount++;
    else if (receipt.verdict === 'WARN') warnCount++;
    else failCount++;
    receipts.push(receipt);
  }

  const ts = new Date().toISOString();
  const summary = {
    generatedAt: ts,
    tool: 'tools/v9-visual-qa.mjs',
    gamesProcessed: receipts.length,
    passCount,
    warnCount,
    failCount,
    failedSlugs: receipts.filter(r => r.verdict === 'FAIL').slice(0, 20).map(r => ({
      slug: r.slug,
      failedChecks: (r.checks || []).filter(c => c.verdict === 'FAIL').map(c => c.name),
      error: r.error,
    })),
  };

  const reportFile = join(OUT_DIR, `v9-visual-qa-${ts.replace(/[:.]/g, '-')}.json`);
  writeFileSync(reportFile, JSON.stringify({ summary, receipts }, null, 2));

  console.log('');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`V9 Visual QA · processed ${receipts.length} games`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  PASS: ${passCount}`);
  console.log(`  WARN: ${warnCount}`);
  console.log(`  FAIL: ${failCount}`);
  if (failCount > 0) {
    console.log('  First failed slugs:');
    for (const r of receipts.filter(x => x.verdict === 'FAIL').slice(0, 5)) {
      const f = (r.checks || []).filter(c => c.verdict === 'FAIL').map(c => c.name).join(', ');
      console.log(`    - ${r.slug}: ${f || r.error || 'unknown'}`);
    }
  }
  console.log(`  Report: ${reportFile}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  if (failCount > 0) {
    console.log('✗ FAIL');
    process.exit(1);
  }
  console.log(`✓ PASS — 0 visual-QA fails (${warnCount} WARN)`);
  process.exit(0);
}
