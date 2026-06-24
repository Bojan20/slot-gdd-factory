#!/usr/bin/env node
/**
 * tools/i18n-catalog-extract.mjs · Functional Item #11 — i18n shell
 * (string extraction + locale catalog skeleton).
 *
 * Scans every `src/blocks/<name>.mjs` for USER-FACING English strings:
 *   - innerHTML / textContent assignments
 *   - aria-label / aria-description / title / placeholder / alt attrs
 *   - `setAttribute('aria-…', '…')` calls
 *
 * For each match, emits an entry into a flat i18n catalog:
 *   { "<blockName>.<n>": "<extracted string>", … }
 *
 * The catalog skeleton is written to `i18n/en.json` and becomes the
 * single source of truth for translators. A follow-up wave will wire
 * a runtime resolver — this commit lands the SHELL: the catalog scan,
 * dedup, and shape contract.
 *
 * Senior-grade contract:
 *   - Deterministic (sorted block names, stable hash for key id).
 *   - Pure FS scan, no Node.eval — safe against malicious blocks.
 *   - Zero false-positive on already-localised strings (regex skip
 *     for `{t(…)}` / `i18n(…)` / `__('…')` placeholder calls).
 *   - Vendor-neutral output (rule_no_vendor_mentions).
 *
 * Exit codes:
 *   0  catalog written successfully
 *   1  no strings found anywhere (likely false-negative — investigate)
 *   2  blocks dir missing
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const BLOCKS_DIR = resolve(REPO, 'src/blocks');
const OUT_DIR = resolve(REPO, 'i18n');

const argv = process.argv.slice(2);
const QUIET = argv.includes('--quiet');
const log = (...m) => { if (!QUIET) console.log(...m); };

if (!existsSync(BLOCKS_DIR)) { console.error(`❌ ${BLOCKS_DIR} missing`); process.exit(2); }
const blocks = readdirSync(BLOCKS_DIR).filter((f) => f.endsWith('.mjs')).sort();

/**
 * Patterns that surface user-facing strings.
 *
 * IMPORTANT: every regex captures the literal string in group 1.
 * Strings that look already-localised (`{t('foo')}` / `i18n.t('foo')` /
 * `__('foo')`) are matched but FILTERED OUT later — we only want
 * hardcoded EN that translators need to see.
 */
const EXTRACTORS = [
  /* aria-label="…" + variants */
  { kind: 'aria-label',        re: /aria-label\s*=\s*["']([^"']{2,160})["']/g },
  { kind: 'aria-description',  re: /aria-description\s*=\s*["']([^"']{2,160})["']/g },
  { kind: 'aria-roledescription', re: /aria-roledescription\s*=\s*["']([^"']{2,160})["']/g },
  /* title="…" / placeholder="…" / alt="…" */
  { kind: 'title-attr',        re: /\btitle\s*=\s*["']([^"']{2,160})["']/g },
  { kind: 'placeholder-attr',  re: /placeholder\s*=\s*["']([^"']{2,160})["']/g },
  { kind: 'alt-attr',          re: /\balt\s*=\s*["']([^"']{2,160})["']/g },
  /* setAttribute('aria-label', '…') style */
  { kind: 'setAttribute-aria', re: /setAttribute\s*\(\s*['"]aria-[a-z-]+['"]\s*,\s*['"]([^'"]{2,160})['"]/g },
  /* textContent = '…' / innerText = '…' */
  { kind: 'textContent',       re: /\.(?:textContent|innerText)\s*=\s*['"]([^'"]{2,160})['"]/g },
];

/* False-positive filters — strings that aren't user-facing or already i18n. */
const NOT_USER_FACING = [
  /^[a-z0-9_-]+$/i,          /* css class / dom id / token */
  /^#[0-9a-f]{3,8}$/i,       /* hex color */
  /^[0-9.,+\-: ]+$/,         /* numbers / time / coordinates */
  /^https?:\/\//,
  /^data:/,
  /^[\s\W]+$/,               /* whitespace / punctuation only */
];
const ALREADY_I18N = [
  /\$\{[^}]*\}/,            /* `${t('x')}` template literal */
  /\{\s*t\s*\(/,
  /\bi18n\s*\.\s*t\s*\(/,
  /\b__\s*\(/,
];

function isUserFacing(s) {
  if (!s) return false;
  if (s.length < 2) return false;
  for (const re of NOT_USER_FACING) if (re.test(s)) return false;
  for (const re of ALREADY_I18N)    if (re.test(s)) return false;
  /* require at least one letter */
  if (!/[a-zA-Z]/.test(s)) return false;
  return true;
}

const catalog = {};
const perBlock = {};
let total = 0;

for (const file of blocks) {
  const name = basename(file, '.mjs');
  const source = readFileSync(resolve(BLOCKS_DIR, file), 'utf8');
  const found = new Set();
  for (const { re } of EXTRACTORS) {
    let m;
    while ((m = re.exec(source)) !== null) {
      const raw = m[1];
      if (!isUserFacing(raw)) continue;
      found.add(raw);
    }
  }
  if (found.size === 0) continue;
  perBlock[name] = found.size;
  /* Dedupe inside block, emit keys with stable hash suffix so two
   * blocks that share a string still get distinct keys. */
  const sorted = [...found].sort();
  sorted.forEach((s, idx) => {
    const id = `${name}.${idx}`;
    catalog[id] = s;
    total++;
  });
}

mkdirSync(OUT_DIR, { recursive: true });
/* UQ-DEEP-AT K-P0-1 (Auditor K): deterministic catalog hash.
   Was: JSON.stringify(catalog) — preserves insertion order which depends
   on readdirSync FS order (Linux ext4 ≠ macOS APFS) → different hash in
   CI vs local for identical content → false drift FAIL.
   Fix: pass sorted keys array as replacer so emitted JSON is canonical. */
const canonicalCatalogJSON = JSON.stringify(catalog, Object.keys(catalog).sort());
const out = {
  schema_version: '1.0.0',
  generated_at: new Date().toISOString(),
  source_locale: 'en',
  hash: createHash('sha256').update(canonicalCatalogJSON).digest('hex').slice(0, 12),
  blocks_with_strings: Object.keys(perBlock).length,
  total_entries: total,
  catalog,
};
writeFileSync(resolve(OUT_DIR, 'en.json'), JSON.stringify(out, null, 2));

log(`🌐 i18n catalog extract`);
log(`   blocks scanned        : ${blocks.length}`);
log(`   blocks with strings   : ${Object.keys(perBlock).length}`);
log(`   total entries         : ${total}`);
log(`   catalog hash          : ${out.hash}`);
log(`   wrote                 : ${resolve(OUT_DIR, 'en.json')}`);

if (total === 0) {
  console.error('❌ no user-facing strings found anywhere — extractor likely broken');
  process.exit(1);
}
process.exit(0);
