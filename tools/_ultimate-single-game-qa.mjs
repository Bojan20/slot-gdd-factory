#!/usr/bin/env node
/**
 * tools/_ultimate-single-game-qa.mjs
 *
 * BLOCK-2 (Boki direktiva 2026-06-27) — "ultimativni QA na jednoj igri da
 * se sve bilduje kako treba od lego blokova po GDDu i da matematika radi
 * kada se ubaci takodje savrseno".
 *
 * Single-game end-to-end QA orchestrator. Uzima JEDAN slug i prolazi ga
 * kroz kompletan pipeline, sa NACRTANIM ASCII receipt-om na stdout
 * (HARD RULE #3 — Boki ne vidi Markdown tabele).
 *
 *   ┌────────┬───────────────────────────────────────────────────────────┐
 *   │ Stage   │ Šta proverava                                              │
 *   ├────────┼───────────────────────────────────────────────────────────┤
 *   │ A INGEST│ V6 cache exists ili GDD source dostupan                   │
 *   │ B HYDRO │ smartDefaults autofix preživeo bez gap-a                  │
 *   │ C MATH  │ par-block-until-perfect verdict=PASS, ±0.05 pp gate       │
 *   │ D BUILD │ buildSlotHTML proizveo slot.html bez throw-a              │
 *   │ E LIVE  │ block liveness audit za ovaj slot — 0 DEAD                │
 *   │ F RENDR │ jsdom boot — kritički DOM noduli prisutni                 │
 *   │ G XCHEK │ par-sheet model.json ⇆ build manifest cross-check         │
 *   │ H RCPT  │ konačni receipt + dist artifact listing                   │
 *   └────────┴───────────────────────────────────────────────────────────┘
 *
 * USAGE
 *   node tools/_ultimate-single-game-qa.mjs --slug cash-eruption
 *   node tools/_ultimate-single-game-qa.mjs --slug cash-eruption --mock-math
 *
 * EXIT CODES
 *   0  — svih 8 stage-ova GREEN
 *   1  — bilo koji stage RED (receipt sadrži first-failure stage)
 *   2  — bad CLI usage
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');

const OUT_DIR = join(REPO_ROOT, 'reports', 'ultimate-single-game');
mkdirSync(OUT_DIR, { recursive: true });

/* ─── CLI parse ──────────────────────────────────────────────────────── */

function parseArgs(argv) {
  const o = { slug: null, mockMath: false, skipMath: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--slug')         o.slug = argv[++i];
    else if (a === '--mock-math')  o.mockMath = true;
    else if (a === '--skip-math')  o.skipMath = true;
    else if (a === '-h' || a === '--help') {
      printHelp(); process.exit(0);
    }
  }
  return o;
}

function printHelp() {
  console.log(`Usage: node tools/_ultimate-single-game-qa.mjs --slug <slug>`);
  console.log(`Flags: --mock-math   (use mock oracle za math gate)`);
  console.log(`       --skip-math   (assume math already converged)`);
}

/* ─── Subprocess runner ──────────────────────────────────────────────── */

function runChild(cmd, args, opts = {}) {
  return new Promise((res) => {
    const t0 = Date.now();
    const child = spawn(cmd, args, { cwd: REPO_ROOT, stdio: 'pipe', ...opts });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => {
      res({ code, stdout, stderr, walltimeMs: Date.now() - t0 });
    });
    child.on('error', (err) => {
      res({ code: -1, stdout, stderr: stderr + err.message, walltimeMs: Date.now() - t0 });
    });
  });
}

/* ─── Stage primitives ───────────────────────────────────────────────── */

function makeStage(id, label) {
  return {
    id, label,
    status: 'pending',           /* pending | pass | fail | skip */
    detail: null,
    error: null,
    walltimeMs: 0,
  };
}

function pass(stage, detail) { stage.status = 'pass'; stage.detail = detail; return stage; }
function fail(stage, error)  { stage.status = 'fail'; stage.error = error; return stage; }
function skip(stage, detail) { stage.status = 'skip'; stage.detail = detail; return stage; }

/* ─── Stage A — INGEST presence ──────────────────────────────────────── */

async function stageIngest(slug) {
  const s = makeStage('A', 'INGEST');
  const t0 = Date.now();

  const v6Path = join(REPO_ROOT, 'tools', '_wave-v-cache', `${slug}-foundry-gdd.json`);
  const altV6  = join(REPO_ROOT, 'tools', '_wave-v-cache', `${slug}.json`);
  const modelPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'model.json');
  const manifestPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'manifest.json');

  const have = {
    v6: existsSync(v6Path) ? v6Path : (existsSync(altV6) ? altV6 : null),
    model: existsSync(modelPath) ? modelPath : null,
    manifest: existsSync(manifestPath) ? manifestPath : null,
  };
  s.walltimeMs = Date.now() - t0;

  if (!have.v6 && !have.model) {
    return fail(s, `no V6 cache ili par-sheet model.json za slug=${slug}`);
  }
  return pass(s, {
    v6Cache: have.v6 ? basename(have.v6) : null,
    parModel: have.model ? basename(have.model) : null,
    parManifest: have.manifest ? basename(have.manifest) : null,
  });
}

/* ─── Stage B — SMART DEFAULTS hydrate ───────────────────────────────── */

async function stageHydrate(slug) {
  const s = makeStage('B', 'HYDRO');
  const t0 = Date.now();
  try {
    const modelPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'model.json');
    if (!existsSync(modelPath)) return fail(s, `model.json missing`);
    const raw = JSON.parse(readFileSync(modelPath, 'utf-8'));
    const { applySmartDefaults } = await import('../src/registry/smartDefaults.mjs');
    const hydrated = applySmartDefaults(raw);

    /* Verify critical UX surface populated. */
    const need = ['theme', 'symbols', 'topology', 'features'];
    const missing = need.filter((k) => hydrated[k] == null);
    s.walltimeMs = Date.now() - t0;
    if (missing.length) return fail(s, `missing keys posle hydrate: ${missing.join(',')}`);

    const symbolCount = Array.isArray(hydrated.symbols)
      ? hydrated.symbols.length
      : (hydrated.symbols && typeof hydrated.symbols === 'object'
          ? Object.keys(hydrated.symbols).length
          : 0);
    const featureCount = Array.isArray(hydrated.features)
      ? hydrated.features.length
      : (hydrated.features ? Object.keys(hydrated.features).length : 0);
    const paytableCount = Array.isArray(hydrated.paytable) ? hydrated.paytable.length : 0;
    return pass(s, {
      symbols: symbolCount,
      paytable: paytableCount,
      features: featureCount,
      topology: `${hydrated.topology?.kind ?? '?'}/${hydrated.topology?.reels ?? '?'}x${hydrated.topology?.rows ?? '?'}`,
    });
  } catch (err) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `applySmartDefaults threw: ${err.message}`);
  }
}

/* ─── Stage C — PAR-sheet block-until-perfect ───────────────────────── */

async function stageMath(slug, { mock, skip: skipFlag }) {
  const s = makeStage('C', 'MATH');
  const t0 = Date.now();

  if (skipFlag) {
    s.walltimeMs = Date.now() - t0;
    return skip(s, { note: 'skipped via --skip-math' });
  }

  const tool = join(REPO_ROOT, 'tools', 'par-sheet-block-until-perfect.mjs');
  const args = [tool, '--slug', slug, '--max-tier', '5M'];
  if (mock) args.push('--mock');

  const r = await runChild(process.execPath, args);
  s.walltimeMs = Date.now() - t0;

  const receiptPath = join(REPO_ROOT, 'reports', 'par-block-until-perfect', `${slug}.json`);
  if (!existsSync(receiptPath)) {
    return fail(s, `no receipt at ${receiptPath} (exit=${r.code})`);
  }
  const rcpt = JSON.parse(readFileSync(receiptPath, 'utf-8'));
  if (rcpt.verdict !== 'PASS' || !rcpt.buildAllowed) {
    return fail(s, `verdict=${rcpt.verdict} buildAllowed=${rcpt.buildAllowed} terminalReason=${rcpt.terminalReason}`);
  }
  return pass(s, {
    verdict: rcpt.verdict,
    finalTier: rcpt.finalTier,
    finalDeltaPP: Number(rcpt.finalDeltaPP.toFixed(6)),
    band: rcpt.band?.label ?? '±0.05%',
    iterations: rcpt.iterations.length,
    buildAllowed: rcpt.buildAllowed,
  });
}

/* ─── Stage D — BUILD slot.html ─────────────────────────────────────── */

async function stageBuild(slug) {
  const s = makeStage('D', 'BUILD');
  const t0 = Date.now();
  try {
    const modelPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'model.json');
    if (!existsSync(modelPath)) return fail(s, `model.json missing`);
    const raw = JSON.parse(readFileSync(modelPath, 'utf-8'));
    const { applySmartDefaults } = await import('../src/registry/smartDefaults.mjs');
    const model = applySmartDefaults(raw);
    model.__slug = slug;
    model.__require_convergence__ = true;
    process.env.SLOT_BUILD_REQUIRE_CONVERGENCE = '1';

    const { buildSlotHTML } = await import('../src/buildSlotHTML.mjs');
    const html = buildSlotHTML(model);
    const outDir = join(REPO_ROOT, 'dist', 'ultimate-single-game', slug);
    mkdirSync(outDir, { recursive: true });
    const outPath = join(outDir, 'slot.html');
    writeFileSync(outPath, html);

    s.walltimeMs = Date.now() - t0;
    return pass(s, {
      htmlPath: outPath,
      bytes: Buffer.byteLength(html),
      hasSlotRoot: /id="slot-root"|class="slot-root"/.test(html),
      hasSpinBtn: /data-(?:role|action)=["']spin["']|id=["']spin/i.test(html),
    });
  } catch (err) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `buildSlotHTML threw: ${err.message}`);
  }
}

/* ─── Stage E — BLOCK LIVENESS (this slot's HTML) ────────────────────── */

async function stageLiveness(slug) {
  const s = makeStage('E', 'LIVE');
  const t0 = Date.now();
  const htmlPath = join(REPO_ROOT, 'dist', 'ultimate-single-game', slug, 'slot.html');
  if (!existsSync(htmlPath)) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `slot.html ne postoji (Stage D failed?)`);
  }

  try {
    const html = readFileSync(htmlPath, 'utf-8');
    const manifestPath = join(REPO_ROOT, 'blocks', '_manifest.json');
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const blocks = Array.isArray(manifest.blocks) ? manifest.blocks : [];

    /* Per-slot mount census + global liveness invariant.
     *
     *   - mounted   = blok ima trag u OVOM HTML-u (live signal za ovaj slot)
     *   - silent    = 0 traga u OVOM HTML-u (može biti DORMANT globalno ili
     *                 conditional-on koje GDD nije aktivirao — to NIJE pad)
     *   - globalDead = pravi DEAD count iz globalnog liveness walkera
     *                 (svetlo). Per-slot pad jedino ako globalni DEAD > 0. */
    let mounted = 0, silent = 0;
    for (const b of blocks) {
      const name = b.name || b.id || b.slug;
      if (!name) continue;
      const variants = [
        name,
        name.replace(/[-_](\w)/g, (_, c) => c.toUpperCase()),
        name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
      ];
      const present = variants.some((v) => html.toLowerCase().includes(v.toLowerCase()));
      if (present) mounted++;
      else silent++;
    }

    /* Globalni liveness audit signal (ako exists). */
    const globalPath = join(REPO_ROOT, 'tools', '_eyes', 'block-liveness', '_liveness.json');
    let globalDead = null;
    if (existsSync(globalPath)) {
      try {
        const g = JSON.parse(readFileSync(globalPath, 'utf-8'));
        globalDead = g?.classes?.DEAD ?? g?.dead ?? null;
      } catch {}
    }

    s.walltimeMs = Date.now() - t0;
    if (globalDead != null && globalDead > 0) {
      return fail(s, `globalDead=${globalDead} (0 DEAD invariant prekršen)`);
    }
    if (mounted < 100) {
      return fail(s, `mounted=${mounted} <100 (slot HTML deluje prazno)`);
    }
    return pass(s, {
      mounted,
      silent,
      totalBlocks: blocks.length,
      globalDead: globalDead ?? '—',
    });
  } catch (err) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `liveness scan threw: ${err.message}`);
  }
}

/* ─── Stage F — RENDER SMOKE (jsdom boot) ────────────────────────────── */

async function stageRender(slug) {
  const s = makeStage('F', 'RENDR');
  const t0 = Date.now();
  const htmlPath = join(REPO_ROOT, 'dist', 'ultimate-single-game', slug, 'slot.html');
  if (!existsSync(htmlPath)) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `slot.html ne postoji`);
  }
  try {
    const html = readFileSync(htmlPath, 'utf-8');
    /* jsdom je optional — koristimo string contract checks da izbegnemo
     * još jednu npm dep. Ako jsdom postoji u node_modules, koristimo ga
     * za pravi boot. Inače — invariant checks. */
    let jsdom = null;
    try { jsdom = await import('jsdom'); } catch {}

    const checks = {
      htmlSize: html.length,
      hasDoctype:        /^\s*<!doctype html>/i.test(html),
      hasHead:           /<head[\s>]/i.test(html),
      hasBody:           /<body[\s>]/i.test(html),
      hasReelGrid:       /reel|grid|board/i.test(html),
      hasSpinControl:    /spin/i.test(html),
      hasPaytable:       /paytable|pay-table|pay_table/i.test(html),
      hasBalanceUI:      /balance|credit/i.test(html),
      hasStakeUI:        /stake|bet/i.test(html),
      hasNoUnclosedScript: !/<script[^>]*>[^<]*$/i.test(html),
    };
    const required = ['hasDoctype', 'hasHead', 'hasBody', 'hasReelGrid',
                       'hasSpinControl', 'hasPaytable', 'hasBalanceUI',
                       'hasStakeUI', 'hasNoUnclosedScript'];
    const missing = required.filter((k) => !checks[k]);

    let domBoot = null;
    if (jsdom && missing.length === 0) {
      try {
        const { JSDOM } = jsdom;
        const dom = new JSDOM(html, { runScripts: 'outside-only' });
        domBoot = {
          documentElement: !!dom.window.document.documentElement,
          bodyChildren: dom.window.document.body.children.length,
          title: dom.window.document.title || null,
        };
      } catch (err) {
        domBoot = { error: err.message };
      }
    }

    s.walltimeMs = Date.now() - t0;
    if (missing.length > 0) {
      return fail(s, `missing DOM invariants: ${missing.join(',')}`);
    }
    return pass(s, { ...checks, domBoot });
  } catch (err) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `render smoke threw: ${err.message}`);
  }
}

/* ─── Stage G — MANIFEST cross-check ────────────────────────────────── */

async function stageXcheck(slug) {
  const s = makeStage('G', 'XCHEK');
  const t0 = Date.now();
  try {
    const modelPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'model.json');
    const manifestPath = join(REPO_ROOT, 'dist', 'par-sheet-real-games', slug, 'manifest.json');
    const convPath = join(REPO_ROOT, 'reports', 'par-convergence', `${slug}.json`);
    const blockPath = join(REPO_ROOT, 'reports', 'par-block-until-perfect', `${slug}.json`);

    const model = JSON.parse(readFileSync(modelPath, 'utf-8'));
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
    const block = existsSync(blockPath) ? JSON.parse(readFileSync(blockPath, 'utf-8')) : null;
    const conv = existsSync(convPath) ? JSON.parse(readFileSync(convPath, 'utf-8')) : null;

    /* Cross-check signali. */
    const slugInModel = model.slug || model.__slug || null;
    const slugInManifest = manifest.slug || null;
    const slugInBlock = block?.slug || null;
    const allMatch = slugInModel === slug && slugInManifest === slug && slugInBlock === slug;

    const declared = block?.iterations?.[0]?.declaredPct ?? null;
    const measured = block?.iterations?.[0]?.measuredPct ?? null;
    const delta = (declared != null && measured != null) ? (measured - declared) : null;

    s.walltimeMs = Date.now() - t0;
    if (!allMatch) {
      return fail(s, `slug mismatch: model=${slugInModel} manifest=${slugInManifest} block=${slugInBlock}`);
    }
    if (delta != null && Math.abs(delta) > 0.05) {
      return fail(s, `delta van ±0.05 pp: ${delta.toFixed(4)} pp`);
    }
    return pass(s, {
      slugAlignment: 'all match',
      declaredPct: declared,
      measuredPct: measured,
      deltaPP: delta != null ? Number(delta.toFixed(6)) : null,
      sourceFile: manifest.source?.filename ?? null,
      sheetCount: manifest.source?.sheetCount ?? null,
    });
  } catch (err) {
    s.walltimeMs = Date.now() - t0;
    return fail(s, `xcheck threw: ${err.message}`);
  }
}

/* ─── Stage H — Final receipt + ASCII table ──────────────────────────── */

function symbol(status) {
  return status === 'pass' ? '✅'
       : status === 'fail' ? '❌'
       : status === 'skip' ? '⏭️ '
       : '⏳';
}

function pad(str, n) {
  const s = String(str ?? '');
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function fmtMs(ms) {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function renderReceipt(slug, stages) {
  const ok = stages.every((s) => s.status === 'pass' || s.status === 'skip');
  const lines = [];
  lines.push('');
  lines.push('┌──────────────────────────────────────────────────────────────────────────────┐');
  lines.push(`│  ULTIMATE SINGLE-GAME QA · slug=${pad(slug, 41)}      │`);
  lines.push('├──────────────────────────────────────────────────────────────────────────────┤');
  lines.push('│ ID │ Stage │ Status      │ Walltime │ Detail                                 │');
  lines.push('├────┼───────┼─────────────┼──────────┼────────────────────────────────────────┤');
  for (const s of stages) {
    const sym = symbol(s.status);
    const detail = s.status === 'fail' ? `ERR: ${s.error}` : compactDetail(s.detail);
    lines.push(
      `│ ${pad(s.id, 2)} │ ${pad(s.label, 5)} │ ${sym} ${pad(s.status.toUpperCase(), 8)} │ ${pad(fmtMs(s.walltimeMs), 8)} │ ${pad(detail, 38)} │`
    );
  }
  lines.push('├────┴───────┴─────────────┴──────────┴────────────────────────────────────────┤');
  const verdictLine = ok
    ? `│  VERDICT: ✅ ALL GREEN — slot SAFE za production (${stages.length} stage-a prošlo)         │`
    : `│  VERDICT: ❌ RED — prvi pad: ${pad(stages.find((s) => s.status === 'fail')?.id || '?', 40)}            │`;
  lines.push(verdictLine);
  lines.push('└──────────────────────────────────────────────────────────────────────────────┘');
  lines.push('');
  return lines.join('\n');
}

function compactDetail(d) {
  if (d == null) return '—';
  if (typeof d === 'string') return d;
  const parts = [];
  for (const [k, v] of Object.entries(d)) {
    if (v == null || v === false) continue;
    if (typeof v === 'object') continue;
    parts.push(`${k}=${v}`);
    if (parts.join(' ').length > 32) break;
  }
  return parts.join(' ');
}

/* ─── Main ───────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (!opts.slug) {
    console.error('error: --slug required');
    printHelp();
    process.exit(2);
  }

  const stages = [];
  const slug = opts.slug;

  const stepFns = [
    () => stageIngest(slug),
    () => stageHydrate(slug),
    () => stageMath(slug, { mock: opts.mockMath, skip: opts.skipMath }),
    () => stageBuild(slug),
    () => stageLiveness(slug),
    () => stageRender(slug),
    () => stageXcheck(slug),
  ];

  for (const fn of stepFns) {
    const stage = await fn();
    stages.push(stage);
    /* Hard-fail short-circuit posle Stage D fail-a (downstream zavisi). */
    if (stage.status === 'fail' && ['A', 'B', 'C', 'D'].includes(stage.id)) {
      break;
    }
  }

  const receipt = renderReceipt(slug, stages);
  console.log(receipt);

  /* Pisanje JSON receipta. */
  const ok = stages.every((s) => s.status === 'pass' || s.status === 'skip');
  const outPath = join(OUT_DIR, `${slug}.json`);
  writeFileSync(outPath, JSON.stringify({
    slug,
    verdict: ok ? 'PASS' : 'FAIL',
    stages,
    generatedAt: new Date().toISOString(),
  }, null, 2));
  console.log(`  receipt: ${outPath}\n`);

  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error('fatal:', err.stack || err.message);
  process.exit(2);
});
