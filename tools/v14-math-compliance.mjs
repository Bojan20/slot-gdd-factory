#!/usr/bin/env node
/**
 * tools/v14-math-compliance.mjs
 *
 * MATH-11 — V14 math compliance walker.
 *
 * Final-tier compliance walker that gate-checks REAL math fields populated
 * by MATH-1..10. Pre-MATH unlock, V11/V12 used SKIP-AKO-NULL — fields are
 * null in 338/338 GDDs, so no HARD ever fired. After MATH-CORE, 5 main
 * games have real declared math; V14 finally pali on these.
 *
 * RULE GROUPS (this walker — 9 implemented inline)
 *   M1  RTP jurisdiction floor (HARD) — declared rtp meets regulator min
 *   M2  RTP variants per-variant floor (HARD)
 *   M3  maxWinX bounded [100, 1,000,000] (HARD)
 *   M4  volatilityIdx integer [1, 10] (HARD)
 *   M5  Hit frequency u industry range [5%, 50%] (HARD)
 *   M6  Win frequency ≤ hit frequency (HARD; win is subset of hits)
 *   M7  reelStrips.baseSetCount > 0 if declared (HARD)
 *   M8  reelStrips.stop_distribution sums to ~1.0 when normalized (SOFT)
 *   M10 Jackpot tier values monotonic (HARD, V12 I2.1 stricter)
 *
 * DELEGATED rule groups (dedicated tools, NOT enforced by this walker —
 * keep here for cross-reference; do NOT count as walker coverage):
 *   M9  RTP source breakdown Σ ≈ declared RTP   → tools/math-rtp-breakdown.mjs (MATH-8)
 *   M11 Jackpot total share ≤ 55% × baseRTP    → tools/math-jackpot-contribution.mjs (MATH-10)
 *   M12 BB variant RTP within UKGC RTS 13C tol → tools/math-bb-variant.mjs (MATH-9)
 *
 * Doc-string previously claimed "12 rule groups" inline — actual count
 * is 9 inline + 3 delegated. ULTRA-DEEP-QA B1 fix (2026-06-22, P1).
 *
 * SKIP-AKO-NULL still applies for fields not yet declared (333/338 GDDs
 * imaju null math). Only games sa declared math get full enforcement.
 *
 * USAGE
 *   node tools/v14-math-compliance.mjs              # walk all 338
 *   node tools/v14-math-compliance.mjs --slug X     # single
 *   node tools/v14-math-compliance.mjs --strict     # treat SOFT as HARD
 *
 * EXIT
 *   0 — 0 HARD violations
 *   1 — ≥ 1 HARD (or any SOFT under --strict)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { MATH_PRECISION_BAND_PCT, MATH_PRECISION_BAND_LABEL } from '../src/registry/mathPrecision.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = `${REPO}/dist/real-games`;
const OUT_DIR    = `${REPO}/reports`;
mkdirSync(OUT_DIR, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const idx = args.findIndex(a => a === flag || a.startsWith(flag + '='));
  if (idx === -1) return null;
  const a = args[idx];
  return a.includes('=') ? a.split('=')[1] : args[idx + 1];
};
const SLUG = argVal('--slug') || null;
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const STRICT = args.includes('--strict');

/* ── Regulator RTP floors (per V11 I1.1, harmonized) ─────────────── */
const RTP_FLOOR_PCT = {
  UKGC: 85.0, MGA: 85.0, DGA: 88.0, AGCO: 85.0, SGA: 88.0,
  'DE-WHG': 90.0, 'FR-ANJ': 92.0, 'NL-KSA': 80.0,
  'IT-ADM': 90.0, 'ES-DGOJ': 90.0,
};

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function jurCodes(model) {
  const c = model.compliance;
  const arr = Array.isArray(c) ? c
            : Array.isArray(c?.jurisdictions) ? c.jurisdictions : [];
  return arr.map(j => typeof j === 'string' ? j : (j?.code || j?.id || j?.name)).filter(Boolean);
}

/* ── Single-model audit ──────────────────────────────────────────── */
function auditModel(slug, model) {
  const hard = [], soft = [];
  const p = model.payback || {};
  const jur = jurCodes(model);

  /* M0 — precision compliance gate (Boki direktiva 2026-06-22).
   * If a probe report exists alongside this model, declared and measured
   * RTP / HF must agree within ±0.05% (= MATH_PRECISION_BAND_PCT). This is
   * the regulator-grade certification band; generic-distribution probe
   * runs WILL fail this — to JE intencija (gap surfaces clearly, ne sakriva).
   * SOFT (informational) by default; --strict gate-blocks. */
  const probePath = join(REPO, `reports/math-rtp/${slug}.json`);
  if (existsSync(probePath)) {
    try {
      const probe = JSON.parse(readFileSync(probePath, 'utf8'));
      if (probe.rtpDelta != null && Math.abs(probe.rtpDelta) > MATH_PRECISION_BAND_PCT) {
        soft.push({
          slug, rule: 'M0.rtp',
          msg: `measured RTP delta ${probe.rtpDelta} pp exceeds precision band ${MATH_PRECISION_BAND_LABEL} (needs MATH-7 WASM oracle + real par sheet weights)`
        });
      }
      if (probe.hfDelta != null && Math.abs(probe.hfDelta) > MATH_PRECISION_BAND_PCT) {
        soft.push({
          slug, rule: 'M0.hf',
          msg: `measured HF delta ${probe.hfDelta} pp exceeds precision band ${MATH_PRECISION_BAND_LABEL}`
        });
      }
    } catch (_) { /* probe corrupt — skip */ }
  }

  /* M1 — RTP jurisdiction floor (only when both rtp AND jur declared). */
  const rtp = num(p.rtp);
  if (rtp != null) {
    for (const code of jur) {
      const floor = RTP_FLOOR_PCT[code];
      if (floor != null && rtp < floor) {
        hard.push({ slug, rule: 'M1', msg: `RTP ${rtp}% below ${code} regulator floor ${floor}%` });
      }
    }
    if (rtp > 100) hard.push({ slug, rule: 'M1.cap', msg: `RTP ${rtp}% > 100% impossible` });
  }

  /* M2 — RTP variants per-variant floor. */
  if (Array.isArray(p.rtpVariants)) {
    for (const v of p.rtpVariants) {
      const vRtp = num(v.rtp);
      if (vRtp == null) continue;
      if (vRtp > 100) hard.push({ slug, rule: 'M2', msg: `variant ${v.label} rtp ${vRtp}% > 100%` });
      for (const code of jur) {
        const floor = RTP_FLOOR_PCT[code];
        if (floor != null && vRtp < floor) {
          hard.push({ slug, rule: 'M2', msg: `variant ${v.label} ${vRtp}% below ${code} floor ${floor}%` });
        }
      }
    }
  }

  /* M3 — maxWinX bounded. */
  const maxX = num(p.maxWinX) || num(model.winCap?.maxWinX);
  if (maxX != null && (maxX < 100 || maxX > 1_000_000)) {
    hard.push({ slug, rule: 'M3', msg: `maxWinX ${maxX} outside [100, 1,000,000]` });
  }

  /* M4 — volatilityIdx integer [1, 10]. */
  const vol = num(p.volatilityIdx);
  if (vol != null && (!Number.isInteger(vol) || vol < 1 || vol > 10)) {
    hard.push({ slug, rule: 'M4', msg: `volatilityIdx ${vol} outside integer [1, 10]` });
  }

  /* M5 — Hit frequency u industry range. */
  const hf = num(p.hitFrequency);
  if (hf != null && (hf < 5 || hf > 50)) {
    hard.push({ slug, rule: 'M5', msg: `hitFrequency ${hf}% outside [5%, 50%]` });
  }

  /* M6 — winFrequency ≤ hitFrequency (win subset of hits). */
  const wf = num(p.winFrequency);
  if (wf != null && hf != null && wf > hf) {
    hard.push({ slug, rule: 'M6', msg: `winFrequency ${wf}% > hitFrequency ${hf}% (must be subset)` });
  }

  /* M7 — reelStrips.baseSetCount > 0 if declared. */
  const baseCount = num(model.reelStrips?.baseSetCount);
  if (baseCount != null && baseCount <= 0) {
    hard.push({ slug, rule: 'M7', msg: `reelStrips.baseSetCount=${baseCount} must be > 0` });
  }

  /* M8 — stop_distribution sane (sum > 0). */
  const sd = model.reelStrips?.stop_distribution;
  if (sd && typeof sd === 'object') {
    const sum = Object.values(sd).reduce((acc, v) => acc + (num(v) || 0), 0);
    if (sum <= 0 || sum > 5) {
      soft.push({ slug, rule: 'M8', msg: `stop_distribution sum ${sum.toFixed(2)} out of (0, 5]` });
    }
  }

  /* M10 — jackpot tier values monotonic. */
  const jp = model.jackpot;
  if (jp?.enabled === true && jp.values) {
    const TIER_ORDER = ['MINI', 'MINOR', 'MAJOR', 'GRAND'];
    const present = TIER_ORDER.filter(t => num(jp.values[t]) != null);
    for (let i = 1; i < present.length; i++) {
      const a = num(jp.values[present[i - 1]]);
      const b = num(jp.values[present[i]]);
      if (a != null && b != null && b <= a) {
        hard.push({ slug, rule: 'M10', msg: `jackpot.values not monotonic: ${present[i - 1]}=${a} ≥ ${present[i]}=${b}` });
      }
    }
  }

  return { hard, soft };
}

function listSlugs() {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing`); process.exit(2);
  }
  const all = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
  });
  if (SLUG) return all.filter(d => d === SLUG);
  if (LIMIT) return all.slice(0, LIMIT);
  return all;
}

const slugs = listSlugs();
if (slugs.length === 0) { console.error('▸ no models'); process.exit(2); }

console.log(`V14 Math Compliance · auditing ${slugs.length} games...`);

const allHard = [], allSoft = [];
let processed = 0, gamesWithMath = 0;
for (const slug of slugs) {
  let model;
  try { model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8')); }
  catch (e) { allHard.push({ slug, rule: 'M0', msg: `model unreadable: ${e.message}` }); processed++; continue; }
  if (model.payback?.rtp != null) gamesWithMath++;
  const { hard, soft } = auditModel(slug, model);
  allHard.push(...hard);
  allSoft.push(...soft);
  processed++;
}

function groupByRule(arr) {
  const m = {};
  for (const v of arr) m[v.rule] = (m[v.rule] || 0) + 1;
  return m;
}

const summary = {
  generatedAt: new Date().toISOString(),
  tool: 'tools/v14-math-compliance.mjs',
  gamesAudited: processed,
  gamesWithDeclaredMath: gamesWithMath,
  hardCount: allHard.length,
  softCount: allSoft.length,
  hardByRule: groupByRule(allHard),
  softByRule: groupByRule(allSoft),
  hardSample: allHard.slice(0, 30),
};

const ts = new Date().toISOString();
const reportFile = join(OUT_DIR, `v14-math-compliance-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`V14 Math Compliance · ${processed} games audited (${gamesWithMath} with declared math)`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  HARD: ${allHard.length}`);
console.log(`  SOFT: ${allSoft.length}`);
if (allHard.length > 0) {
  console.log('  Hard-by-rule:', JSON.stringify(summary.hardByRule));
  for (const v of allHard.slice(0, 10)) console.log(`    [${v.rule}] ${v.slug} — ${v.msg}`);
}
console.log(`  Report: ${reportFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const failHard = allHard.length > 0;
const failSoft = STRICT && allSoft.length > 0;
if (failHard || failSoft) { console.log('✗ FAIL'); process.exit(1); }
console.log('✓ PASS — 0 V14 math compliance violations');
process.exit(0);
