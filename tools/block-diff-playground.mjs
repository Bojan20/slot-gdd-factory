#!/usr/bin/env node
/**
 * tools/block-diff-playground.mjs
 *
 * Wave T1 — Block playground pre/post diff visualization.
 *
 * Usage:
 *   node tools/block-diff-playground.mjs --block <name> --before <gdd-before> --after <gdd-after> [--out dist/diff/]
 *
 * What it does:
 *   1. Parses both GDDs.
 *   2. Builds slot HTML for each.
 *   3. Extracts the target block's emitted CSS + Markup + Runtime
 *      sub-string from each HTML (delimited by `── <blockName> BLOCK`
 *      comment marker convention used across emitted CSS/JS).
 *   4. Computes a unified diff (line-level) per emit type.
 *   5. Emits `dist/diff/<block>-<timestamp>.html` rendering both
 *      previews side-by-side + a diff pane listing additions /
 *      deletions colorised in the operator's browser.
 *
 * Use case: when iterating on a block's GDD config, see exactly what
 * changes in the emitted output before vs after the edit. Faster than
 * rendering the full slot + diff'ing the entire HTML output.
 *
 * Senior-grade:
 *   • Single responsibility, 0 deps, deterministic, vendor-neutral.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function _arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

/* Naive line-level diff (LCS too heavy without deps). Output is a list of
 *   { kind: 'eq' | 'add' | 'del', text }
 * suitable for HTML rendering. Reasonable on the < 2000 line per-block
 * emit range we operate in. */
function _lineDiff(a, b) {
  const linesA = a.split('\n');
  const linesB = b.split('\n');
  const setA = new Set(linesA);
  const setB = new Set(linesB);
  const out = [];
  /* Walk both arrays — emit removals from A first, additions from B,
   * then convergent lines. */
  let i = 0, j = 0;
  while (i < linesA.length || j < linesB.length) {
    if (i < linesA.length && j < linesB.length && linesA[i] === linesB[j]) {
      out.push({ kind: 'eq', text: linesA[i] });
      i++; j++; continue;
    }
    if (i < linesA.length && !setB.has(linesA[i])) {
      out.push({ kind: 'del', text: linesA[i] });
      i++; continue;
    }
    if (j < linesB.length && !setA.has(linesB[j])) {
      out.push({ kind: 'add', text: linesB[j] });
      j++; continue;
    }
    /* Out-of-order match — skip one from A and one from B to recover. */
    if (i < linesA.length) { out.push({ kind: 'del', text: linesA[i] }); i++; }
    if (j < linesB.length) { out.push({ kind: 'add', text: linesB[j] }); j++; }
  }
  return out;
}

function _extractBlockEmit(html, blockName) {
  /* Convention: each emit (CSS / runtime) opens with comment
   *   /* ── <blockName> BLOCK
   * (or for markup, with HTML comment). We grep for the open marker and
   * walk to the closing fence (next ── BLOCK opener or the next major
   * tag). For robustness, just slice 6000 chars after each match.
   * Multi-block matches are concatenated. */
  const opens = [];
  const re = new RegExp(`(?:/\\* ── ${blockName} BLOCK|<!-- ${blockName} BLOCK)`, 'g');
  let m;
  while ((m = re.exec(html)) !== null) opens.push(m.index);
  if (opens.length === 0) return '';
  const slices = opens.map(idx => html.slice(idx, idx + 4000));
  return slices.join('\n\n/* ── (next emit) ── */\n\n');
}

function _diffHtml(blockName, diffMap) {
  const sections = Object.entries(diffMap).map(([label, lines]) => {
    if (lines.length === 0) return '';
    const adds = lines.filter(l => l.kind === 'add').length;
    const dels = lines.filter(l => l.kind === 'del').length;
    const eqs  = lines.filter(l => l.kind === 'eq').length;
    const body = lines.slice(0, 800).map(l => {
      const cls = l.kind;
      const prefix = l.kind === 'add' ? '+ ' : l.kind === 'del' ? '- ' : '  ';
      const esc = String(l.text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="diff-${cls}">${prefix}${esc}</span>`;
    }).join('\n');
    return `<section>
  <h2>${label}</h2>
  <div class="counts"><span class="add">+${adds}</span> <span class="del">-${dels}</span> <span class="eq">=${eqs}</span></div>
  <pre>${body}</pre>
</section>`;
  }).join('\n');
  return `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="UTF-8">
<title>Block diff · ${blockName}</title>
<style>
  html, body { margin: 0; background: #0b0f16; color: #f2f2f2; font-family: ui-monospace, monospace; }
  header { padding: 14px 20px; background: rgba(201, 162, 39, 0.12); border-bottom: 1px solid rgba(255,255,255,0.08); }
  header h1 { margin: 0; font-size: 16px; }
  header .meta { opacity: 0.6; font-size: 13px; }
  main { padding: 12px 20px; }
  section { margin-bottom: 24px; }
  section h2 { font-size: 14px; opacity: 0.8; margin-bottom: 4px; }
  .counts { font-size: 12px; margin-bottom: 8px; }
  .counts .add { color: #6cf18b; }
  .counts .del { color: #f56565; }
  .counts .eq  { color: #888; }
  pre { background: #05070c; border: 1px solid rgba(255,255,255,0.06); border-radius: 6px;
        padding: 10px 14px; font-size: 12px; line-height: 1.4; overflow-x: auto;
        white-space: pre; max-height: 600px; overflow-y: auto; }
  .diff-add { color: #6cf18b; display: block; background: rgba(108, 241, 139, 0.06); }
  .diff-del { color: #f56565; display: block; background: rgba(245, 101, 101, 0.06); }
  .diff-eq  { color: #888;   display: block; }
</style></head><body>
<header>
  <h1>Block diff: <strong>${blockName}</strong></h1>
  <div class="meta">Generated by tools/block-diff-playground.mjs</div>
</header>
<main>${sections}</main>
</body></html>`;
}

async function main() {
  const blockName = _arg('--block');
  const before    = _arg('--before');
  const after     = _arg('--after');
  const outIdx    = process.argv.indexOf('--out');
  const outDir    = outIdx >= 0 ? path.resolve(process.argv[outIdx + 1]) : path.join(REPO, 'dist', 'diff');

  if (!blockName || !before || !after) {
    console.error(C.red('usage: --block <name> --before <gdd> --after <gdd> [--out dir]'));
    process.exit(2);
  }

  console.log(C.cyan(C.bold('\n🔬 Block diff playground — slot-gdd-factory\n')));
  console.log(C.dim(`   block:  ${blockName}`));
  console.log(C.dim(`   before: ${path.relative(REPO, before) || before}`));
  console.log(C.dim(`   after:  ${path.relative(REPO, after)  || after}\n`));

  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

  const parser = await import(pathToFileURL(path.join(REPO, 'src', 'parser.mjs')).href);
  const builder = await import(pathToFileURL(path.join(REPO, 'src', 'buildSlotHTML.mjs')).href);

  const beforeHTML = builder.buildSlotHTML(parser.parseGDD(readFileSync(before, 'utf8')));
  const afterHTML  = builder.buildSlotHTML(parser.parseGDD(readFileSync(after,  'utf8')));

  const beforeEmit = _extractBlockEmit(beforeHTML, blockName);
  const afterEmit  = _extractBlockEmit(afterHTML,  blockName);

  if (!beforeEmit && !afterEmit) {
    console.log(C.red(`\nblock "${blockName}" not detected in either build — check name or enable the block.\n`));
    process.exit(1);
  }

  const diffMap = {
    [`${blockName} (combined emit window)`]: _lineDiff(beforeEmit, afterEmit),
  };

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = path.join(outDir, `${blockName}-${ts}.html`);
  writeFileSync(outFile, _diffHtml(blockName, diffMap));

  console.log(`  ${C.green('✓')} diff written: ${C.bold(path.relative(REPO, outFile))}`);
  const total = Object.values(diffMap)[0];
  const adds = total.filter(l => l.kind === 'add').length;
  const dels = total.filter(l => l.kind === 'del').length;
  console.log(`  ${C.dim('changes:')} ${C.green('+' + adds)} ${C.red('-' + dels)}\n`);
  console.log(C.green(C.bold('✅ block diff ready.\n')));
}

main().catch((e) => {
  console.error(C.red(C.bold(`\n❌ block-diff-playground failed: ${e.message}\n`)));
  process.exit(1);
});
