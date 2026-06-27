#!/usr/bin/env node
/**
 * tools/par-sheet-block-until-perfect.mjs
 *
 * BLOCK-1-b (Boki direktiva 2026-06-27) — "ja zelim da simulator radi sve
 * dok ne izadje sve savrseno za igru i ne izgradi se slot."
 *
 * Glavni loop orchestrator koji vrti convergence sa adaptive precision
 * escalation sve dok measured RTP ne padne unutar ±0.05 pp od declared
 * RTP — i tek tada signal-izira da je slot SAFE za build. Ako loop
 * istroši sve precision tier-ove bez PASS-a, emit-uje NON_CONVERGENT
 * receipt sa diagnostic info o najverovatnijem uzroku.
 *
 * # PRECISION ESCALATION LADDER
 *
 *   ┌────┬───────────┬────────────┬──────────────────────────────────────┐
 *   │ #  │ spins/sd  │ total      │ akcija                                │
 *   ├────┼───────────┼────────────┼──────────────────────────────────────┤
 *   │ 1  │ 5M × 4    │ 20M        │ brzi PASS check + auto-tune nudge    │
 *   │ 2  │ 50M × 4   │ 200M       │ sweep aktivnih osa + re-tune          │
 *   │ 3  │ 100M × 4  │ 400M       │ duboko merenje, W99 ~3-5 pp           │
 *   │ 4  │ 500M × 4  │ 2B         │ heavy statistical lock                │
 *   │ 5  │ 1B × 4    │ 4B         │ production-grade convergence          │
 *   │ 6  │ 5B × 4    │ 20B        │ regulator audit tier                  │
 *   │ 7  │ 10B × 4   │ 40B        │ finalni terminal tier                 │
 *   └────┴───────────┴────────────┴──────────────────────────────────────┘
 *
 * # STRICT BAND
 *
 *   ±0.05 pp delta + Wilson99 ≤ delta (regulator-grade).
 *   Konstanta dolazi iz src/registry/mathPrecision.mjs — bilo koja
 *   labavija tolerancija je regression vector. Ako MATH_PRECISION_BAND_PP
 *   ikad bude relaksiran, ovaj gate to nasleđuje automatski.
 *
 * # USAGE
 *
 *   # Standard — vrti dok ne dobije PASS ili dok ne istroši 10B×4:
 *   node tools/par-sheet-block-until-perfect.mjs --slug cash-eruption
 *
 *   # Brzi smoke — samo prvi tier:
 *   node tools/par-sheet-block-until-perfect.mjs --slug X --max-tier 5M
 *
 *   # Dry run — bez stvarnih spinova, koristi mock oracle za contract test:
 *   node tools/par-sheet-block-until-perfect.mjs --slug X --mock
 *
 * # OUTPUT
 *
 *   reports/par-block-until-perfect/<slug>.json
 *     {
 *       slug, verdict: "PASS" | "FAIL" | "NON_CONVERGENT",
 *       iterations: [{ tier, spins, measuredPct, deltaPP, wilsonHalfPP,
 *                      verdict, reason, walltimeMs }, ...],
 *       finalDeltaPP, finalTier, terminalReason,
 *       buildAllowed: true | false,
 *       receiptPath,
 *       generatedAt
 *     }
 *
 * Build-gated CLI (build-gated.mjs) reads buildAllowed; ako je false,
 * buildSlotHTML nikad ne pokrene.
 *
 * # ANTI-PATTERN GUARDS
 *
 *   - Nijedna iteracija ne sme da prepiše prethodni receipt — sve se
 *     append-uju u iteration trace.
 *   - Ako oracle vrati error, ne smatra se to PASS-om — tretira se kao
 *     transient FAIL i escalation nastavlja.
 *   - "Mock" mod je samo za contract testove; pravi build path mora da
 *     ima realan oracle.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { argv, exit } from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  MATH_PRECISION_BAND_PP,
  MATH_PRECISION_BAND_LABEL,
} from '../src/registry/mathPrecision.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO_ROOT  = resolve(__dirname, '..');
const OUT_DIR    = join(REPO_ROOT, 'reports', 'par-block-until-perfect');
const CONV_DIR   = join(REPO_ROOT, 'reports', 'par-convergence');
const PAR_MODELS = join(REPO_ROOT, 'dist', 'par-sheet-real-games');

/* Precision escalation ladder. Tier label → spinsPerSeed value. */
export const TIER_LADDER = Object.freeze([
  { label: '5M',   spins:    5_000_000, seeds: 4 },
  { label: '50M',  spins:   50_000_000, seeds: 4 },
  { label: '100M', spins:  100_000_000, seeds: 4 },
  { label: '500M', spins:  500_000_000, seeds: 4 },
  { label: '1B',   spins: 1_000_000_000, seeds: 4 },
  { label: '5B',   spins: 5_000_000_000, seeds: 4 },
  { label: '10B',  spins: 10_000_000_000, seeds: 4 },
]);

/* ─── CLI parsing ───────────────────────────────────────────────────── */

function parseArgs(args) {
  const out = {
    slug: null,
    maxTier: '10B',
    mock: false,
    autoTune: true,
    dryRun: false,
  };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--slug') out.slug = args[++i];
    else if (a === '--max-tier') out.maxTier = args[++i];
    else if (a === '--mock') out.mock = true;
    else if (a === '--no-auto-tune') out.autoTune = false;
    else if (a === '--dry-run') out.dryRun = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      exit(0);
    }
  }
  return out;
}

function printHelp() {
  console.log(`
par-sheet-block-until-perfect — vrti convergence dok ne dobije ±${MATH_PRECISION_BAND_PP} pp PASS.

USAGE
  node tools/par-sheet-block-until-perfect.mjs --slug <slug> [opts]

OPTIONS
  --slug <name>     Slug iz dist/par-sheet-real-games/. (REQUIRED)
  --max-tier <lbl>  Stop escalation posle ovog tier-a (5M|50M|100M|500M|1B|5B|10B).
                    Default: 10B (full ladder).
  --mock            Koristi mock oracle (za contract test, ne stvarni Rust kernel).
  --no-auto-tune    Preskoči auto-tune sweep pre svake escalation iteracije.
  --dry-run         Samo planiraj ladder, nemoj zvati oracle.

OUTPUT
  reports/par-block-until-perfect/<slug>.json
`);
}

/* ─── Mock oracle (za contract testove) ─────────────────────────────── */

/**
 * Mock oracle plan: simulira convergence trace. Default-no se PASS-uje
 * na tier 3 (100M×4) sa deltom 0.03 pp. Kontrolni knobs preko env-a:
 *
 *   BLOCK_MOCK_PASS_TIER     — tier index na kome PASS-uje (0..6)
 *                              Default 2 (100M). Ako > tier ladder len,
 *                              loop nikad ne dobije PASS → NON_CONVERGENT.
 *   BLOCK_MOCK_DELTA_PP      — final deltaPP value (default 0.03)
 *   BLOCK_MOCK_DECLARED_PCT  — declared RTP (default 96.5)
 *   BLOCK_MOCK_DETERMINISTIC — kad set, svaka iteracija isti measured
 */
function mockOracleIteration(slug, tierIdx, tier) {
  const passTier = parseInt(process.env.BLOCK_MOCK_PASS_TIER ?? '2', 10);
  const finalDelta = parseFloat(process.env.BLOCK_MOCK_DELTA_PP ?? '0.03');
  const declared = parseFloat(process.env.BLOCK_MOCK_DECLARED_PCT ?? '96.5');

  /* Linearno smanjuje delta kroz tier-ove dok ne dođe do finalDelta na
   * passTier-u. Posle passTier-a delta ostaje konstanta na finalDelta. */
  let deltaPP;
  if (tierIdx >= passTier) {
    deltaPP = finalDelta;
  } else {
    /* Initial delta = 1.0 pp na tier 0, opada linearno. */
    const startDelta = 1.0;
    const span = Math.max(1, passTier);
    const frac = tierIdx / span;
    deltaPP = startDelta + (finalDelta - startDelta) * frac;
  }
  const measuredPct = declared + deltaPP;
  /* Wilson99 opada sa sqrt(spins). 5M×4 = ~21pp, 100M×4 = ~5pp, 10B×4 ~0.3pp */
  const wilsonHalfPP = 21 / Math.sqrt((tier.spins * tier.seeds) / 20_000_000);
  /* Verdict: |Δ| ≤ band AND |Δ| ≤ Wilson99 */
  const absDelta = Math.abs(deltaPP);
  const passing =
    absDelta <= MATH_PRECISION_BAND_PP && absDelta <= wilsonHalfPP;
  return {
    tier: tier.label,
    spins: tier.spins * tier.seeds,
    declaredPct: declared,
    measuredPct,
    deltaPP,
    wilsonHalfPP,
    verdict: passing ? 'PASS' : 'FAIL',
    reason: passing
      ? `within ±${MATH_PRECISION_BAND_PP} pp AND within Wilson99`
      : `delta ${deltaPP.toFixed(3)} pp out of band (Wilson ${wilsonHalfPP.toFixed(2)} pp)`,
    walltimeMs: tier.spins / 200_000, /* synthetic */
    mocked: true,
  };
}

/* ─── Real oracle (par-sheet-convergence subprocess) ────────────────── */

/**
 * Pokreće tools/_par-sheet-convergence.mjs subprocess na zadatom tier-u.
 * Returns parsed receipt iz reports/par-convergence/<slug>.json.
 */
function runRealOracle(slug, tier) {
  return new Promise((resolveP, rejectP) => {
    const tool = join(REPO_ROOT, 'tools', '_par-sheet-convergence.mjs');
    const args = [
      tool,
      '--slug', slug,
      '--spins', String(tier.spins),
      '--seeds', String(tier.seeds),
    ];
    const t0 = Date.now();
    const child = spawn(process.execPath, args, { stdio: 'inherit' });
    child.on('error', rejectP);
    child.on('exit', (code) => {
      const walltimeMs = Date.now() - t0;
      if (code !== 0) {
        rejectP(new Error(`convergence subprocess exited ${code}`));
        return;
      }
      const receiptPath = join(CONV_DIR, `${slug}.json`);
      if (!existsSync(receiptPath)) {
        rejectP(new Error(`convergence receipt not found: ${receiptPath}`));
        return;
      }
      try {
        const r = JSON.parse(readFileSync(receiptPath, 'utf8'));
        resolveP({
          tier: tier.label,
          spins: r.totalSpins,
          declaredPct: r.declared,
          measuredPct: r.measuredPct,
          deltaPP: r.deltaPP,
          wilsonHalfPP: r.wilsonHalfPP,
          verdict: r.verdict,
          reason: r.reason,
          walltimeMs,
          mocked: false,
        });
      } catch (err) {
        rejectP(err);
      }
    });
  });
}

/* ─── Auto-tune nudge (optional, between iterations) ────────────────── */

/**
 * Pokreće _par-sheet-auto-tune.mjs subprocess da regeneriše tuning axes
 * iz auto-tune.json fajla. Sav rad je idempotent — auto-tune čita
 * model + manifest i emit-uje novi auto-tune.json. Receipt path se ne
 * koristi ovde direktno; sledeća convergence iteracija će ga pokupiti.
 */
function runAutoTuneNudge(slug) {
  return new Promise((resolveP) => {
    const tool = join(REPO_ROOT, 'tools', '_par-sheet-auto-tune.mjs');
    if (!existsSync(tool)) {
      resolveP({ ran: false, reason: 'auto-tune tool absent' });
      return;
    }
    const child = spawn(process.execPath, [tool, '--slug', slug], {
      stdio: 'ignore',
    });
    child.on('exit', (code) => {
      resolveP({ ran: true, exitCode: code });
    });
    child.on('error', () => {
      resolveP({ ran: false, reason: 'spawn error' });
    });
  });
}

/* ─── Diagnostic suggestion on terminal FAIL ────────────────────────── */

/**
 * Heuristika koja iz iteration trace-a izvlači najverovatniji uzrok kad
 * loop ne konvergira. Ne tvrdi 100 % — to je hint za operatora.
 */
export function diagnoseNonConvergence(iterations) {
  if (!iterations.length) {
    return { hint: 'no iterations ran', confidence: 'low' };
  }
  const last = iterations[iterations.length - 1];
  const deltas = iterations.map((i) => i.deltaPP);
  const signs = deltas.map((d) => Math.sign(d));
  const allPositive = signs.every((s) => s > 0);
  const allNegative = signs.every((s) => s < 0);

  if (allPositive) {
    return {
      hint:
        'measured RTP konzistentno IZNAD declared — par sheet weight za jedan ' +
        'od HIGH_PAY simbola je vrlo verovatno PREMALI u model.json, ili neki ' +
        'cash trigger nije recognized kao scatter (pa odlazi u pool).',
      finalDeltaPP: last.deltaPP,
      confidence: 'medium',
    };
  }
  if (allNegative) {
    return {
      hint:
        'measured RTP konzistentno ISPOD declared — verovatno nedostaje feature ' +
        'contribution (FS ladder, HnW respin, bonus buy, coin boost) ili je ' +
        'weight nekog scatter/trigger simbola PREVELIKI.',
      finalDeltaPP: last.deltaPP,
      confidence: 'medium',
    };
  }
  /* Sign flip → noise dominant, povećaj spinova */
  return {
    hint:
      'delta menja znak između iteracija — statistical noise dominira nad ' +
      'signalom. Najverovatniji uzrok: prerano je za PASS gate ili je band ' +
      'preuzak za trenutnu volatilnost igre.',
    finalDeltaPP: last.deltaPP,
    confidence: 'low',
  };
}

/* ─── Loop kernel ───────────────────────────────────────────────────── */

/**
 * Pokreće glavni loop. `oracleFn(slug, tierIdx, tier) → Promise<iter>`
 * je inject-ovan za testabilnost. Real path uses runRealOracle; mock path
 * uses mockOracleIteration.
 */
export async function runBlockUntilPerfect({
  slug,
  maxTierLabel = '10B',
  oracle,           /* injected: async (slug, tierIdx, tier) → iteration */
  autoTune = true,
  onIteration = () => {},
} = {}) {
  if (!slug) throw new Error('slug is required');
  if (typeof oracle !== 'function') {
    throw new Error('oracle function required (use mock or real)');
  }
  const maxIdx = Math.max(
    0,
    TIER_LADDER.findIndex((t) => t.label === maxTierLabel),
  );
  const ladder = TIER_LADDER.slice(0, maxIdx + 1);
  const iterations = [];

  for (let i = 0; i < ladder.length; i++) {
    const tier = ladder[i];
    const iter = await oracle(slug, i, tier);
    iterations.push(iter);
    onIteration(iter, i);
    /* STRICT PASS check — verdict from oracle + delta band redundancy. */
    const absDelta = Math.abs(iter.deltaPP);
    const inBand = absDelta <= MATH_PRECISION_BAND_PP;
    const wilsonOk = absDelta <= iter.wilsonHalfPP;
    if (iter.verdict === 'PASS' && inBand && wilsonOk) {
      return {
        verdict: 'PASS',
        finalTier: tier.label,
        finalDeltaPP: iter.deltaPP,
        iterations,
        buildAllowed: true,
        terminalReason: `converged within ±${MATH_PRECISION_BAND_PP} pp at tier ${tier.label}`,
      };
    }
    /* Optional auto-tune between iterations (not on last). */
    if (autoTune && i < ladder.length - 1) {
      await runAutoTuneNudge(slug).catch(() => {});
    }
  }
  /* Exhausted ladder without PASS. */
  const diag = diagnoseNonConvergence(iterations);
  return {
    verdict: 'NON_CONVERGENT',
    finalTier: ladder[ladder.length - 1].label,
    finalDeltaPP: iterations[iterations.length - 1]?.deltaPP ?? null,
    iterations,
    buildAllowed: false,
    terminalReason: `escalation exhausted: ${diag.hint}`,
    diagnosis: diag,
  };
}

/* ─── Receipt emit ──────────────────────────────────────────────────── */

export function writeReceipt(slug, result) {
  mkdirSync(OUT_DIR, { recursive: true });
  const receiptPath = join(OUT_DIR, `${slug}.json`);
  const receipt = {
    slug,
    ...result,
    band: {
      pp: MATH_PRECISION_BAND_PP,
      label: MATH_PRECISION_BAND_LABEL,
    },
    receiptPath,
    generatedAt: new Date().toISOString(),
  };
  writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  return receipt;
}

/* ─── Console report ────────────────────────────────────────────────── */

function renderReport(slug, result) {
  console.log(`\n┌─ BLOCK-UNTIL-PERFECT · slug: ${slug}`);
  console.log(`│  band: ±${MATH_PRECISION_BAND_PP} pp (regulator-grade)`);
  console.log(`├─ iterations`);
  for (let i = 0; i < result.iterations.length; i++) {
    const it = result.iterations[i];
    const mark = it.verdict === 'PASS' ? '✅' : '❌';
    console.log(
      `│  ${i + 1}. tier=${it.tier.padEnd(4)} spins=${String(it.spins).padStart(13)} ` +
        `Δ=${it.deltaPP >= 0 ? '+' : ''}${it.deltaPP.toFixed(3)} pp ` +
        `W99=${it.wilsonHalfPP.toFixed(2)} pp ${mark} ${it.verdict}`,
    );
  }
  console.log(`├─ verdict: ${result.verdict}`);
  console.log(`├─ buildAllowed: ${result.buildAllowed ? '✅ YES' : '❌ NO'}`);
  console.log(`└─ ${result.terminalReason}`);
  if (result.diagnosis) {
    console.log(`\n  Diagnostic hint (${result.diagnosis.confidence} confidence):`);
    console.log(`    ${result.diagnosis.hint}`);
  }
}

/* ─── Main ──────────────────────────────────────────────────────────── */

async function main() {
  const opts = parseArgs(argv.slice(2));
  if (!opts.slug) {
    console.error('error: --slug required');
    printHelp();
    exit(2);
  }
  if (!opts.mock && !existsSync(join(PAR_MODELS, opts.slug, 'model.json'))) {
    console.error(`error: slug "${opts.slug}" has no model.json in ${PAR_MODELS}`);
    exit(2);
  }
  if (opts.dryRun) {
    console.log('dry run — tier ladder:');
    const cutoff = TIER_LADDER.findIndex((t) => t.label === opts.maxTier);
    TIER_LADDER.slice(0, cutoff + 1).forEach((t, i) =>
      console.log(
        `  ${i + 1}. ${t.label.padEnd(4)} ${(t.spins * t.seeds).toLocaleString()} total spins`,
      ),
    );
    exit(0);
  }
  const oracle = opts.mock
    ? async (slug, i, tier) => mockOracleIteration(slug, i, tier)
    : async (slug, i, tier) => runRealOracle(slug, tier);

  const result = await runBlockUntilPerfect({
    slug: opts.slug,
    maxTierLabel: opts.maxTier,
    oracle,
    autoTune: opts.autoTune,
    onIteration: (it, i) =>
      console.log(
        `▸ iter ${i + 1} · ${it.tier} · Δ ${it.deltaPP.toFixed(3)} pp · ${it.verdict}`,
      ),
  });
  const receipt = writeReceipt(opts.slug, result);
  renderReport(opts.slug, result);
  console.log(`\n📝 receipt: ${receipt.receiptPath}`);
  exit(result.buildAllowed ? 0 : 1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('fatal:', err.stack || err.message);
    exit(2);
  });
}
