#!/usr/bin/env node
/**
 * CORTI W207-DOCS - Auto-generate API docs from source.
 *
 * Two outputs:
 *   web/docs/content/generated/api-routes.md
 *   web/docs/content/generated/sdk-reference.md
 *
 * `api-routes.md` is parsed from `server/routes/*.ts` by grepping for the
 * fastify route registrations (`app.get(...)`, `app.post<...>(...)`, etc.).
 * The parser is intentionally pragmatic - it pulls the HTTP method + URL +
 * the first leading JSDoc comment from the file header. Hand-curated
 * details live in `05-rest-api.md`.
 *
 * `sdk-reference.md` is parsed from `sdk/*.ts` by reading the JSDoc-style
 * comments above each `export class` / `export function` declaration.
 *
 * Re-run on `npm run docs:gen`. Output files are git-tracked so PR
 * reviewers can see diff churn when routes change.
 */

import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const ROUTES_DIR = resolve(ROOT, 'server/routes');
const SDK_DIR = resolve(ROOT, 'sdk');
const OUT_DIR = resolve(ROOT, 'web/docs/content/generated');

mkdirSync(OUT_DIR, { recursive: true });

// ──────────────────────────────────────────────────────────────────────
// api-routes.md
// ──────────────────────────────────────────────────────────────────────

function extractRoutes(file) {
  const text = readFileSync(file, 'utf8');
  // first /** ... */ block at top of file
  const headerMatch = /\/\*\*([\s\S]*?)\*\//.exec(text);
  const header = headerMatch
    ? headerMatch[1]
        .split('\n')
        .map((l) => l.replace(/^\s*\*\s?/, '').trim())
        .filter(Boolean)
        .join(' ')
    : '';
  const routes = [];
  const re = /app\.(get|post|put|delete|patch)(?:<[^>]+>)?\s*\(\s*['"`]([^'"`]+)['"`]/g;
  let m;
  while ((m = re.exec(text))) {
    routes.push({ method: m[1].toUpperCase(), path: m[2] });
  }
  return { header, routes };
}

function buildApiRoutesMd() {
  const files = readdirSync(ROUTES_DIR)
    .filter((f) => f.endsWith('.ts'))
    .sort();
  const sections = [];
  let totalRoutes = 0;
  for (const f of files) {
    const full = join(ROUTES_DIR, f);
    const { header, routes } = extractRoutes(full);
    totalRoutes += routes.length;
    sections.push(`## ${f}`);
    if (header) sections.push(`> ${header.slice(0, 480)}`);
    if (routes.length === 0) {
      sections.push('_no routes detected_');
    } else {
      sections.push('| Method | Path |');
      sections.push('|---|---|');
      for (const r of routes) {
        sections.push(`| \`${r.method}\` | \`${r.path}\` |`);
      }
    }
    sections.push('');
  }
  const head = [
    '# Auto-generated API routes',
    '',
    `Generated from \`server/routes/*.ts\` by \`scripts/generate-api-docs.mjs\`. `,
    `Captures ${totalRoutes} routes across ${files.length} route files. `,
    'Re-run via `npm run docs:gen`. See **REST API** for the hand-curated narrative.',
    '',
  ];
  return head.concat(sections).join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// sdk-reference.md
// ──────────────────────────────────────────────────────────────────────

function extractSdkSymbols(file) {
  const text = readFileSync(file, 'utf8');
  const symbols = [];
  // capture jsdoc + the declaration that follows
  const re =
    /\/\*\*([\s\S]*?)\*\/\s*(?:export\s+)(?:async\s+)?(class|function|interface|type|const)\s+(\w+)/g;
  let m;
  while ((m = re.exec(text))) {
    const jsdoc = m[1]
      .split('\n')
      .map((l) => l.replace(/^\s*\*\s?/, '').trim())
      .filter(Boolean)
      .join(' ');
    symbols.push({ kind: m[2], name: m[3], doc: jsdoc.slice(0, 480) });
  }
  return symbols;
}

function buildSdkReferenceMd() {
  const files = ['index.ts', 'types.ts', 'client.ts', 'kernel-author.ts'];
  const sections = [];
  let totalSyms = 0;
  for (const f of files) {
    const full = join(SDK_DIR, f);
    const syms = extractSdkSymbols(full);
    totalSyms += syms.length;
    sections.push(`## sdk/${f}`);
    if (syms.length === 0) {
      sections.push('_no documented exports_');
    } else {
      sections.push('| Kind | Symbol | Summary |');
      sections.push('|---|---|---|');
      for (const s of syms) {
        const safeDoc = s.doc.replace(/\|/g, '\\|');
        sections.push(`| \`${s.kind}\` | \`${s.name}\` | ${safeDoc} |`);
      }
    }
    sections.push('');
  }
  const head = [
    '# Auto-generated SDK reference',
    '',
    `Generated from \`sdk/*.ts\` JSDoc comments by \`scripts/generate-api-docs.mjs\`. `,
    `Captures ${totalSyms} exported symbols across ${files.length} files. `,
    'See **TypeScript SDK** for the hand-curated narrative.',
    '',
  ];
  return head.concat(sections).join('\n');
}

// ──────────────────────────────────────────────────────────────────────
// main
// ──────────────────────────────────────────────────────────────────────

const apiMd = buildApiRoutesMd();
const sdkMd = buildSdkReferenceMd();

writeFileSync(join(OUT_DIR, 'api-routes.md'), apiMd);
writeFileSync(join(OUT_DIR, 'sdk-reference.md'), sdkMd);

const lines = apiMd.split('\n').length;
const sdkLines = sdkMd.split('\n').length;
console.log(`generated api-routes.md (${lines} lines)`);
console.log(`generated sdk-reference.md (${sdkLines} lines)`);
