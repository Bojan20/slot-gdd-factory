/**
 * tests/blocks/_genBlockDocs.test.mjs
 * ALT-E — Validates tools/gen-block-docs.mjs output.
 *
 * Asserts that the generated docs are present, parse correctly,
 * cover every block, and contain zero vendor mentions.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(new URL('../..', import.meta.url).pathname);
const MANIFEST = path.join(ROOT, 'blocks/_manifest.json');
const MD       = path.join(ROOT, 'docs/BLOCK_MANIFEST.md');
const HTML     = path.join(ROOT, 'docs/blocks/index.html');

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log('  ✓ ' + name); }
  else    { fail++; console.log('  ✗ ' + name + (info ? ' (' + info + ')' : '')); }
}

console.log('\n=== gen-block-docs (ALT-E) ===');

/* Run the generator afresh */
const out = spawnSync(process.execPath, ['tools/gen-block-docs.mjs'], {
  cwd: ROOT, encoding: 'utf8',
});
t('generator exits 0', out.status === 0, out.stderr.slice(0, 200));

const manifest = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
const totalBlocks = manifest.blocks.length;
t('manifest has ≥ 100 blocks', totalBlocks >= 100, `got ${totalBlocks}`);

const md = await fs.readFile(MD, 'utf8');
t('BLOCK_MANIFEST.md exists', md.length > 1000);
t('MD has title heading', md.startsWith('# Block Manifest'));
t('MD lists every category', md.includes('## audit') && md.includes('## engine') &&
                              md.includes('## feature') && md.includes('## wild'));
t('MD declares total block count', md.includes(String(totalBlocks)));

const html = await fs.readFile(HTML, 'utf8');
t('index.html exists', html.length > 1000);
t('HTML has search input', html.includes('id="filter"'));
t('HTML has nav region', html.includes('id="nav"'));
t('HTML has detail region', html.includes('id="detail"'));
t('HTML embeds BLOCKS data', html.includes('const BLOCKS ='));
t('HTML has aria-live', html.includes('aria-live="polite"'));

/* Vendor-neutral check on emitted artifacts */
const VENDOR_RE = /\b(IGT|Pragmatic|Cash[- ]Eruption|Wolf[- ]Run|Cleopatra|Buffalo|Megaways|NetEnt|Microgaming|Scientific Games)\b/i;
t('MD is vendor-neutral', !VENDOR_RE.test(md));
t('HTML is vendor-neutral', !VENDOR_RE.test(html));

/* Per-block coverage — every block name must appear in MD and HTML */
let missingFromMd = 0, missingFromHtml = 0;
for (const b of manifest.blocks) {
  if (!md.includes('`' + b.name + '`')) missingFromMd++;
  if (!html.includes('"name":"' + b.name + '"')) missingFromHtml++;
}
t('every block appears in MD', missingFromMd === 0, `missing ${missingFromMd}`);
t('every block appears in HTML', missingFromHtml === 0, `missing ${missingFromHtml}`);

/* Generator self-checks: total events not zero */
t('MD references emit count column', md.includes('Emits'));
t('MD references subscribe column', md.includes('Subscribes'));

console.log('\nResult: ' + pass + ' pass / ' + fail + ' fail');
if (fail > 0) process.exit(1);
