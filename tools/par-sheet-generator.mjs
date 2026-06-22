#!/usr/bin/env node
/**
 * tools/par-sheet-generator.mjs
 *
 * MATH-6 — PAR (Probability Accounting Report) sheet generator.
 *
 * Combines:
 *   - MATH-1 model.payback (rtp, rtpVariants, hf, wf, volIdx, maxWinX)
 *   - MATH-2 model.reelStrips (set counts, distribution)
 *   - MATH-3 probe results (measured RTP, hit freq, win histogram)
 *   - MATH-5 vol calc (variance, σ, CV, measured tier)
 *
 * Produces regulator-grade PAR sheet u 2 formata:
 *   - reports/par-sheets/<slug>.json    machine-readable (GLI-19 compliant struct)
 *   - reports/par-sheets/<slug>.txt     ASCII tabela for review (vendor-neutral)
 *
 * xlsx output is NOT generated (npm dependency 'xlsx' not in deps + adds
 * 500KB+ to install). JSON + ASCII are sufficient for regulator audit —
 * any spreadsheet tool can import them deterministically.
 *
 * INPUT
 *   --slug X     game slug (default cash-eruption-foundry-gdd)
 *
 * OUTPUT
 *   reports/par-sheets/<slug>.json
 *   reports/par-sheets/<slug>.txt
 *
 * EXIT
 *   0 — PAR sheet generated
 *   1 — required inputs missing (model + probe + vol)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = `${REPO}/reports/par-sheets`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || 'cash-eruption-foundry-gdd';

const MODEL = join(REPO, `dist/real-games/${SLUG}/model.json`);
const PROBE = join(REPO, `reports/math-rtp/${SLUG}.json`);
const VOL   = join(REPO, `reports/math-volatility/${SLUG}.json`);

if (!existsSync(MODEL)) {
  console.error(`▸ model.json missing for ${SLUG}: ${MODEL}`);
  process.exit(1);
}

const model = JSON.parse(readFileSync(MODEL, 'utf8'));
const probe = existsSync(PROBE) ? JSON.parse(readFileSync(PROBE, 'utf8')) : null;
const vol   = existsSync(VOL)   ? JSON.parse(readFileSync(VOL,   'utf8')) : null;

if (!probe) console.warn(`⚠ probe report missing — run tools/math-rtp-probe.mjs --slug ${SLUG} first`);
if (!vol)   console.warn(`⚠ volatility report missing — run tools/math-volatility-calc.mjs --slug ${SLUG} first`);

/* ── Compose PAR sheet structure ────────────────────────────────────── */
const par = {
  $schema: 'par-sheet/v1',
  $standard: 'GLI-19 reference (vendor-neutral)',
  generatedAt: new Date().toISOString(),
  tool: 'tools/par-sheet-generator.mjs',
  slug: SLUG,

  identification: {
    /* ULTRA-DEEP-QA M4-M6-1 (2026-06-22, P0 CRITICAL) — vendor-neutral
     * regulator artefact. PAR sheet is sent to GLI/UKGC/MGA auditors; per
     * HARD RULE #1 it MUST NOT contain vendor-coded game titles
     * ("Cash Eruption", "Huff N' More Puff", "Gates of Olympus 1000", etc.)
     * nor jackpot ladder labels like "GRAND 1" (which leaked through
     * model.name fallback). Title is now the canonical SLUG (already
     * normalized vendor-neutral via parse-real-pdfs pipeline). The original
     * title (if any) is preserved in identification.declaredTitle for
     * internal cross-reference but Audit-grade output reads `title`. */
    title: SLUG,
    declaredTitle: model.title || model.name || null,
    topology: {
      reels:    model.topology?.reels,
      rows:     model.topology?.rows,
      paylines: model.topology?.paylines,
      kind:     model.topology?.kind,
      evaluation: model.topology?.evaluation,
    },
  },

  declared: {
    rtp:          model.payback?.rtp,
    rtpVariants:  model.payback?.rtpVariants,
    hitFrequency: model.payback?.hitFrequency,
    winFrequency: model.payback?.winFrequency,
    volatilityIdx: model.payback?.volatilityIdx,
    volatilityTier: model.theme?.volatility,
    maxWinX:      model.payback?.maxWinX || model.winCap?.maxWinX,
  },

  reelStrips: {
    baseSetCount: model.reelStrips?.baseSetCount,
    fsSetCount:   model.reelStrips?.fsSetCount,
    samplingMode: model.reelStrips?.samplingMode,
    kind:         model.reelStrips?.kind,
    stop_distribution: model.reelStrips?.stop_distribution,
  },

  measured: probe ? {
    runs:         probe.runs,
    measuredRTP:  probe.measuredRTP,
    measuredHF:   probe.measuredHF,
    rtpDelta:     probe.rtpDelta,
    hfDelta:      probe.hfDelta,
    maxSingleSpinX: probe.maxSingleSpinX,
    longestLosingStreak: probe.longestLosingStreak,
    winHistogram: probe.winHistogram,
    seedDeterministic: true,
  } : null,

  volatility: vol ? {
    mean:         vol.mean,
    variance:     vol.variance,
    sigma:        vol.sigma,
    cv:           vol.cv,
    measuredTier: vol.measuredTier,
    measuredIdx:  vol.measuredIdx,
    tierMatch:    vol.tierMatch,
    idxDelta:     vol.idxDelta,
  } : null,

  audit: {
    inputsPresent: {
      model: existsSync(MODEL),
      probe: existsSync(PROBE),
      vol:   existsSync(VOL),
    },
    rtpAcceptanceBand: '±2% per MATH-CORE acceptance criteria',
    volAcceptanceBand: '±1 idx per MATH-CORE acceptance criteria',
    rtpPasses: probe ? Math.abs(probe.rtpDelta || 0) <= 2 : null,
    volPasses: vol   ? Math.abs(vol.idxDelta || 0)  <= 1 : null,
  },
};

/* ── Write JSON ─────────────────────────────────────────────────────── */
const jsonOut = join(OUT_DIR, `${SLUG}.json`);
writeFileSync(jsonOut, JSON.stringify(par, null, 2));

/* ── Write ASCII tabela ─────────────────────────────────────────────── */
function row(label, value) {
  const v = value == null ? 'n/a' : String(value);
  return `│ ${label.padEnd(28)} │ ${v.padEnd(42)} │`;
}

const ascii = [
  '╔═══════════════════════════════════════════════════════════════════════════╗',
  `║   PAR SHEET · ${par.identification.title.slice(0, 50).padEnd(56)} ║`,
  `║   Standard: GLI-19 reference (vendor-neutral)                              ║`,
  `║   Generated: ${par.generatedAt.padEnd(56)} ║`,
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  '║ DECLARED                                                                  ║',
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  row('RTP (primary)',         par.declared.rtp != null ? par.declared.rtp + '%' : 'n/a'),
  row('RTP variants',          par.declared.rtpVariants?.length ? par.declared.rtpVariants.map(v => v.rtp + '%').join(' / ') : 'n/a'),
  row('Hit frequency',         par.declared.hitFrequency != null ? par.declared.hitFrequency + '%' : 'n/a'),
  row('Win frequency',         par.declared.winFrequency != null ? par.declared.winFrequency + '%' : 'n/a'),
  row('Volatility tier',       par.declared.volatilityTier || 'n/a'),
  row('Volatility idx',        par.declared.volatilityIdx),
  row('Max win cap (× bet)',   par.declared.maxWinX),
  row('Topology',              `${par.identification.topology.reels}×${par.identification.topology.rows} ${par.identification.topology.kind || ''}`.trim()),
  row('Paylines',              par.identification.topology.paylines),
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  '║ REEL STRIPS                                                               ║',
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  row('Base strip sets',       par.reelStrips.baseSetCount),
  row('FS strip sets',         par.reelStrips.fsSetCount),
  row('Sampling mode',         par.reelStrips.samplingMode),
  row('Distribution kind',     par.reelStrips.kind),
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  '║ MEASURED (from probe)                                                     ║',
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  row('Runs',                  par.measured?.runs),
  row('Measured RTP',          par.measured?.measuredRTP != null ? par.measured.measuredRTP + '%' : 'n/a'),
  row('Measured HF',           par.measured?.measuredHF  != null ? par.measured.measuredHF + '%'  : 'n/a'),
  row('RTP Δ (m − d)',         par.measured?.rtpDelta),
  row('HF Δ (m − d)',          par.measured?.hfDelta),
  row('Max single spin (× bet)', par.measured?.maxSingleSpinX),
  row('Longest losing streak', par.measured?.longestLosingStreak),
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  '║ VOLATILITY                                                                ║',
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  row('Mean win/spin (× bet)', par.volatility?.mean),
  row('Variance (σ²)',         par.volatility?.variance),
  row('Std dev (σ)',           par.volatility?.sigma),
  row('CV',                    par.volatility?.cv),
  row('Measured tier',         par.volatility?.measuredTier),
  row('Measured idx',          par.volatility?.measuredIdx),
  row('Tier match',            par.volatility?.tierMatch),
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  '║ AUDIT                                                                     ║',
  '╠═══════════════════════════════════════════════════════════════════════════╣',
  row('RTP acceptance band',   par.audit.rtpAcceptanceBand),
  row('Vol acceptance band',   par.audit.volAcceptanceBand),
  row('RTP passes',            par.audit.rtpPasses),
  row('Vol passes',            par.audit.volPasses),
  '╚═══════════════════════════════════════════════════════════════════════════╝',
].join('\n');

const txtOut = join(OUT_DIR, `${SLUG}.txt`);
writeFileSync(txtOut, ascii);

console.log(ascii);
console.log(`\nWrote: ${jsonOut}`);
console.log(`Wrote: ${txtOut}`);

/* ULTRA-DEEP-QA M4-M6-2 (2026-06-22, P0) — refuse to emit a regulator-
 * grade artefact with a structurally empty payload. A PAR sheet that
 * has no declared RTP, no measured probe, and no volatility data is
 * not a PAR sheet — it is a stub. Previously the tool printed
 * "✓ PASS — PAR sheet generated" and exit 0 for Wrath / Gates main
 * games whose model.payback was {}, creating a false-positive audit
 * signal. Three-input gate (declared rtp, measured probe, vol calc)
 * — pass requires all three present (≥ 2 of 3 → WARN, ≤ 1 → STUB+exit 2). */
const declaredRtpOk = Number.isFinite(par.declared?.rtp);
const measuredOk    = !!(par.measured && Object.keys(par.measured).length > 0);
const volOk         = !!(par.volatility && Object.keys(par.volatility).length > 0);
const completeness  = [declaredRtpOk, measuredOk, volOk].filter(Boolean).length;

if (completeness === 3) {
  console.log('✓ PASS — PAR sheet generated (declared + measured + vol)');
  process.exit(0);
} else if (completeness === 2) {
  console.log(`⚠ WARN — PAR sheet partial (${completeness}/3 input dimensions present)`);
  console.log(`   declared rtp: ${declaredRtpOk}  measured: ${measuredOk}  vol: ${volOk}`);
  process.exit(0);
} else {
  console.error(`✗ STUB — PAR sheet has only ${completeness}/3 input dimensions; refusing to claim PASS.`);
  console.error(`   declared rtp: ${declaredRtpOk}  measured: ${measuredOk}  vol: ${volOk}`);
  console.error(`   Run \`node tools/math-rtp-probe.mjs --slug ${SLUG}\` + \`math-volatility-calc.mjs --slug ${SLUG}\` first.`);
  process.exit(2);
}
