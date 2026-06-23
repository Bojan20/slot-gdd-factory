#!/usr/bin/env node
/**
 * tools/compare-games.mjs
 *
 * N2 (2026-06-23) — Side-by-side comparison of two games.
 *
 * Loads one-pager data for slugA and slugB, computes a structural diff,
 * and emits a single ASCII/Markdown report so an operator can answer
 * "how do these two titles differ?" in one command.
 *
 * ## Why
 * The one-pager (N1) audits ONE title at a time. Operators frequently
 * need to compare two — e.g. "is Cash Eruption more volatile than
 * Starlight?" or "what kernels does Wrath share with Gates of Olympus?".
 * compare-games surfaces those answers from the same source of truth
 * (model.json + cross-game audit + per-game kernel coverage) without
 * any new probe runs.
 *
 * ## Architecture
 *   buildComparison(slugA, slugB) → pure async function:
 *       - Calls buildOnePager(slug) for both sides (no re-probing)
 *       - Computes per-dimension diff (basics/symbols/features/kernels/
 *         convergence/compliance)
 *       - Each row carries: label, A value, B value, match (true/false),
 *         optional note (e.g. "+0.3 volatility").
 *       - Feature diff: set arithmetic (sharedFeatures / onlyA / onlyB).
 *       - Kernel diff: shared / onlyA / onlyB sets by name from top-3.
 *
 *   renderAscii(report)    → terminal output (box-drawing per HARD RULE #3)
 *   renderMarkdown(report) → file output (regulator/operator deliverable)
 *
 * ## Lifecycle
 *   - Pure module — no I/O at import time.
 *   - CLI block at bottom guarded by `process.argv[1]` so importers
 *     don't trigger it.
 *
 * ## Performance
 *   - One-pager build is the bottleneck (~50-200ms per slug depending
 *     on coverage walk depth). Two parallel buildOnePager calls keep
 *     wall-clock under 500ms for the baseline pair.
 *   - Pure diff math is O(features + kernels) and dominated by string
 *     compares; sub-millisecond.
 *
 * ## Accessibility
 *   - Terminal output uses ASCII box-drawing only — no colour codes,
 *     no emoji that screen-readers misread.
 *   - Match / mismatch indicated by both glyph (= / ≠) AND words ("same"
 *     / "differ") for redundancy.
 *
 * ## USAGE
 *   node tools/compare-games.mjs --a <slugA> --b <slugB>
 *   node tools/compare-games.mjs --a <slugA> --b <slugB> --json
 *   node tools/compare-games.mjs --a <slugA> --b <slugB> --quiet
 *
 * ## OUTPUT
 *   reports/compare-games/<slugA>__vs__<slugB>.md
 *   reports/compare-games/<slugA>__vs__<slugB>.json
 *
 * ## EXIT
 *   0 — comparison generated (always, including all-equal pair)
 *   2 — invalid CLI args / one or both slugs missing model.json
 */

import { writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildOnePager } from './gdd-one-pager.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const OUT_DIR    = join(REPO, 'reports/compare-games');

/* ── Diff helpers ─────────────────────────────────────────────────────── */

const eq = (a, b) => {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) < 1e-9;
  }
  return false;
};

function setDiff(arrA, arrB) {
  const A = new Set(arrA || []);
  const B = new Set(arrB || []);
  const shared = [...A].filter(x => B.has(x)).sort();
  const onlyA  = [...A].filter(x => !B.has(x)).sort();
  const onlyB  = [...B].filter(x => !A.has(x)).sort();
  return { shared, onlyA, onlyB };
}

function row(label, vA, vB, fmt = (v) => (v == null ? '—' : String(v))) {
  const match = eq(vA, vB);
  return { label, a: fmt(vA), b: fmt(vB), match, raw: { a: vA, b: vB } };
}

/* ── Builder ──────────────────────────────────────────────────────────── */

async function buildComparison(slugA, slugB) {
  const [a, b] = await Promise.all([
    buildOnePager(slugA),
    buildOnePager(slugB),
  ]);
  if (!a.ok || !b.ok) {
    return {
      ok: false,
      slugA, slugB,
      error: [
        !a.ok ? `slugA (${slugA}): ${a.error}` : null,
        !b.ok ? `slugB (${slugB}): ${b.error}` : null,
      ].filter(Boolean).join(' · '),
    };
  }

  const basics = [
    row('Topology',         a.basics.topology,          b.basics.topology),
    row('Evaluation',       a.basics.evaluation,        b.basics.evaluation),
    row('Reels × Rows',
        `${a.basics.reels ?? '?'} × ${a.basics.rows ?? '?'}`,
        `${b.basics.reels ?? '?'} × ${b.basics.rows ?? '?'}`),
    row('Paylines',         a.basics.paylines,          b.basics.paylines),
    row('Declared RTP',     a.basics.declaredRTP,       b.basics.declaredRTP,
        v => (v == null ? '—' : `${v}%`)),
    row('Max win',          a.basics.maxWinX,           b.basics.maxWinX,
        v => (v == null ? '—' : `${v}× bet`)),
    row('Volatility idx',   a.basics.volatilityIdx,     b.basics.volatilityIdx,
        v => (v == null ? '—' : `${v}/10`)),
  ];

  const symbols = [
    row('High count',   a.symbols.highCount, b.symbols.highCount),
    row('Low count',    a.symbols.lowCount,  b.symbols.lowCount),
    row('Has scatter',  a.symbols.hasScatter, b.symbols.hasScatter,
        v => (v ? 'yes' : 'no')),
    row('Has wild',     a.symbols.hasWild, b.symbols.hasWild,
        v => (v ? 'yes' : 'no')),
  ];

  const features = setDiff(a.features, b.features);

  const kernelNamesA = (a.kernels.top3 || []).map(k => k.name);
  const kernelNamesB = (b.kernels.top3 || []).map(k => k.name);
  const kernelsTop = setDiff(kernelNamesA, kernelNamesB);
  const kernelsCounts = [
    row('Applicable', a.kernels.applicable, b.kernels.applicable),
    row('OK',         a.kernels.ok,         b.kernels.ok),
  ];

  const convergence = [
    row('Operator verdict', a.convergence.verdict,       b.convergence.verdict),
    row('Honest verdict',   a.convergence.honestVerdict, b.convergence.honestVerdict),
    row('ΔRTP (operator)',  a.convergence.rtpDelta,      b.convergence.rtpDelta,
        v => (v == null ? '—' : `${v}pp`)),
    row('ΔRTP (honest)',    a.convergence.rawRtpDelta,   b.convergence.rawRtpDelta,
        v => (v == null ? '—' : `${v}pp`)),
    row('Synthetic RTP',    a.convergence.isSynthetic,   b.convergence.isSynthetic,
        v => (v ? 'yes' : 'no')),
  ];

  const jurDiff = setDiff(a.compliance.jurisdictions, b.compliance.jurisdictions);
  const compliance = [
    row('Autoplay cap', a.compliance.autoplayCap, b.compliance.autoplayCap),
    row('Max win cap',  a.compliance.maxWinCap,   b.compliance.maxWinCap,
        v => (v == null ? '—' : `${v}× bet`)),
  ];

  /* Headline summary: count diffs across all non-set rows. */
  const allRows = [...basics, ...symbols, ...kernelsCounts, ...convergence, ...compliance];
  const totalRows = allRows.length;
  const differingRows = allRows.filter(r => !r.match).length;

  return {
    ok: true,
    slugA, slugB,
    generatedAt: new Date().toISOString(),
    summary: {
      totalRows,
      differingRows,
      identicalRows: totalRows - differingRows,
      sharedFeatures: features.shared.length,
      onlyAFeatures: features.onlyA.length,
      onlyBFeatures: features.onlyB.length,
      sharedTopKernels: kernelsTop.shared.length,
    },
    basics, symbols,
    features,
    kernels: {
      counts: kernelsCounts,
      top: kernelsTop,
      topA: a.kernels.top3 || [],
      topB: b.kernels.top3 || [],
    },
    convergence,
    compliance: {
      rows: compliance,
      jurisdictions: jurDiff,
    },
  };
}

/* ── ASCII renderer (terminal, box-drawing per HARD RULE #3) ──────────── */

function padCell(s, w) {
  const str = String(s ?? '');
  if (str.length >= w) return str.slice(0, w);
  return str + ' '.repeat(w - str.length);
}

function asciiTable(headers, rows, widths) {
  /* Top / mid / bot borders + header + data rows. */
  const top = '┌' + widths.map(w => '─'.repeat(w + 2)).join('┬') + '┐';
  const mid = '├' + widths.map(w => '─'.repeat(w + 2)).join('┼') + '┤';
  const bot = '└' + widths.map(w => '─'.repeat(w + 2)).join('┴') + '┘';
  const fmtRow = (cells) =>
    '│ ' + cells.map((c, i) => padCell(c, widths[i])).join(' │ ') + ' │';
  const out = [top, fmtRow(headers), mid];
  for (const r of rows) out.push(fmtRow(r));
  out.push(bot);
  return out.join('\n');
}

function asciiSection(title, headers, diffRows, widths) {
  const rows = diffRows.map(r => [
    r.label,
    r.a,
    r.b,
    r.match ? '=' : '≠',
  ]);
  const lines = [];
  lines.push(`▌ ${title}`);
  lines.push(asciiTable(headers, rows, widths));
  return lines.join('\n');
}

function renderAscii(report) {
  if (!report.ok) {
    return `compare-games — ERROR\n  ${report.slugA} vs ${report.slugB}\n  ${report.error}\n`;
  }
  const r = report;
  const W = [22, 26, 26, 6];
  const headers = ['Field', r.slugA.slice(0, 26), r.slugB.slice(0, 26), 'Same'];
  const out = [];
  out.push(`compare-games — ${r.slugA}  vs  ${r.slugB}`);
  out.push(`generated: ${r.generatedAt}`);
  out.push('');
  out.push(`Summary: ${r.summary.identicalRows}/${r.summary.totalRows} rows identical · ${r.summary.differingRows} differ · ${r.summary.sharedFeatures} shared features · ${r.summary.sharedTopKernels} shared top kernels`);
  out.push('');
  out.push(asciiSection('1. Basics',     headers, r.basics,    W));
  out.push('');
  out.push(asciiSection('2. Symbols',    headers, r.symbols,   W));
  out.push('');
  out.push('▌ 3. Features');
  out.push(`  shared (${r.features.shared.length}): ${r.features.shared.join(', ') || '—'}`);
  out.push(`  only A (${r.features.onlyA.length}): ${r.features.onlyA.join(', ') || '—'}`);
  out.push(`  only B (${r.features.onlyB.length}): ${r.features.onlyB.join(', ') || '—'}`);
  out.push('');
  out.push(asciiSection('4. Kernel coverage', headers, r.kernels.counts, W));
  out.push(`  top-3 shared: ${r.kernels.top.shared.join(', ') || '—'}`);
  out.push(`  top-3 only A: ${r.kernels.top.onlyA.join(', ') || '—'}`);
  out.push(`  top-3 only B: ${r.kernels.top.onlyB.join(', ') || '—'}`);
  out.push('');
  out.push(asciiSection('5. RTP convergence', headers, r.convergence, W));
  out.push('');
  out.push(asciiSection('6. Compliance',      headers, r.compliance.rows, W));
  out.push(`  jurisdictions shared: ${r.compliance.jurisdictions.shared.join(', ') || '—'}`);
  out.push(`  only A: ${r.compliance.jurisdictions.onlyA.join(', ') || '—'}`);
  out.push(`  only B: ${r.compliance.jurisdictions.onlyB.join(', ') || '—'}`);
  out.push('');
  return out.join('\n');
}

/* ── Markdown renderer (file output) ──────────────────────────────────── */

function mdTable(headers, rows, aligns) {
  const head = '| ' + headers.join(' | ') + ' |';
  const align = '|' + (aligns || headers.map(() => ':--')).map(a => a).join('|') + '|';
  const body = rows.map(r => '| ' + r.join(' | ') + ' |').join('\n');
  return [head, align, body].join('\n');
}

function mdDiffRows(diffRows) {
  return diffRows.map(r => [r.label, r.a, r.b, r.match ? '=' : '≠']);
}

function renderMarkdown(report) {
  if (!report.ok) {
    return [
      '# compare-games — ERROR',
      '',
      `Slug A: \`${report.slugA}\``,
      `Slug B: \`${report.slugB}\``,
      `Error: ${report.error}`,
      '',
    ].join('\n');
  }
  const r = report;
  const headers = ['Field', `\`${r.slugA}\``, `\`${r.slugB}\``, 'Same'];
  const aligns  = [':--', ':--', ':--', ':-:'];
  const lines = [];
  lines.push(`# Side-by-side: \`${r.slugA}\` vs \`${r.slugB}\``);
  lines.push('');
  lines.push(`> generated: ${r.generatedAt}`);
  lines.push(`> tool: tools/compare-games.mjs`);
  lines.push('');
  lines.push('## Summary');
  lines.push('');
  lines.push(`- **${r.summary.identicalRows}/${r.summary.totalRows}** rows identical · **${r.summary.differingRows}** differ`);
  lines.push(`- **${r.summary.sharedFeatures}** shared features (${r.summary.onlyAFeatures} only A · ${r.summary.onlyBFeatures} only B)`);
  lines.push(`- **${r.summary.sharedTopKernels}** shared top-3 kernels`);
  lines.push('');
  lines.push('## 1. Basics');
  lines.push('');
  lines.push(mdTable(headers, mdDiffRows(r.basics), aligns));
  lines.push('');
  lines.push('## 2. Symbols');
  lines.push('');
  lines.push(mdTable(headers, mdDiffRows(r.symbols), aligns));
  lines.push('');
  lines.push('## 3. Features');
  lines.push('');
  lines.push(`- shared (${r.features.shared.length}): ${r.features.shared.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push(`- only A (${r.features.onlyA.length}): ${r.features.onlyA.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push(`- only B (${r.features.onlyB.length}): ${r.features.onlyB.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push('');
  lines.push('## 4. Kernel coverage');
  lines.push('');
  lines.push(mdTable(headers, mdDiffRows(r.kernels.counts), aligns));
  lines.push('');
  lines.push(`- top-3 shared: ${r.kernels.top.shared.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push(`- top-3 only A: ${r.kernels.top.onlyA.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push(`- top-3 only B: ${r.kernels.top.onlyB.map(s => '`' + s + '`').join(', ') || '_none_'}`);
  lines.push('');
  lines.push('## 5. RTP convergence');
  lines.push('');
  lines.push(mdTable(headers, mdDiffRows(r.convergence), aligns));
  lines.push('');
  lines.push('## 6. Compliance');
  lines.push('');
  lines.push(mdTable(headers, mdDiffRows(r.compliance.rows), aligns));
  lines.push('');
  lines.push(`- jurisdictions shared: ${r.compliance.jurisdictions.shared.join(', ') || '_none_'}`);
  lines.push(`- only A: ${r.compliance.jurisdictions.onlyA.join(', ') || '_none_'}`);
  lines.push(`- only B: ${r.compliance.jurisdictions.onlyB.join(', ') || '_none_'}`);
  lines.push('');
  lines.push('---');
  lines.push(`_Generated by tools/compare-games.mjs. Source: reports/gdd-one-pagers/{${r.slugA},${r.slugB}}.json._`);
  lines.push('');
  return lines.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('compare-games.mjs')) {
  const args = process.argv.slice(2);
  const argVal = (flag) => {
    const i = args.findIndex(a => a === flag || a.startsWith(flag + '='));
    if (i === -1) return null;
    return args[i].includes('=') ? args[i].split('=')[1] : args[i + 1];
  };
  const slugA = argVal('--a') || argVal('--slug-a');
  const slugB = argVal('--b') || argVal('--slug-b');
  const jsonOnly = args.includes('--json');
  const quiet    = args.includes('--quiet');

  if (!slugA || !slugB) {
    console.error('Usage: --a <slugA> --b <slugB> [--json] [--quiet]');
    process.exit(2);
  }
  const report = await buildComparison(slugA, slugB);
  mkdirSync(OUT_DIR, { recursive: true });
  const stem = `${slugA}__vs__${slugB}`;
  const mdPath   = join(OUT_DIR, `${stem}.md`);
  const jsonPath = join(OUT_DIR, `${stem}.json`);
  writeFileSync(mdPath, renderMarkdown(report));
  writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  if (!report.ok) {
    console.error(`✗ ${stem}: ${report.error}`);
    process.exit(2);
  }
  if (!quiet) {
    if (jsonOnly) {
      console.log(JSON.stringify(report, null, 2));
    } else {
      console.log(renderAscii(report));
    }
  }
  console.log(`✓ ${stem}  →  ${mdPath}`);
  process.exit(0);
}

export { buildComparison, renderMarkdown, renderAscii, setDiff };
