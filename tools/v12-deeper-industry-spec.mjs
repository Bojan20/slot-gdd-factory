#!/usr/bin/env node
/**
 * tools/v12-deeper-industry-spec.mjs
 *
 * Wave UQ-MASTERY-6 — V12 Deeper Industry Spec walker.
 *
 * Boki: "kreni redom ultimativno" — opcija C. Produbljuje V11 (Layer A-E)
 * sa SLEDEĆIM nivoom slot-industry GT-a koji V11 ne pokriva:
 *
 *   Layer F · Paytable economics             (I6.1 – I6.5)
 *   Layer G · Free-spin economics             (I7.1 – I7.4)
 *   Layer H · Bonus-buy economics             (I8.1 – I8.3)
 *   Layer J · Engine signature consistency    (I9.1 – I9.4)
 *   Layer K · UX presentation invariants      (I10.1 – I10.3)
 *
 * SKIP-AKO-NULL: HARD se pali samo ako polje JE deklarisano i prekršeno.
 *                Većina pravila pre-uslovljeno postojanjem field-a.
 *
 * VENDOR-NEUTRAL: konstante su public GT (regulator tehničke standarde,
 *                 GLI-19, MGA Class 3, UKGC RTS).
 *
 * USAGE
 *   node tools/v12-deeper-industry-spec.mjs           # walk all 338
 *   node tools/v12-deeper-industry-spec.mjs --slug=X  # single
 *   node tools/v12-deeper-industry-spec.mjs --soft    # treat SOFT as HARD
 *   node tools/v12-deeper-industry-spec.mjs --limit N # smoke first N
 *
 * EXIT
 *   0 — 0 HARD violations
 *   1 — ≥ 1 HARD (or any SOFT under --soft)
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

/* ── Constants ──────────────────────────────────────────────────────── */

/* Paytable economics — public GT from GLI-19 + regulator publications. */
const HP_MIN_TIERS = 4;          // minimum number of HP-tier symbols (typical 4)
const HP_MAX_TIERS = 8;          // maximum (exotic Megaclusters use 7-8)
const LP_MIN_TIERS = 3;          // minimum LP tiers (9/10/J/Q/K/A or 6-symbol set)
const LP_MAX_TIERS = 10;         // maximum LP tiers
const SYM_NAME_MIN_LEN = 1;      // symbol name must be ≥ 1 char (no empty strings)
const SYM_NAME_MAX_LEN = 80;     // max length 80 chars (parser noise > this)

/* Free-spin economics. */
const FS_MIN_TRIGGER_SCATTERS = 3;   // industry standard: ≥ 3 scatters trigger FS
const FS_AWARD_MIN = 5;              // minimum spins per trigger (industry baseline)
const FS_AWARD_MAX = 100;            // maximum (uncapped → use FS_AWARD_MAX as ceiling check)
const FS_MULT_CAP_MIN = 2;           // ladder cap must be ≥ 2× (else multiplier doesn't matter)
const FS_MULT_CAP_MAX = 1000;        // ladder cap ≤ 1000×
const FS_RETRIGGER_CAP = 500;        // retrigger cap ≤ 500 spins (regulator concerns above)

/* Bonus-buy economics — UKGC banned bonus buy in UK; other jurisdictions allow.
 * For declared bonus_buy, cost band sanity. */
const BB_COST_MIN = 30;       // industry baseline 30× bet
const BB_COST_MAX = 200;      // industry ceiling 200× bet (above = exotic / regulator concern)

/* Engine signature consistency. */
const REELS_FOR_5X3 = 5;
const ROWS_FOR_5X3 = 3;
const REELS_FOR_6X5 = 6;
const ROWS_FOR_6X5 = 5;

/* UX presentation. */
const SPIN_TEMPO_MIN_MS = 800;    // industry-standard spin animation ≥ 800ms
const SPIN_TEMPO_MAX_MS = 6000;   // ≤ 6s (above = player frustration)
const ANTICIPATION_MIN_MS = 200;  // anticipation animation ≥ 200ms

/* Helpers */
function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function getSymbolList(model) {
  return Array.isArray(model.symbols) ? model.symbols
       : Array.isArray(model.paytable?.symbols) ? model.paytable.symbols
       : [];
}

/* ── Single-model audit ────────────────────────────────────────────── */

function auditModel(slug, model) {
  const hard = [], soft = [];
  const t = model.topology || {};

  /* ═══════════════════════════════════════════════════════════════
   * LAYER F · Paytable economics
   * ═══════════════════════════════════════════════════════════════ */

  const symbols = getSymbolList(model);
  if (symbols.length > 0) {
    const hpSyms = symbols.filter(s => (s?.tier || s?.kind) === 'hp');
    const lpSyms = symbols.filter(s => (s?.tier || s?.kind) === 'lp');

    // I6.1 — HP tier count in industry range
    if (hpSyms.length > 0) {
      if (hpSyms.length < HP_MIN_TIERS || hpSyms.length > HP_MAX_TIERS) {
        hard.push({ slug, rule: 'I6.1', msg: `HP tier count ${hpSyms.length} outside industry range [${HP_MIN_TIERS}, ${HP_MAX_TIERS}]` });
      }
    }

    // I6.2 — LP tier count in industry range
    if (lpSyms.length > 0) {
      if (lpSyms.length < LP_MIN_TIERS || lpSyms.length > LP_MAX_TIERS) {
        hard.push({ slug, rule: 'I6.2', msg: `LP tier count ${lpSyms.length} outside industry range [${LP_MIN_TIERS}, ${LP_MAX_TIERS}]` });
      }
    }

    // I6.3 — every symbol has a valid name
    for (const s of symbols) {
      const name = s?.name || '';
      if (name.length < SYM_NAME_MIN_LEN || name.length > SYM_NAME_MAX_LEN) {
        hard.push({ slug, rule: 'I6.3', msg: `symbol name "${name.slice(0, 40)}" len ${name.length} outside [${SYM_NAME_MIN_LEN}, ${SYM_NAME_MAX_LEN}]` });
        break;  // one report per slug is enough
      }
    }

    // I6.4 — HP top pay > LP top pay (monotonic tier ordering)
    if (hpSyms.length > 0 && lpSyms.length > 0) {
      const hpMax = Math.max(...hpSyms.map(s => num(s?.pay?.['5']) || 0));
      const lpMax = Math.max(...lpSyms.map(s => num(s?.pay?.['5']) || 0));
      if (hpMax > 0 && lpMax > 0 && hpMax <= lpMax) {
        soft.push({ slug, rule: 'I6.4', msg: `top HP 5OAK ${hpMax}× ≤ top LP 5OAK ${lpMax}× — paytable tier inversion` });
      }
    }

    // I6.5 — at least one wild OR scatter present (slot machine convention)
    const hasWild    = symbols.some(s => s?.kind === 'wild');
    const hasScatter = symbols.some(s => s?.kind === 'scatter' || s?.kind === 'bonus');
    if (!hasWild && !hasScatter) {
      soft.push({ slug, rule: 'I6.5', msg: `no wild/scatter/bonus symbol in paytable (unusual for industry slot)` });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER G · Free-spin economics
   * ═══════════════════════════════════════════════════════════════ */

  const fs = model.freeSpins;
  if (fs?.enabled === true) {
    // I7.1 — scatter trigger count in industry range
    const trigCount = num(fs.triggerCount) || num(fs.scatterTriggerCount);
    if (trigCount != null && trigCount < FS_MIN_TRIGGER_SCATTERS) {
      hard.push({ slug, rule: 'I7.1', msg: `FS trigger requires ${trigCount} scatters — below industry floor ${FS_MIN_TRIGGER_SCATTERS}` });
    }

    // I7.2 — FS award value range when awards declared.
    // SOFT only: 3-spin micro-bonuses (Fire-Link family) are legitimate
    // industry variants; FS_AWARD_MIN is the typical standard but not a
    // regulator-enforced floor. HARD only if award is 0 or negative.
    if (Array.isArray(fs.awards) && fs.awards.length > 0) {
      const maxAward = Math.max(...fs.awards.map(a => num(a?.value || a?.spins || a) || 0));
      if (maxAward < 0) {
        hard.push({ slug, rule: 'I7.2', msg: `FS max award ${maxAward} negative (impossible)` });
      } else if (maxAward > 0 && maxAward < FS_AWARD_MIN) {
        soft.push({ slug, rule: 'I7.2', msg: `FS max award ${maxAward} below industry typical ${FS_AWARD_MIN} (micro-bonus variant?)` });
      }
      if (maxAward > FS_AWARD_MAX) {
        soft.push({ slug, rule: 'I7.2', msg: `FS max award ${maxAward} above industry typical ${FS_AWARD_MAX}` });
      }
    }

    // I7.3 — multiplier ladder cap sane.
    // SKIP if cap is 1 (effective: multiplier disabled). Pravilo pali samo
    // ako je cap eksplicitno > 1 ali nelegalan range.
    const mult = fs.multiplier;
    if (mult && (mult.cap != null || Array.isArray(mult.ladder))) {
      const cap = num(mult.cap) || (Array.isArray(mult.ladder) ? num(mult.ladder[mult.ladder.length - 1]) : null);
      if (cap != null && cap > 1) {  // skip 1× (no real impact)
        if (cap < FS_MULT_CAP_MIN) {
          soft.push({ slug, rule: 'I7.3', msg: `FS multiplier cap ${cap}× below typical ${FS_MULT_CAP_MIN}×` });
        }
        if (cap > FS_MULT_CAP_MAX) {
          hard.push({ slug, rule: 'I7.3', msg: `FS multiplier cap ${cap}× above industry ceiling ${FS_MULT_CAP_MAX}×` });
        }
      }
    }

    // I7.4 — retrigger cap sanity
    const retrig = num(fs.retriggerCap);
    if (retrig != null && retrig > FS_RETRIGGER_CAP) {
      soft.push({ slug, rule: 'I7.4', msg: `FS retrigger cap ${retrig} above industry-recommended ${FS_RETRIGGER_CAP}` });
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER H · Bonus-buy economics
   * ═══════════════════════════════════════════════════════════════ */

  const bb = model.bonusBuy;
  if (bb?.enabled === true) {
    // I8.1 — cost band industry range
    const costX = num(bb.costX);
    if (costX != null) {
      if (costX < BB_COST_MIN || costX > BB_COST_MAX) {
        hard.push({ slug, rule: 'I8.1', msg: `bonusBuy.costX=${costX}× outside industry range [${BB_COST_MIN}, ${BB_COST_MAX}]×` });
      }
    }

    // I8.2 — UKGC declared but bonus buy enabled → blocked (UKGC ban since 2025)
    // UQ-DEEP-E audit fix (COMPL-1): normalize jurisdiction codes to
    // upper-case before membership check, otherwise GDD declarations like
    // `'ukgc'` or mixed-case `'Ukgc'` would silently bypass the gate.
    // Also widen UK aliases (UK / GBR / GB) so any common spelling fires.
    const c = model.compliance;
    const jurArr = Array.isArray(c) ? c
                 : Array.isArray(c?.jurisdictions) ? c.jurisdictions : [];
    const jurCodes = jurArr
      .map(j => typeof j === 'string' ? j : j?.code || j?.id)
      .filter(Boolean)
      .map(s => String(s).toUpperCase());
    const UK_ALIASES = new Set(['UKGC', 'UK', 'GBR', 'GB', 'UK-GREAT-BRITAIN']);
    if (jurCodes.some(code => UK_ALIASES.has(code))) {
      hard.push({ slug, rule: 'I8.2', msg: `bonusBuy.enabled=true but UKGC declared — UKGC banned bonus buy purchases` });
    }

    // I8.3 — UA/MX (some emerging markets) require additional disclosure if enabled
    for (const code of jurCodes) {
      if (code === 'NL-KSA' && bb.disclosureRequired !== true) {
        soft.push({ slug, rule: 'I8.3', msg: `bonusBuy with NL-KSA declared but disclosureRequired not set` });
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER J · Engine signature consistency
   * ═══════════════════════════════════════════════════════════════ */

  const reels = num(t.reels);
  const rows  = num(t.rows);

  // I9.1 — declared 5x3 lock_respin should still have 5 reels × 3 rows
  if (t.kind === 'lock_respin' && reels != null && rows != null) {
    if (reels !== REELS_FOR_5X3 || rows !== ROWS_FOR_5X3) {
      soft.push({ slug, rule: 'I9.1', msg: `lock_respin topology with reels=${reels}×rows=${rows} (industry standard 5×3)` });
    }
  }

  // I9.2 — 6×5 tumble is industry-canonical for "pay anywhere on 6×5 cluster/tumble"
  if (t.evaluation === 'pay_anywhere' && reels != null && rows != null) {
    if ((reels === REELS_FOR_6X5 && rows === ROWS_FOR_6X5) ||
        (reels === REELS_FOR_5X3 && rows === ROWS_FOR_5X3)) {
      // canonical sizes — OK
    } else {
      soft.push({ slug, rule: 'I9.2', msg: `pay_anywhere on ${reels}×${rows} (industry canonical: 5×3 or 6×5)` });
    }
  }

  // I9.3 — cluster eval should have reels >= rows-1 (square-ish grid)
  if (t.evaluation === 'cluster_pays' && reels != null && rows != null) {
    if (Math.abs(reels - rows) > 2) {
      soft.push({ slug, rule: 'I9.3', msg: `cluster_pays on ${reels}×${rows} — non-square grid unusual for cluster` });
    }
  }

  // I9.4 — variable_reel must have growable=true
  if (t.kind === 'variable_reel' && t.growable !== true) {
    soft.push({ slug, rule: 'I9.4', msg: `variable_reel topology without growable flag — engine won't expand` });
  }

  /* ═══════════════════════════════════════════════════════════════
   * LAYER K · UX presentation invariants
   * ═══════════════════════════════════════════════════════════════ */

  // I10.1 — spinTempo.totalMs in UX-acceptable range
  const spinMs = num(model.spinTempo?.totalMs);
  if (spinMs != null) {
    if (spinMs < SPIN_TEMPO_MIN_MS) {
      soft.push({ slug, rule: 'I10.1', msg: `spinTempo.totalMs=${spinMs} below UX floor ${SPIN_TEMPO_MIN_MS}` });
    }
    if (spinMs > SPIN_TEMPO_MAX_MS) {
      soft.push({ slug, rule: 'I10.1', msg: `spinTempo.totalMs=${spinMs} above UX ceiling ${SPIN_TEMPO_MAX_MS}` });
    }
  }

  // I10.2 — anticipation duration when declared
  const antMs = num(model.anticipation?.durationMs);
  if (antMs != null && antMs < ANTICIPATION_MIN_MS) {
    soft.push({ slug, rule: 'I10.2', msg: `anticipation.durationMs=${antMs} below ${ANTICIPATION_MIN_MS} — won't be perceptible` });
  }

  // I10.3 — bigWinTier requires winPresentation (ladder feeds presentation)
  if (model.bigWinTier?.enabled === true && model.winPresentation?.enabled === false) {
    hard.push({ slug, rule: 'I10.3', msg: `bigWinTier enabled but winPresentation disabled — ladder has no presentation pipeline` });
  }

  return { hard, soft };
}

/* ── Walker ────────────────────────────────────────────────────────── */

function listSlugs() {
  if (!existsSync(REAL_GAMES)) {
    console.error(`▸ ${REAL_GAMES} missing`);
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
  console.error('▸ no model.json files found');
  process.exit(2);
}

console.log(`V12 Deeper Industry Spec · auditing ${slugs.length} models...`);

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
  tool: 'tools/v12-deeper-industry-spec.mjs',
  gamesAudited: processed,
  hardCount: allHard.length,
  softCount: allSoft.length,
  hardByRule: groupByRule(allHard),
  softByRule: groupByRule(allSoft),
  hardSample: allHard.slice(0, 50),
  softSample: allSoft.slice(0, 50),
};

const reportFile = join(OUT_DIR, `v12-deeper-industry-${ts.replace(/[:.]/g, '-')}.json`);
writeFileSync(reportFile, JSON.stringify(summary, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`V12 Deeper Industry Spec · audited ${processed} games`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  HARD violations: ${allHard.length}`);
console.log(`  SOFT warnings  : ${allSoft.length}`);
if (allHard.length > 0) {
  console.log('  Hard-by-rule:', JSON.stringify(summary.hardByRule));
  console.log('  First HARD:');
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
console.log('✓ PASS — 0 deeper-industry violations');
process.exit(0);
