#!/usr/bin/env node
/**
 * tools/sanitize-synth-titles.mjs
 *
 * N8 (2026-06-23) — Sanitize vendor names iz synth fixture slot.html titles.
 *
 * Reads LOW anti-vendor-lint findings, klasifikuje fajlove u:
 *   - synth fixtures (path matches `dist/real-games/<digits>-`) — SAFE to edit
 *   - pinned baselines (`*-gdd/slot.html` slug u BASELINE_PINS) — SKIP
 *     (CLAUDE.md HARD RULE: pinned baselines ostaju za back-compat sa
 *      tests/fixtures/semantic-expected.json SHA snapshots)
 *
 * Za safe fajlove zamenjuje vendor strings (Megaways, MEGAWAYS, L&W,
 * etc) sa `Synthetic fixture` u 3 lokacije: <title>, <div class="title">,
 * `__MODEL_NAME__` const. Idempotent — ponovni run nema efekta.
 *
 * ## USAGE
 *   node tools/sanitize-synth-titles.mjs               # apply
 *   node tools/sanitize-synth-titles.mjs --dry-run     # report only
 *   node tools/sanitize-synth-titles.mjs --json
 *
 * ## EXIT
 *   0 — completed (always; "nothing to fix" still 0)
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);
const REPO       = resolve(__dirname, '..');
const REAL_GAMES = join(REPO, 'dist/real-games');

/* Pinned baselines (per CLAUDE.md HARD RULE) — never auto-edited. */
const BASELINE_PINS = Object.freeze([
  'cash-eruption-foundry-gdd',
  'huff-n-more-puff-gdd',
  'starlight-travellers-gdd',
  'wrath-of-olympus-gdd',
  'gates-of-olympus-1000-gdd',
]);

/* Vendor patterns to neutralise (case-insensitive). Synced sa anti-vendor-lint. */
const VENDOR_PATTERNS = Object.freeze([
  /Megaways/gi,
  /Cash[\s_-]?Eruption/gi,
  /Wolf[\s_-]?Run/gi,
  /Cleopatra/gi,
  /Buffalo/gi,
  /NetEnt/gi,
  /Microgaming/gi,
  /\bIGT\b/g,
  /Pragmatic\s+Play/gi,
  /\bL&W\b/g,
  /Scientific\s+Games/gi,
  /Play['’]?n\s*Go/gi,
  /Novomatic/gi,
]);

/* ── Pure helpers ─────────────────────────────────────────────────────── */

export function isPinnedBaseline(filePath) {
  return BASELINE_PINS.some(slug => filePath.includes(`/${slug}/`));
}

export function sanitizeText(text) {
  let out = text;
  for (const re of VENDOR_PATTERNS) {
    out = out.replace(re, 'Synthetic');
  }
  return out;
}

export function sanitizeHtmlSurfaces(html) {
  /* Three surfaces only — title tag, .title div, __MODEL_NAME__ string. */
  let out = html;
  let changes = 0;
  out = out.replace(/<title>([^<]*)<\/title>/g, (m, inner) => {
    const cleaned = sanitizeText(inner);
    if (cleaned !== inner) changes++;
    return `<title>${cleaned}</title>`;
  });
  out = out.replace(/<div class="title">([^<]*)<\/div>/g, (m, inner) => {
    const cleaned = sanitizeText(inner);
    if (cleaned !== inner) changes++;
    return `<div class="title">${cleaned}</div>`;
  });
  out = out.replace(/const\s+__MODEL_NAME__\s*=\s*"([^"]*)"/g, (m, inner) => {
    const cleaned = sanitizeText(inner);
    if (cleaned !== inner) changes++;
    return `const __MODEL_NAME__ = "${cleaned}"`;
  });
  return { html: out, changes };
}

/* ── Tool ─────────────────────────────────────────────────────────────── */

export async function runSanitization({ dryRun = false } = {}) {
  /* Read live anti-vendor-lint findings. anti-vendor-lint exports runLint
   * but does NOT export DEFAULT_TARGETS — replicate the dist scan path
   * here (synth titles only live in dist/real-games slot.html). */
  const lintMod = await import('./anti-vendor-lint.mjs');
  const lintReport = await lintMod.runLint(['dist/real-games/*/slot.html']);
  const lowFindings = (lintReport.findings || []).filter(f => f.severity === 'LOW');
  /* Group findings by absolute file. */
  const filesAffected = new Map();
  for (const f of lowFindings) {
    const abs = resolve(REPO, f.file);
    if (!filesAffected.has(abs)) filesAffected.set(abs, []);
    filesAffected.get(abs).push(f);
  }

  const results = [];
  for (const [absPath, findings] of filesAffected) {
    const rel = absPath.replace(REPO + '/', '');
    if (isPinnedBaseline(absPath)) {
      results.push({ file: rel, action: 'skip-pinned', findings: findings.length });
      continue;
    }
    if (!existsSync(absPath)) {
      results.push({ file: rel, action: 'skip-missing', findings: findings.length });
      continue;
    }
    const src = readFileSync(absPath, 'utf8');
    const { html, changes } = sanitizeHtmlSurfaces(src);
    if (changes === 0) {
      results.push({ file: rel, action: 'noop-no-surface', findings: findings.length });
      continue;
    }
    if (dryRun) {
      results.push({ file: rel, action: 'would-sanitize', surfaceChanges: changes, findings: findings.length });
    } else {
      writeFileSync(absPath, html, 'utf8');
      results.push({ file: rel, action: 'sanitized', surfaceChanges: changes, findings: findings.length });
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    tool: 'tools/sanitize-synth-titles.mjs',
    dryRun,
    totalFilesScanned: filesAffected.size,
    pinnedSkipped: results.filter(r => r.action === 'skip-pinned').length,
    sanitized:     results.filter(r => r.action === 'sanitized').length,
    wouldSanitize: results.filter(r => r.action === 'would-sanitize').length,
    results,
  };
}

/* ── ASCII render (box-drawing per HARD RULE #3) ──────────────────────── */

export function renderResult(report) {
  const out = [];
  out.push(`sanitize-synth-titles · ${report.dryRun ? 'DRY RUN' : 'APPLIED'}`);
  out.push(`generated: ${report.generatedAt}`);
  out.push('');
  out.push(`Total files scanned: ${report.totalFilesScanned}  ·  Pinned skipped: ${report.pinnedSkipped}  ·  ${report.dryRun ? 'Would sanitize' : 'Sanitized'}: ${report.dryRun ? report.wouldSanitize : report.sanitized}`);
  out.push('');
  out.push('┌──────────────────────────────────────────────────────────┬──────────────────┬─────┐');
  out.push('│ File                                                      │ Action           │  Δ  │');
  out.push('├──────────────────────────────────────────────────────────┼──────────────────┼─────┤');
  for (const r of report.results) {
    const file = r.file.length > 56 ? '...' + r.file.slice(-53) : r.file;
    out.push('│ ' + file.padEnd(56) + ' │ ' + r.action.padEnd(16) + ' │ ' +
      String(r.surfaceChanges ?? '—').padStart(3) + ' │');
  }
  out.push('└──────────────────────────────────────────────────────────┴──────────────────┴─────┘');
  return out.join('\n');
}

/* ── CLI ──────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('sanitize-synth-titles.mjs')) {
  const args = process.argv.slice(2);
  const dryRun  = args.includes('--dry-run');
  const jsonOnly = args.includes('--json');
  const report = await runSanitization({ dryRun });
  if (jsonOnly) console.log(JSON.stringify(report, null, 2));
  else console.log(renderResult(report));
  process.exit(0);
}

export default { isPinnedBaseline, sanitizeText, sanitizeHtmlSurfaces, runSanitization, renderResult };
