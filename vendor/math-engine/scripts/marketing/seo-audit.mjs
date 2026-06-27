#!/usr/bin/env node
/*
 * W215 Faza 800.2 Agent C — SEO audit for the public marketing site.
 *
 * Walks every .html file under web/marketing/ and verifies the
 * canonical SEO surface area:
 *   * <title> length 30-60 chars
 *   * <meta name=description> content length 120-160 chars
 *   * <link rel=canonical> present
 *   * <meta property=og:image> present
 *   * exactly one <h1>
 *   * <img> tags carry alt attribute
 *   * <script type=application/ld+json> body is valid JSON
 *   * relative href targets resolve to existing files
 *   * sitemap.xml lists every audited page
 *
 * Output:
 *   reports/marketing/SEO_AUDIT.md      Markdown table per page
 *   stdout                              Summary
 *   --strict                            non-zero exit on any fail
 *   --root <dir>                        override the marketing root
 *
 * Importable: the validator functions are exported so the test suite
 * can verify them directly without filesystem I/O.
 */

import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');

export function listHtmlFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name.startsWith('.')) continue;
      const p = join(dir, name);
      const s = statSync(p);
      if (s.isDirectory()) walk(p);
      else if (s.isFile() && p.endsWith('.html')) out.push(p);
    }
  };
  walk(root);
  return out.filter((p) => !isComponentTemplate(p)).sort();
}

/** Treat anything under web/marketing/components/ as a partial, not a page. */
export function isComponentTemplate(absPath) {
  return absPath.includes(`${'/'}components${'/'}`) || absPath.endsWith('.partial.html');
}

export function extractTitle(html) {
  const m = html.match(/<title>([^<]*)<\/title>/i);
  return m ? m[1].trim() : null;
}

export function extractMetaDescription(html) {
  const m = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']*)["']/i);
  return m ? m[1] : null;
}

export function extractCanonical(html) {
  return /<link\s+rel=["']canonical["']/i.test(html);
}

export function extractOgImage(html) {
  return /<meta\s+property=["']og:image["']/i.test(html);
}

export function countH1(html) {
  const m = html.match(/<h1[\s>]/gi);
  return m ? m.length : 0;
}

export function imgsWithoutAlt(html) {
  const tags = html.match(/<img\b[^>]*>/gi) ?? [];
  return tags.filter((t) => !/\balt\s*=/.test(t)).length;
}

export function jsonLdValidity(html) {
  const re = /<script\s+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  const issues = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    try { JSON.parse(m[1]); } catch (e) {
      issues.push(e.message);
    }
  }
  return issues;
}

export function extractRelativeLinks(html) {
  const out = new Set();
  const re = /\b(?:href|src)=["']([^"'#?]+)["']/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const url = m[1];
    if (url.startsWith('http') || url.startsWith('//') || url.startsWith('mailto:') || url.startsWith('tel:')) continue;
    out.add(url);
  }
  return Array.from(out);
}

export function validatePage(rel, html, sitemap, marketingRoot, pageFile) {
  const checks = [];
  const title = extractTitle(html);
  checks.push({
    name: 'title 30-60 chars',
    pass: title != null && title.length >= 30 && title.length <= 60,
    detail: title == null ? 'missing' : `${title.length} chars`,
  });
  const desc = extractMetaDescription(html);
  checks.push({
    name: 'meta description 120-160 chars',
    pass: desc != null && desc.length >= 120 && desc.length <= 160,
    detail: desc == null ? 'missing' : `${desc.length} chars`,
  });
  checks.push({ name: 'canonical link', pass: extractCanonical(html), detail: '' });
  checks.push({ name: 'og:image meta',  pass: extractOgImage(html),  detail: '' });
  const h1Count = countH1(html);
  checks.push({ name: 'exactly one h1', pass: h1Count === 1, detail: `${h1Count} h1` });
  const imgsNoAlt = imgsWithoutAlt(html);
  checks.push({ name: 'all img have alt', pass: imgsNoAlt === 0, detail: imgsNoAlt > 0 ? `${imgsNoAlt} missing` : '' });
  const ldIssues = jsonLdValidity(html);
  checks.push({ name: 'json-ld parseable', pass: ldIssues.length === 0, detail: ldIssues.join('; ') });

  const broken = [];
  for (const link of extractRelativeLinks(html)) {
    const abs = resolve(dirname(pageFile), link);
    if (!existsSync(abs)) broken.push(link);
  }
  checks.push({
    name: 'relative links resolve',
    pass: broken.length === 0,
    detail: broken.length > 0 ? `broken: ${broken.slice(0, 4).join(', ')}${broken.length > 4 ? '…' : ''}` : '',
  });

  const sitemapPath = '/' + relative(marketingRoot, pageFile).replaceAll('\\', '/');
  const sitemapHasPage = sitemap == null
    ? null
    : sitemap.includes(sitemapPath) || (sitemapPath === '/index.html' && sitemap.includes('https://slot-math-engine.example/'));
  if (sitemap != null) {
    checks.push({
      name: 'listed in sitemap.xml',
      pass: sitemapHasPage === true || isInternalOnly(rel),
      detail: sitemapHasPage === true ? '' : (isInternalOnly(rel) ? 'internal-only (exempt)' : 'missing'),
    });
  }

  return { page: rel, checks, ok: checks.every((c) => c.pass) };
}

export function isInternalOnly(rel) {
  // Pages marked noindex (analytics dashboard) are exempt from sitemap requirement.
  return rel.includes('analytics/analytics-dashboard.html');
}

export function summarise(results) {
  const total = results.length;
  const passed = results.filter((r) => r.ok).length;
  const failed = total - passed;
  return { total, passed, failed };
}

export function toMarkdown(results) {
  const lines = ['# SEO Audit Report', '', `Pages audited: ${results.length}`, ''];
  for (const r of results) {
    lines.push(`## ${r.page}  ${r.ok ? '✅' : '❌'}`);
    lines.push('');
    lines.push('| Check | Result | Detail |');
    lines.push('| --- | --- | --- |');
    for (const c of r.checks) {
      lines.push(`| ${c.name} | ${c.pass ? 'pass' : 'FAIL'} | ${c.detail || '—'} |`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

function loadSitemap(marketingRoot) {
  const sm = join(marketingRoot, 'sitemap.xml');
  if (!existsSync(sm)) return null;
  return readFileSync(sm, 'utf-8');
}

function main(argv) {
  const strict = argv.includes('--strict');
  const rootIdx = argv.indexOf('--root');
  const marketingRoot = rootIdx >= 0 ? resolve(argv[rootIdx + 1]) : resolve(REPO, 'web', 'marketing');
  const reportDir = resolve(REPO, 'reports', 'marketing');
  if (!existsSync(reportDir)) mkdirSync(reportDir, { recursive: true });
  const files = listHtmlFiles(marketingRoot);
  const sitemap = loadSitemap(marketingRoot);
  const results = [];
  for (const f of files) {
    const html = readFileSync(f, 'utf-8');
    const rel = relative(marketingRoot, f);
    results.push(validatePage(rel, html, sitemap, marketingRoot, f));
  }
  const md = toMarkdown(results);
  writeFileSync(join(reportDir, 'SEO_AUDIT.md'), md, 'utf-8');
  const sum = summarise(results);
  process.stdout.write(`SEO audit: ${sum.passed}/${sum.total} pages pass (${sum.failed} fail). Report: reports/marketing/SEO_AUDIT.md\n`);
  if (strict && sum.failed > 0) process.exit(1);
}

const __isMain = (() => {
  try { return resolve(process.argv[1] ?? '') === resolve(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (__isMain) {
  main(process.argv.slice(2));
}
