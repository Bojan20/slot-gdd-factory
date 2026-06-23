#!/usr/bin/env node
/**
 * tools/v11-deep-industry-spec.mjs
 *
 * Wave UQ-MASTERY-4 — V11 Deep Industry Spec walker.
 *
 * Boki: "kreni detaljno". Produbljuje V10 (T1-T4 strukturne provere) sa 23
 * deterministička pravila iz dubljih slojeva industry ground truth-a:
 *
 *   Layer A · Mathematics & Payback                (I1.1 – I1.5)
 *   Layer B · Feature Math Consistency             (I2.1 – I2.6)
 *   Layer C · Jurisdiction-specific compliance      (I3.1 – I3.6)
 *   Layer D · Symbol & Paytable industry floors    (I4.1 – I4.3)
 *   Layer E · Engine & Lifecycle invariants         (I5.1 – I5.3)
 *
 * SKIP-AKO-NULL PRAVILO
 *   Većina polja (rtp, maxWinX, autoplay.cap...) je `null` na neimplementiranim
 *   GDD-ovima. HARD se PALI samo kad je polje DEKLARISANO i PREKRŠENO.
 *   `null` ⇒ skip pravila (nije industry violation, samo parser gap).
 *
 * SEVERITY
 *   HARD — gate-blocking. Bilo koji declared-and-broken industry invariant.
 *   SOFT — advisory. Heuristički/probabilistički signali (mogu biti
 *          legitimne vendor-specific varijacije).
 *
 * VENDOR-NEUTRAL — nikad ne pominje konkretnu firmu. Sve "industry standard"
 *                  konstante su public GT (UKGC tehnička standardna lista,
 *                  EU regulator publikacije, GLI-19 standardi).
 *
 * USAGE
 *   node tools/v11-deep-industry-spec.mjs                # walk all 338 GDDs
 *   node tools/v11-deep-industry-spec.mjs --slug=X       # one game
 *   node tools/v11-deep-industry-spec.mjs --soft         # treat SOFT as HARD
 *   node tools/v11-deep-industry-spec.mjs --limit N      # smoke first N
 *
 * EXIT CODE
 *   0 — 0 HARD violations
 *   1 — ≥ 1 HARD violation (or any SOFT under --soft mode)
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

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
const SLUG  = argVal('--slug') || null;
const LIMIT = argVal('--limit') ? parseInt(argVal('--limit'), 10) : null;
const SOFT_AS_HARD = args.includes('--soft');

/* ── Industry deep constants (vendor-neutral, GT-publicly-cited) ───────── */

/* RTP floors per regulator (public regulator publications, % minimum).
 * Source: UKGC RTS, MGA Class 3, DGA Section 41, AGCO iGRO, SGA, DE-WHG. */
const RTP_FLOOR_PCT = {
  UKGC: 85.0, MGA: 85.0, DGA: 88.0, AGCO: 85.0, SGA: 88.0,
  'DE-WHG': 90.0, 'FR-ANJ': 92.0, 'NL-KSA': 80.0,
  'IT-ADM': 90.0, 'ES-DGOJ': 90.0,
};

/* Autoplay caps per regulator (max spins per autoplay batch). */
const AUTOPLAY_CAP = {
  UKGC: 100, DK: 50, SE: 100, 'NL-KSA': 50,
  'DE-WHG': 1, 'FR-ANJ': 0, 'IT-ADM': 50, 'ES-DGOJ': 100,
};

/* Min spin time per regulator (ms). */
const MIN_SPIN_TIME_MS = {
  'DE-WHG': 5000, 'NL-KSA': 3000, 'FR-ANJ': 3000,
};

/* Reality check max interval (ms). */
const REALITY_CHECK_MAX_MS = {
  UKGC: 60 * 60 * 1000, DGA: 30 * 60 * 1000, 'NL-KSA': 60 * 60 * 1000,
  'DE-WHG': 60 * 60 * 1000, 'IT-ADM': 60 * 60 * 1000,
};

/* Session timeout caps. */
const SESSION_TIMEOUT_MAX_MS = {
  'DE-WHG': 60 * 60 * 1000, 'NL-KSA': 60 * 60 * 1000,
  'FR-ANJ': 30 * 60 * 1000,
};

/* AnteBet industry-standard cost multipliers. */
const ANTEBET_VALID = new Set([1.25, 1.5, 1.75, 2.0]);

/* HoldAndWin scatter trigger industry range. */
const HNW_SCATTER_MIN = 3;
const HNW_SCATTER_MAX = 8;

/* Volatility index range 1-10. */
const VOL_IDX_MIN = 1;
const VOL_IDX_MAX = 10;

/* Max win cap industry range. */
const MAX_WIN_X_MIN = 100;
const MAX_WIN_X_MAX = 1_000_000;

/* Jackpot tier order (low → high). Both name and value must follow. */
const JACKPOT_TIER_ORDER = ['MINI', 'MINOR', 'MAJOR', 'GRAND'];
const JACKPOT_GRAND_MIN = 100;       // 100× bet minimum for top tier
const JACKPOT_GRAND_MAX = 1_000_000; // 1M× bet ceiling

/* Symbol pay floors (5OAK as multiplier × bet line). */
const HP_TOP_5OAK_MIN = 50;   // top HP must pay ≥ 50× on 5OAK
const LP_TOP_5OAK_MIN = 5;    // top LP must pay ≥ 5× on 5OAK

/* Helpers */
function jurCodes(model) {
  const c = model.compliance;
  const arr = Array.isArray(c) ? c
            : Array.isArray(c?.jurisdictions) ? c.jurisdictions
            : [];
  return arr.map(j => typeof j === 'string' ? j : (j?.code || j?.id || j?.name)).filter(Boolean);
}

function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ── Single-model audit ────────────────────────────────────────────── */

/** @returns {{ hard: object[], soft: object[] }} */
function auditModel(slug, model) {
  const hard = [], soft = [];
  const jur = jurCodes(model);

  /* ═══════════════════════════════════════════════════════════════
   * LAYER A · Mathematics & Payback (HARD when declared & breached)
   * ═══════════════════════════════════════════════════════════════ */

  const pb = model.payback || {};
  const rtp = num(pb.rtp);
  const maxX = num(pb.maxWinX);
  const vol = num(pb.volatilityIdx);
  const variants = Array.isArray(pb.rtpVariants) ? pb.rtpVariants : null;

  // I1.1 — RTP floor per declared jurisdiction
  if (rtp != null) {
    for (const code of jur) {
      const floor = RTP_FLOOR_PCT[code];
      if (floor != null && rtp < floor) {
        hard.push({ slug, rule: 'I1.1', msg: `RTP ${rtp}% below ${code} regulator floor ${floor}%` });
      }
    }
    // RTP can never exceed 100% (player-positive game ≠ slot)
    if (rtp > 100) {
      hard.push({ slug, rule: 'I1.1.cap', msg: `RTP ${rtp}% exceeds 100% (impossible for casino slot)` });
    }
  }

  // I1.2 — rtpVariants per-variant floor + buy variant ≤ 100%
  if (variants != null && variants.length > 0) {
    for (const v of variants) {
      const label = v?.label || v?.name || 'unknown';
      const vRtp = num(v?.rtp);
      if (vRtp == null) continue;
      if (vRtp > 100) {
        hard.push({ slug, rule: 'I1.2', msg: `rtpVariants[${label}].rtp=${vRtp}% exceeds 100%` });
      }
      for (const code of jur) {
        const floor = RTP_FLOOR_PCT[code];
        if (floor != null && vRtp < floor) {
          hard.push({ slug, rule: 'I1.2', msg: `rtpVariants[${label}].rtp=${vRtp}% below ${code} floor ${floor}%` });
        }
      }
    }
  }

  // I1.3 — volatilityIdx integer in 1-10
  if (vol != null) {
    if (!Number.isInteger(vol) || vol < VOL_IDX_MIN || vol > VOL_IDX_MAX) {
      hard.push({ slug, rule: 'I1.3', msg: `volatilityIdx ${vol} outside integer range [${VOL_IDX_MIN}, ${VOL_IDX_MAX}]` });
    }
  }

  // I1.4 — maxWinX industry range
  if (maxX != null) {
    if (maxX < MAX_WIN_X_MIN || maxX > MAX_WIN_X_MAX) {
      hard.push({ slug, rule: 'I1.4', msg: `payback.maxWinX ${maxX}× outside industry range [${MAX_WIN_X_MIN}, ${MAX_WIN_X_MAX}]` });
    }
  }

  // I1.5 — bonusBuy cost should reflect declared buy-variant RTP if both present
  const bb = model.bonusBuy;
  if (bb?.enabled === true && typeof bb.costX === 'number' && variants != null) {
    const buyV = variants.find(v => /buy|bonus/i.test(v?.label || ''));
    if (buyV && num(buyV.rtp) != null && num(buyV.rtp) > 100) {
      hard.push({ slug, rule: 'I1.5', msg: `bonusBuy.costX=${bb.costX}× but buy-variant rtp ${buyV.rtp}% > 100%` });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER B · Feature Math Consistency
   * ═══════════════════════════════════════════════════════════════ */

  // I2.1 — jackpot tier name + value monotonic (Mini < Minor < Major < Grand)
  const jp = model.jackpot;
  if (jp?.enabled === true && jp.values && typeof jp.values === 'object') {
    const present = JACKPOT_TIER_ORDER.filter(t => num(jp.values[t]) != null);
    if (present.length >= 2) {
      for (let i = 1; i < present.length; i++) {
        const a = num(jp.values[present[i - 1]]);
        const b = num(jp.values[present[i]]);
        if (a != null && b != null && b <= a) {
          hard.push({ slug, rule: 'I2.1', msg: `jackpot.values not monotonic: ${present[i - 1]}=${a} ≥ ${present[i]}=${b}` });
        }
      }
    }
  }

  // I2.2 — GRAND tier in industry range
  if (jp?.enabled === true && jp.values && num(jp.values.GRAND) != null) {
    const grand = num(jp.values.GRAND);
    if (grand < JACKPOT_GRAND_MIN || grand > JACKPOT_GRAND_MAX) {
      hard.push({ slug, rule: 'I2.2', msg: `jackpot.values.GRAND=${grand}× outside range [${JACKPOT_GRAND_MIN}, ${JACKPOT_GRAND_MAX}]` });
    }
  }

  // I2.3 — freeSpins.multiplier ladder monotonic non-decreasing if array
  const fs = model.freeSpins;
  if (fs?.enabled !== false && Array.isArray(fs?.multiplier?.ladder) && fs.multiplier.ladder.length >= 2) {
    const ladder = fs.multiplier.ladder.map(num);
    for (let i = 1; i < ladder.length; i++) {
      if (ladder[i] != null && ladder[i - 1] != null && ladder[i] < ladder[i - 1]) {
        hard.push({ slug, rule: 'I2.3', msg: `freeSpins.multiplier.ladder not monotonic: ${ladder[i - 1]} → ${ladder[i]}` });
        break;
      }
    }
  }

  // I2.4 — freeSpins.multiplier.start ≥ 1
  if (fs?.enabled !== false && fs?.multiplier?.start != null) {
    const start = num(fs.multiplier.start);
    if (start != null && start < 1) {
      hard.push({ slug, rule: 'I2.4', msg: `freeSpins.multiplier.start=${start} below industry floor 1×` });
    }
  }

  // I2.5 — holdAndWin scatterTrigger in industry range
  const hnw = model.holdAndWin;
  if (hnw?.enabled === true && hnw.scatterTrigger != null) {
    const st = num(hnw.scatterTrigger);
    if (st != null && (st < HNW_SCATTER_MIN || st > HNW_SCATTER_MAX)) {
      hard.push({ slug, rule: 'I2.5', msg: `holdAndWin.scatterTrigger=${st} outside industry range [${HNW_SCATTER_MIN}, ${HNW_SCATTER_MAX}]` });
    }
  }

  // I2.6 — anteBet.costMultiplier in industry-valid set
  const ab = model.anteBet;
  if (ab?.enabled === true && ab.costMultiplier != null) {
    const cm = num(ab.costMultiplier);
    if (cm != null && !ANTEBET_VALID.has(cm)) {
      soft.push({ slug, rule: 'I2.6', msg: `anteBet.costMultiplier=${cm}× outside industry standards {${[...ANTEBET_VALID].join(', ')}}` });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER C · Jurisdiction-specific compliance
   * ═══════════════════════════════════════════════════════════════ */

  const ap = model.autoplay;

  // I3.1 — Autoplay cap per declared jurisdiction
  if (ap?.enabled === true && ap.cap != null) {
    const cap = num(ap.cap);
    for (const code of jur) {
      const allowed = AUTOPLAY_CAP[code];
      if (allowed != null && cap > allowed) {
        hard.push({ slug, rule: 'I3.1', msg: `autoplay.cap=${cap} exceeds ${code} maximum ${allowed}` });
      }
    }
  }

  // I3.2 — Minimum spin time per declared jurisdiction
  if (model.spinTempo?.totalMs != null) {
    const total = num(model.spinTempo.totalMs);
    for (const code of jur) {
      const min = MIN_SPIN_TIME_MS[code];
      if (min != null && total != null && total < min) {
        hard.push({ slug, rule: 'I3.2', msg: `spinTempo.totalMs=${total}ms below ${code} minimum ${min}ms` });
      }
    }
  }

  // I3.3 — FR-ANJ no autoplay allowed (cap must be 0 or autoplay absent/disabled)
  if (jur.includes('FR-ANJ') || jur.includes('FR') || jur.includes('france')) {
    if (ap?.enabled === true && num(ap.cap) > 0) {
      hard.push({ slug, rule: 'I3.3', msg: `autoplay enabled with cap=${ap.cap} but FR-ANJ requires manual-only spins` });
    }
  }

  // I3.4 — Reality check interval cap per jurisdiction
  if (model.realityCheck?.intervalMs != null) {
    const interval = num(model.realityCheck.intervalMs);
    for (const code of jur) {
      const max = REALITY_CHECK_MAX_MS[code];
      if (max != null && interval != null && interval > max) {
        hard.push({ slug, rule: 'I3.4', msg: `realityCheck.intervalMs=${interval}ms exceeds ${code} cap ${max}ms` });
      }
    }
  }

  // I3.5 — DE-WHG requires netLossIndicator
  if ((jur.includes('DE-WHG') || jur.includes('DE') || jur.includes('germany'))) {
    const nli = model.netLossIndicator;
    if (nli == null || nli === false || nli?.enabled === false) {
      hard.push({ slug, rule: 'I3.5', msg: `DE-WHG declared but netLossIndicator missing/disabled` });
    }
  }

  // I3.6 — IT-ADM / ES-DGOJ require deposit limits
  for (const code of jur) {
    if (code === 'IT-ADM' || code === 'ES-DGOJ' || code === 'IT' || code === 'ES') {
      const dl = model.compliance?.depositLimitsRequired;
      if (dl === false) {
        hard.push({ slug, rule: 'I3.6', msg: `${code} declared but compliance.depositLimitsRequired=false` });
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER D · Symbol & Paytable industry floors
   * ═══════════════════════════════════════════════════════════════ */

  const symbols = Array.isArray(model.symbols) ? model.symbols
                : Array.isArray(model.paytable?.symbols) ? model.paytable.symbols
                : [];

  if (symbols.length > 0) {
    // I4.1 — Top HP 5OAK ≥ HP_TOP_5OAK_MIN×
    const hpSymbols = symbols.filter(s => (s?.tier || s?.kind) === 'hp');
    if (hpSymbols.length > 0) {
      const top5 = Math.max(...hpSymbols.map(s => num(s?.pay?.['5']) || 0));
      if (top5 > 0 && top5 < HP_TOP_5OAK_MIN) {
        soft.push({ slug, rule: 'I4.1', msg: `top HP 5OAK pay ${top5}× below industry floor ${HP_TOP_5OAK_MIN}×` });
      }
    }
    // I4.2 — Top LP 5OAK ≥ LP_TOP_5OAK_MIN×
    const lpSymbols = symbols.filter(s => (s?.tier || s?.kind) === 'lp');
    if (lpSymbols.length > 0) {
      const top5 = Math.max(...lpSymbols.map(s => num(s?.pay?.['5']) || 0));
      if (top5 > 0 && top5 < LP_TOP_5OAK_MIN) {
        soft.push({ slug, rule: 'I4.2', msg: `top LP 5OAK pay ${top5}× below industry floor ${LP_TOP_5OAK_MIN}×` });
      }
    }
    // I4.3 — Wild substitutes pay ≥ paying HP1 (when both declared)
    const wild = symbols.find(s => s?.kind === 'wild');
    const hp1 = hpSymbols[0];
    if (wild && hp1) {
      const wildPay = num(wild?.pay?.['5']) || 0;
      const hp1Pay = num(hp1?.pay?.['5']) || 0;
      if (wildPay > 0 && hp1Pay > 0 && wildPay < hp1Pay) {
        soft.push({ slug, rule: 'I4.3', msg: `wild 5OAK pay ${wildPay}× below top HP 5OAK pay ${hp1Pay}×` });
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER E · Engine & Lifecycle invariants
   * ═══════════════════════════════════════════════════════════════ */

  // I5.1 — Tumble engine implies postSpin hook chain
  if (model.tumble?.enabled === true && model.postSpin?.enabled === false) {
    hard.push({ slug, rule: 'I5.1', msg: `tumble enabled but postSpin disabled — no cascade lifecycle` });
  }

  // I5.2 — holdAndWin enabled implies respin engine present
  if (hnw?.enabled === true && model.respin?.enabled === false) {
    hard.push({ slug, rule: 'I5.2', msg: `holdAndWin enabled but respin engine disabled — no seed→lock loop` });
  }

  // I5.3 — anteBet enabled requires triggerMultiplier to be set
  if (ab?.enabled === true) {
    const tm = num(ab.triggerMultiplier);
    if (tm == null || tm < 1) {
      soft.push({ slug, rule: 'I5.3', msg: `anteBet enabled but triggerMultiplier invalid (${tm})` });
    }
  }

  return { hard, soft };
}

/* ── Walker ─────────────────────────────────────────────────────────── */

function listSlugs() {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing — run \`npm run test:parse:real-pdfs\` first.`);
    process.exit(2);
  }
  const all = readdirSync(REAL_GAMES).filter(d => {
    const p = join(REAL_GAMES, d);
    return statSync(p).isDirectory() && existsSync(join(p, 'model.json'));
  });
  if (SLUG) return all.filter(d => d === SLUG);
  if (LIMIT) return all.slice(0, LIMIT);
  return all;
}

/* UQ-DEEP-E audit fix (COMPL-2): sort for deterministic audit output. */
const slugs = listSlugs().sort();
if (slugs.length === 0) {
  console.error('▸ no model.json files found for audit');
  process.exit(2);
}

console.log(`V11 Deep Industry Spec · auditing ${slugs.length} model.json files...`);

const allHard = [], allSoft = [];
let processed = 0;
for (const slug of slugs) {
  let model;
  try {
    model = JSON.parse(readFileSync(join(REAL_GAMES, slug, 'model.json'), 'utf8'));
  } catch (e) {
    allHard.push({ slug, rule: 'I0.1', msg: `model.json unreadable: ${e.message}` });
    processed++;
    continue;
  }
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

const ts = new Date().toISOString();
const summary = {
  generatedAt: ts,
  tool: 'tools/v11-deep-industry-spec.mjs',
  gamesAudited: processed,
  hardCount: allHard.length,
  softCount: allSoft.length,
  hardByRule: groupByRule(allHard),
  softByRule: groupByRule(allSoft),
  hardSample: allHard.slice(0, 50),
  softSample: allSoft.slice(0, 50),
};

const reportFile = join(OUT_DIR, `v11-deep-industry-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`V11 Deep Industry Spec · audited ${processed} games`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  HARD violations: ${allHard.length}  (gate-blocking)`);
console.log(`  SOFT warnings  : ${allSoft.length}  (advisory)`);
if (allHard.length > 0) {
  console.log('  Hard-by-rule:', JSON.stringify(summary.hardByRule));
  console.log('  First HARD violations:');
  for (const v of allHard.slice(0, 10)) console.log(`    [${v.rule}] ${v.slug} — ${v.msg}`);
}
if (allSoft.length > 0) {
  console.log('  Soft-by-rule:', JSON.stringify(summary.softByRule));
}
console.log(`  Report: ${reportFile}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const failHard = allHard.length > 0;
const failSoft = SOFT_AS_HARD && allSoft.length > 0;
if (failHard || failSoft) {
  console.log('✗ FAIL');
  process.exit(1);
}
console.log('✓ PASS — 0 deep-industry violations');
process.exit(0);
