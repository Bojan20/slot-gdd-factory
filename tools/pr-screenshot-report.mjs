#!/usr/bin/env node
/**
 * tools/pr-screenshot-report.mjs
 *
 * Wave T5 — Cortex-eyes auto-screenshot report for PR comments.
 *
 * Usage:
 *   node tools/pr-screenshot-report.mjs [--out reports/pr/] [--gdds ~/Desktop/GDD/]
 *
 * What it does:
 *   1. For each canonical GDD in the source dir:
 *      • Render slot HTML via repo's parser + buildSlotHTML.
 *      • Save HTML to <out>/<short>.html (so a CI runner can launch
 *        a headless browser against the file).
 *   2. Emits a markdown report `<out>/pr-comment.md` with:
 *      • A summary table (game name + parsed feature count + status).
 *      • A bullet list of preview links (relative file paths the CI
 *        upload step swaps to artifact URLs).
 *      • A 'how to view' footer block.
 *
 * Why no headless browser in this tool: the actual cortex-eyes
 * screenshot pipeline lives in tools/_cortex-eyes-* probes (Playwright
 * + 24 fixtures). This tool prepares the operator-facing PR-comment
 * skeleton: assemble HTML files + metadata + markdown table. Operator
 * runs the eyes pipeline separately, then this tool stitches the
 * results into a comment-friendly digest.
 *
 * Senior-grade:
 *   • Single responsibility, 0 deps, deterministic, vendor-neutral.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(__dirname, '..');

const C = {
  green:  s => `\x1b[32m${s}\x1b[0m`,
  red:    s => `\x1b[31m${s}\x1b[0m`,
  yellow: s => `\x1b[33m${s}\x1b[0m`,
  cyan:   s => `\x1b[36m${s}\x1b[0m`,
  bold:   s => `\x1b[1m${s}\x1b[0m`,
  dim:    s => `\x1b[2m${s}\x1b[0m`,
};

function _arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const OUT_DIR  = path.resolve(_arg('--out',  path.join(REPO, 'reports', 'pr')));
const GDDS_DIR = path.resolve(_arg('--gdds', path.join(os.homedir(), 'Desktop', 'GDD')));

function _shortName(file) {
  return path.basename(file)
    .replace(/\.(md|json|txt)$/i, '')
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .slice(0, 40);
}

async function main() {
  if (!existsSync(GDDS_DIR)) {
    console.error(C.red(`GDDs dir not found: ${GDDS_DIR}`));
    process.exit(1);
  }
  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  console.log(C.cyan(C.bold('\n📸 PR-screenshot report — slot-gdd-factory\n')));
  console.log(C.dim(`   GDDs:   ${path.relative(REPO, GDDS_DIR) || GDDS_DIR}`));
  console.log(C.dim(`   output: ${path.relative(REPO, OUT_DIR)}\n`));

  const parser = await import(pathToFileURL(path.join(REPO, 'src', 'parser.mjs')).href);
  const builder = await import(pathToFileURL(path.join(REPO, 'src', 'buildSlotHTML.mjs')).href);

  const rows = [];
  let scanDir = GDDS_DIR;
  let textGdds = readdirSync(scanDir).filter(f => /\.(md|json|txt)$/i.test(f) && !/ADB|AUDIO|SDD|SFX|HOWLER|MIX/i.test(f));
  if (textGdds.length === 0) {
    /* GDDs folder may contain only PDFs (canonical source) — fall back
     * to samples/ for build-pipeline coverage. */
    const samplesDir = path.join(REPO, 'samples');
    if (existsSync(samplesDir)) {
      console.log(C.yellow(`   no md/json/txt GDDs in ${scanDir} (PDFs only?). Falling back to samples/.`));
      scanDir = samplesDir;
    }
  }

  for (const f of readdirSync(scanDir).sort()) {
    if (!/\.(md|json|txt)$/i.test(f)) continue;
    if (/ADB|AUDIO|SDD|SFX|HOWLER|MIX/i.test(f)) continue;

    const short = _shortName(f);
    const full = path.join(scanDir, f);
    let model, html, status = 'ok', err = '';
    try {
      const src = readFileSync(full, 'utf8');
      model = parser.parseGDD(src);
      html  = builder.buildSlotHTML(model);
      writeFileSync(path.join(OUT_DIR, `${short}.html`), html);
    } catch (e) {
      status = 'fail';
      err = e.message.slice(0, 200);
    }

    const featureCount = (model && Array.isArray(model.features)) ? model.features.length : 0;
    const gameName = (model && model.name) || short;
    rows.push({ file: f, short, gameName, featureCount, status, err });

    const tag = status === 'ok' ? C.green('✓') : C.red('✗');
    console.log(`  ${tag} ${C.bold(gameName)} ${C.dim(`(${featureCount} feature${featureCount === 1 ? '' : 's'})`)}`);
    if (status === 'fail') console.log(`    ${C.red('error:')} ${err}`);
  }

  const headline = `## 🎰 Slot factory PR preview — ${rows.length} GDD${rows.length === 1 ? '' : 's'}`;
  const table = [
    '',
    '| # | Game | Features | Status | Preview |',
    '|:-:|:--|:-:|:-:|:--|',
    ...rows.map((r, i) => {
      const stEmoji = r.status === 'ok' ? '✅' : '❌';
      const link = r.status === 'ok' ? `[\`${r.short}.html\`](./${r.short}.html)` : 'n/a';
      return `| ${i + 1} | **${r.gameName}** | ${r.featureCount} | ${stEmoji} | ${link} |`;
    }),
    '',
  ].join('\n');

  const errs = rows.filter(r => r.status === 'fail');
  const errBlock = errs.length > 0 ? [
    '',
    '### ❌ Parse / build failures',
    '',
    ...errs.map(r => `- **${r.gameName}** (\`${r.file}\`): ${r.err}`),
    '',
  ].join('\n') : '';

  const footer = `
### How to view

1. Download the artifact zip from the GitHub Actions run.
2. Open each \`*.html\` in a browser, or run:
   \`\`\`bash
   npx serve reports/pr/
   \`\`\`
3. To regenerate locally:
   \`\`\`bash
   node tools/pr-screenshot-report.mjs --out reports/pr/
   \`\`\`

_Generated by \`tools/pr-screenshot-report.mjs\`._
`;

  const md = headline + '\n' + table + errBlock + footer;
  writeFileSync(path.join(OUT_DIR, 'pr-comment.md'), md);
  console.log(`\n  ${C.cyan('comment:')} ${path.relative(REPO, path.join(OUT_DIR, 'pr-comment.md'))}\n`);

  const failed = errs.length;
  if (failed > 0) {
    console.log(C.yellow(C.bold(`⚠ ${failed} GDD(s) failed to build — comment still emitted.\n`)));
  } else {
    console.log(C.green(C.bold(`✅ all ${rows.length} previews ready.\n`)));
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(C.red(C.bold(`\n❌ pr-screenshot-report failed: ${e.message}\n`)));
  console.error(e.stack);
  process.exit(1);
});
