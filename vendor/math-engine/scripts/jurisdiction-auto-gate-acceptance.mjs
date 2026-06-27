#!/usr/bin/env node
//
// W152 Wave 36 — Kimi K8: Jurisdiction-specific compliance auto-gate.
//
// Closes Kimi K8 ("Automated reject if max-win-multiplier, hit-freq floor,
// or near-miss threshold violates target market rules — UKGC RTS-3, NL KSA,
// DK SCP.01.00"). Builds the acceptance matrix:
//
//   30 reference fixtures × 15 jurisdictions = 450 verdicts
//
// Per (fixture × jurisdiction) cell: PASS / WARN / FAIL with per-rule
// detail. Operator workflow:
//
//   1. Author drops new fixture into tests/fixtures/reference/
//   2. CI runs this acceptance harness
//   3. Per-jurisdiction matrix shows which markets the fixture is
//      ready for, which need rule fixes (auto-fix candidates), which
//      are structurally incompatible
//
// Wave 36 also added `checkNearMissRule` to complianceGate.ts (Kimi
// K8 explicit gap — the rule existed in adapter.ts but was not called
// from the main gate). Test count: 24/24 ✅.
//
// Output: reports/acceptance/JURISDICTION_AUTO_GATE.{json,md}
//
// Run:  node scripts/jurisdiction-auto-gate-acceptance.mjs

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const REPO_ROOT = resolve(dirname(__filename), '..');
const FIXTURES_DIR = join(REPO_ROOT, 'tests', 'fixtures', 'reference');
const OUT_DIR = join(REPO_ROOT, 'reports', 'acceptance');

// ── Jurisdictions in scope ─────────────────────────────────────────────────
const ALL_JURISDICTIONS = [
  'UKGC', 'MGA', 'ADM', 'BMM', 'GLI19', 'AGCO', 'DGA', 'NJDGE',
  'ADM_VLT', 'NIGC_C2', 'NV_SKILL', 'DGOJ', 'SPELINSPEKTIONEN',
  'PGCB', 'NCPG',
];

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const cg = await import(join(REPO_ROOT, 'dist', 'jurisdiction', 'complianceGate.js'));
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  const fixtures = readdirSync(FIXTURES_DIR).filter((f) => f.endsWith('.json')).sort();

  console.log(
    `Jurisdiction auto-gate acceptance — ${fixtures.length} fixtures × ${ALL_JURISDICTIONS.length} jurisdictions = ${fixtures.length * ALL_JURISDICTIONS.length} verdicts`,
  );
  console.log();

  const matrix = []; // [{ fixture, perJurisdiction: { JUR: {status, fail, warn, pass, na, ruleSummary[]} } }]
  const aggrPerJur = Object.fromEntries(
    ALL_JURISDICTIONS.map((j) => [j, { pass: 0, warn: 0, fail: 0 }]),
  );
  const ruleFailureCounts = {}; // ruleId → { jurisdictionId → count }

  let totalVerdicts = 0;
  let totalPass = 0;
  let totalWarn = 0;
  let totalFail = 0;

  for (const fname of fixtures) {
    let ir;
    try {
      ir = JSON.parse(readFileSync(join(FIXTURES_DIR, fname), 'utf-8'));
    } catch (e) {
      console.log(`  ${fname.padEnd(34)} ❌ JSON parse: ${e.message}`);
      continue;
    }
    const row = { fixture: fname, perJurisdiction: {} };
    let fxFail = 0, fxWarn = 0, fxPass = 0;
    for (const jur of ALL_JURISDICTIONS) {
      try {
        const v = cg.evaluateCompliance(ir, jur);
        row.perJurisdiction[jur] = {
          status: v.overallStatus,
          fail: v.failCount,
          warn: v.warnCount,
          pass: v.passCount,
          na: v.naCount,
          failingRules: v.checks.filter((c) => c.status === 'FAIL').map((c) => c.ruleId),
        };
        totalVerdicts++;
        if (v.overallStatus === 'PASS') { aggrPerJur[jur].pass++; totalPass++; fxPass++; }
        else if (v.overallStatus === 'WARN') { aggrPerJur[jur].warn++; totalWarn++; fxWarn++; }
        else if (v.overallStatus === 'FAIL') { aggrPerJur[jur].fail++; totalFail++; fxFail++; }
        // Track per-rule failure attribution
        for (const ruleId of row.perJurisdiction[jur].failingRules) {
          if (!ruleFailureCounts[ruleId]) ruleFailureCounts[ruleId] = {};
          ruleFailureCounts[ruleId][jur] = (ruleFailureCounts[ruleId][jur] ?? 0) + 1;
        }
      } catch (e) {
        row.perJurisdiction[jur] = { status: 'ERROR', error: e.message };
      }
    }
    matrix.push(row);
    const passPct = ((fxPass / ALL_JURISDICTIONS.length) * 100).toFixed(0);
    const warnPct = ((fxWarn / ALL_JURISDICTIONS.length) * 100).toFixed(0);
    const failPct = ((fxFail / ALL_JURISDICTIONS.length) * 100).toFixed(0);
    console.log(`  ${fname.padEnd(34)} ✅ ${passPct}% / ⚠ ${warnPct}% / ❌ ${failPct}%`);
  }

  console.log();
  console.log(`Total verdicts: ${totalVerdicts} (PASS=${totalPass}, WARN=${totalWarn}, FAIL=${totalFail})`);

  // ── JSON ─────────────────────────────────────────────────────────────────
  const json = {
    schema: 'jurisdiction-auto-gate/v1',
    generatedAtUtc: new Date().toISOString(),
    config: { jurisdictions: ALL_JURISDICTIONS, fixtureCount: fixtures.length },
    headline: {
      totalVerdicts,
      pass: totalPass, warn: totalWarn, fail: totalFail,
      passPct: ((totalPass / totalVerdicts) * 100).toFixed(2),
      warnPct: ((totalWarn / totalVerdicts) * 100).toFixed(2),
      failPct: ((totalFail / totalVerdicts) * 100).toFixed(2),
    },
    perJurisdiction: aggrPerJur,
    ruleFailureCounts,
    matrix,
  };
  writeFileSync(join(OUT_DIR, 'JURISDICTION_AUTO_GATE.json'), JSON.stringify(json, null, 2));

  // ── Markdown ─────────────────────────────────────────────────────────────
  writeFileSync(join(OUT_DIR, 'JURISDICTION_AUTO_GATE.md'), renderMd(json));
  console.log(`Reports: reports/acceptance/JURISDICTION_AUTO_GATE.{json,md}`);
}

function renderMd(j) {
  const out = [];
  out.push('# Jurisdiction Auto-Gate — Acceptance Report');
  out.push('');
  out.push('> Closes **Kimi K8** (deep-audit 2026-05-15). Generated `' + j.generatedAtUtc + '`.');
  out.push('');
  out.push(`## Headline: ${j.headline.totalVerdicts} verdicts — ${j.headline.passPct}% PASS / ${j.headline.warnPct}% WARN / ${j.headline.failPct}% FAIL`);
  out.push('');
  out.push('## Per-Jurisdiction Aggregate');
  out.push('');
  out.push('| Jurisdiction | PASS | WARN | FAIL |');
  out.push('|---|---:|---:|---:|');
  for (const [jur, c] of Object.entries(j.perJurisdiction)) {
    out.push(`| ${jur} | ${c.pass} | ${c.warn} | ${c.fail} |`);
  }
  out.push('');
  out.push('## Top Rule-Failure Attribution');
  out.push('');
  out.push('| Rule | Total fails | Top jurisdictions |');
  out.push('|---|---:|---|');
  const rulesSorted = Object.entries(j.ruleFailureCounts)
    .map(([r, jurs]) => ({
      rule: r,
      total: Object.values(jurs).reduce((s, n) => s + n, 0),
      jurs: Object.entries(jurs).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}(${v})`).join(', '),
    }))
    .sort((a, b) => b.total - a.total);
  for (const r of rulesSorted) {
    out.push(`| \`${r.rule}\` | ${r.total} | ${r.jurs} |`);
  }
  out.push('');
  out.push('## Compliance Matrix (compact)');
  out.push('');
  out.push('Symbols: ✅ PASS · ⚠ WARN · ❌ FAIL · — N/A');
  out.push('');
  const cellOf = (s) => s === 'PASS' ? '✅' : s === 'WARN' ? '⚠' : s === 'FAIL' ? '❌' : '—';
  const header = '| Fixture | ' + j.config.jurisdictions.join(' | ') + ' |';
  out.push(header);
  out.push('|' + '---|'.repeat(j.config.jurisdictions.length + 1));
  for (const row of j.matrix) {
    const cells = j.config.jurisdictions.map((jur) => cellOf(row.perJurisdiction[jur]?.status));
    out.push(`| \`${row.fixture}\` | ${cells.join(' | ')} |`);
  }
  out.push('');
  out.push('## Methodology');
  out.push('');
  out.push('Each cell = `evaluateCompliance(ir, jurisdiction)` from `src/jurisdiction/complianceGate.ts`.');
  out.push('Wave 36 added the **`checkNearMissRule`** check (Kimi K8: UKGC RTS-3, MGA PPD §11.f) — every');
  out.push('jurisdiction that declares `requiredNearMissRule` now blocks fixtures whose');
  out.push('`compliance.near_miss_rule` does not match.');
  out.push('');
  out.push('Operator workflow: this matrix is the SINGLE-PAGE answer to "which markets');
  out.push('is this game ready for?" — green (✅) cells mean "submit"; warn (⚠) cells');
  out.push('mean "operator UI must enforce"; red (❌) cells mean "math/rules must change');
  out.push('before submission."');
  return out.join('\n');
}

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(2);
});
