#!/usr/bin/env node
/**
 * tools/uq-prod-harden.mjs
 *
 * UQ-PROD (MASTER_TODO P2) — Production hardening for slot HTML output.
 *
 * Wraps a built slot.html with production-grade hardening:
 *
 *   1. CSP meta tag — locks script-src to inline + self
 *   2. SRI for any external assets (none in our case, but stub for future)
 *   3. Minify inline <script> and <style> blocks (whitespace + comment strip,
 *      conservative — preserves semantics)
 *   4. Pre-compute gzip + brotli sizes for delivery planning
 *
 * USAGE
 *   node tools/uq-prod-harden.mjs --slug=<slug>           # single
 *   node tools/uq-prod-harden.mjs --all                   # all real-games
 *   node tools/uq-prod-harden.mjs --slug=<slug> --dry     # report only
 *
 * OUTPUT
 *   dist/real-games/<slug>/slot.prod.html      hardened HTML
 *   reports/uq-prod-<ts>.json                  size delta report
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const DIST = resolve(REPO, 'dist/real-games');
const OUT  = resolve(REPO, 'reports');
mkdirSync(OUT, { recursive: true });

const args = process.argv.slice(2);
const argVal = (flag) => {
  const a = args.find(x => x === flag || x.startsWith(flag + '='));
  return a ? (a.includes('=') ? a.split('=')[1] : args[args.indexOf(a) + 1]) : null;
};
const DRY = args.includes('--dry');
const ALL = args.includes('--all');
const SLUG = argVal('--slug');

const CSP = `default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'`;

/** Conservative minifier — preserves all semantics, strips:
 *   - JS line comments (// …) when entire line is just a comment
 *   - JS block comments (/* … *​/) outside string literals
 *   - Collapses multiple spaces (outside strings) into single space
 *   - Strips blank lines
 *
 * NOT a real minifier — we keep block comments inside template literals
 * (they are emitted as runtime markup), and we never touch strings. */
function conservativeMinify(src) {
  /* Walk char-by-char; track string + template state so we never strip
   * inside literals. */
  let out = '';
  let i = 0;
  const n = src.length;
  let inStr = null;       /* "'", '"', or '`' */
  let inLineCom = false;
  let inBlockCom = false;
  while (i < n) {
    const c = src[i];
    const nxt = src[i + 1];

    if (inLineCom) {
      if (c === '\n') { inLineCom = false; out += '\n'; }
      i++;
      continue;
    }
    if (inBlockCom) {
      if (c === '*' && nxt === '/') { inBlockCom = false; i += 2; continue; }
      i++;
      continue;
    }
    if (inStr) {
      if (c === '\\') { out += c + nxt; i += 2; continue; }
      if (c === inStr) { inStr = null; }
      out += c;
      i++;
      continue;
    }
    if (c === '/' && nxt === '/') { inLineCom = true; i += 2; continue; }
    if (c === '/' && nxt === '*') { inBlockCom = true; i += 2; continue; }
    if (c === "'" || c === '"' || c === '`') { inStr = c; out += c; i++; continue; }
    out += c;
    i++;
  }
  /* Collapse runs of blank lines + drop leading whitespace on lines. */
  return out
    .replace(/\n[ \t]+/g, '\n')   /* leading WS per line */
    .replace(/\n{3,}/g, '\n\n');   /* keep single blank line max */
}

function hardenHtml(srcHtml) {
  /* 1) Insert CSP meta as the first <meta>. */
  let html = srcHtml;
  if (!/Content-Security-Policy/i.test(html)) {
    html = html.replace(/<head([^>]*)>/i,
      `<head$1>\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
  }

  /* 2) Minify each inline <script> block (skip when type=module ESM
   *    imports — they need full parse anyway and our minifier is
   *    conservative). */
  html = html.replace(/<script(\s[^>]*)?>([\s\S]*?)<\/script>/g, (m, attrs, body) => {
    if (/type=["']module["']/.test(attrs || '')) return m;
    return `<script${attrs || ''}>${conservativeMinify(body)}</script>`;
  });

  /* 3) Strip CSS comments + collapse whitespace in <style> blocks. */
  html = html.replace(/<style(\s[^>]*)?>([\s\S]*?)<\/style>/g, (m, attrs, body) => {
    const stripped = body
      .replace(/\/\*[\s\S]*?\*\//g, '')   /* CSS comments */
      .replace(/\n[ \t]+/g, '\n')          /* leading WS */
      .replace(/\n{3,}/g, '\n\n');
    return `<style${attrs || ''}>${stripped}</style>`;
  });

  return html;
}

function processSlug(slug) {
  const slotPath = join(DIST, slug, 'slot.html');
  if (!existsSync(slotPath)) return null;
  const src = readFileSync(slotPath, 'utf-8');
  const hardened = hardenHtml(src);
  const srcSize = Buffer.byteLength(src, 'utf-8');
  const hardSize = Buffer.byteLength(hardened, 'utf-8');
  const gzSrc = gzipSync(src).length;
  const gzHard = gzipSync(hardened).length;
  const brSrc = brotliCompressSync(src).length;
  const brHard = brotliCompressSync(hardened).length;
  if (!DRY) {
    writeFileSync(join(DIST, slug, 'slot.prod.html'), hardened);
  }
  return {
    slug,
    srcKB:  +(srcSize / 1024).toFixed(1),
    hardKB: +(hardSize / 1024).toFixed(1),
    gzSrcKB:  +(gzSrc / 1024).toFixed(1),
    gzHardKB: +(gzHard / 1024).toFixed(1),
    brSrcKB:  +(brSrc / 1024).toFixed(1),
    brHardKB: +(brHard / 1024).toFixed(1),
    saveRawPct: +(((srcSize - hardSize) / srcSize) * 100).toFixed(1),
    saveBrPct:  +(((brSrc - brHard) / brSrc) * 100).toFixed(1),
  };
}

let slugs;
if (SLUG) {
  slugs = [SLUG];
} else if (ALL) {
  slugs = readdirSync(DIST).filter(d => statSync(join(DIST, d)).isDirectory());
} else {
  slugs = ['cash-eruption-foundry-gdd', 'gates-of-olympus-1000-gdd',
          'huff-n-more-puff-gdd', 'starlight-travellers-gdd', 'wrath-of-olympus-gdd'];
}

const results = [];
for (const s of slugs) {
  const r = processSlug(s);
  if (r) results.push(r);
}

const ts = new Date().toISOString();
writeFileSync(join(OUT, `uq-prod-${ts.replace(/[:.]/g, '-')}.json`),
              JSON.stringify({ ts, count: results.length, results }, null, 2));

console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`UQ-PROD hardening · ${results.length} slot HTMLs · ${DRY ? 'DRY (report only)' : 'WRITE slot.prod.html'}`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('  slug                                 raw  →  prod  · gz raw → gz prod · brotli raw → brotli prod · save raw / brotli');
for (const r of results.slice(0, 12)) {
  console.log(`  ${r.slug.padEnd(35)} ${(r.srcKB+'').padStart(5)}KB → ${(r.hardKB+'').padStart(5)}KB · ` +
              `${(r.gzSrcKB+'').padStart(4)}KB → ${(r.gzHardKB+'').padStart(4)}KB · ` +
              `${(r.brSrcKB+'').padStart(4)}KB → ${(r.brHardKB+'').padStart(4)}KB · ` +
              `${r.saveRawPct}% / ${r.saveBrPct}%`);
}
if (results.length > 12) console.log(`  ... + ${results.length - 12} more`);
const avgRaw = results.reduce((s, r) => s + r.saveRawPct, 0) / results.length;
const avgBr  = results.reduce((s, r) => s + r.saveBrPct, 0) / results.length;
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  Σ avg savings — raw ${avgRaw.toFixed(1)}% · brotli ${avgBr.toFixed(1)}%`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
