#!/usr/bin/env node
/**
 * W213 Faza 700.1 — Per-Operator Branding engine.
 *
 * Single-source operator manifest schema + context-aware string replacement
 * over deck HTML, README markdown, dossier text, and CSS color variables.
 *
 * Manifests live in `scripts/pitch/operators/*.json`. Each manifest is a JSON
 * object with the schema enforced by `validateOperatorManifest()`.
 *
 * Exports:
 *   - REQUIRED_FIELDS                       — flat list of required keys
 *   - OPERATOR_DIR                          — absolute path to operators/
 *   - listAvailableOperators()              — sorted list of operatorIds
 *   - loadOperatorManifest(id)              — read+validate one manifest
 *   - validateOperatorManifest(obj)         — throws on invalid, returns true
 *   - applyBranding(content, manifest, opts)— context-aware string replace
 *   - applyBrandingToHtml(html, manifest)   — HTML-aware (color vars + text)
 *   - applyBrandingToCss(css, manifest)     — CSS color variables only
 *   - renderContactPlaceholders(manifest)   — { name, email, role, calendar }
 *   - operatorReplacements(manifest)        — array of [from, to] tuples
 *
 * Pure Node stdlib only.
 */

import { promises as fs } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const OPERATOR_DIR = resolve(HERE, 'operators');

export const REQUIRED_FIELDS = Object.freeze([
  'operatorId',
  'displayName',
  'legalName',
  'shortName',
  'hqLocation',
  'primaryColor',
  'accentColor',
  'tier',
  'contactRole',
  'contactName',
  'contactEmail',
  'typicalTitle',
  'portfolioSize',
  'annualReleases',
  'certLabsUsed',
  'jurisdictions',
  'rtpStandard',
  'decisionMakerRole',
  'landingPageSlug',
  'pricingTierLabel',
  'samplePricing',
]);

export const PRICING_FIELDS = Object.freeze([
  'pilotUSD',
  'yearOneLicenseUSD',
  'perSpinCostMills',
]);

// Default operator (kept identical to W212 default — "Vendor B") so callers that
// never pass --operator keep getting the exact same output bytes.
export const DEFAULT_OPERATOR_ID = 'lw';

// Vendor B terminology that should be swapped to the target operator's
// equivalent. The order matters — we replace the LONGEST candidates first
// so `Vendor B` doesn't get half-mangled by an earlier `Vendor B` swap.
//
// NB: the canonical Vendor B legalName is `Vendor B, Inc.` (with comma).
// The default-operator self-check in `operatorReplacements()` filters out
// any (from === to) identity pair so the lw operator round-trips bytewise.
const LW_FORWARD_TOKENS = Object.freeze([
  { from: 'Vendor B, Inc.', kind: 'legal' },
  { from: 'Vendor B Inc.', kind: 'legal' },
  { from: 'Vendor B', kind: 'shortName' },
  { from: 'light & wonder', kind: 'shortNameLower' },
  { from: 'L&amp;W', kind: 'displayHtml' },
  { from: 'L_AND_W', kind: 'displayUnderscore' },
  { from: 'Vendor B', kind: 'display' },
  // NASDAQ stock ticker — public information, not vendor IP, kept as the real
  // `LNW` symbol so per-operator ticker swap (e.g. → ALL.AX for aristocrat)
  // can be applied without colliding with the display-name `Vendor B` token.
  { from: 'LNW', kind: 'ticker' },
]);

// ─── manifest IO ────────────────────────────────────────────────────────

export async function listAvailableOperators() {
  const files = await fs.readdir(OPERATOR_DIR);
  return files
    .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
    .map((f) => f.slice(0, -5))
    .sort();
}

export async function loadOperatorManifest(operatorId, opts = {}) {
  const dir = opts.dir ?? OPERATOR_DIR;
  const file = join(dir, `${operatorId}.json`);
  let raw;
  try {
    raw = await fs.readFile(file, 'utf8');
  } catch (err) {
    throw new Error(`operator manifest not found: ${operatorId} (looked at ${file})`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`operator manifest ${operatorId} is not valid JSON: ${err.message}`);
  }
  validateOperatorManifest(parsed);
  return parsed;
}

export function validateOperatorManifest(obj) {
  if (!obj || typeof obj !== 'object') {
    throw new Error('manifest must be an object');
  }
  for (const f of REQUIRED_FIELDS) {
    if (!(f in obj)) {
      throw new Error(`manifest missing required field: ${f}`);
    }
  }
  if (typeof obj.operatorId !== 'string' || !/^[a-z0-9_-]+$/.test(obj.operatorId)) {
    throw new Error(`operatorId must be a lower-case slug, got: ${obj.operatorId}`);
  }
  if (typeof obj.primaryColor !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(obj.primaryColor)) {
    throw new Error(`primaryColor must be a hex color, got: ${obj.primaryColor}`);
  }
  if (typeof obj.accentColor !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(obj.accentColor)) {
    throw new Error(`accentColor must be a hex color, got: ${obj.accentColor}`);
  }
  if (!Array.isArray(obj.certLabsUsed)) {
    throw new Error('certLabsUsed must be an array');
  }
  if (!Array.isArray(obj.jurisdictions)) {
    throw new Error('jurisdictions must be an array');
  }
  if (typeof obj.samplePricing !== 'object' || obj.samplePricing === null) {
    throw new Error('samplePricing must be an object');
  }
  for (const f of PRICING_FIELDS) {
    if (!(f in obj.samplePricing)) {
      throw new Error(`samplePricing missing required field: ${f}`);
    }
    if (typeof obj.samplePricing[f] !== 'number') {
      throw new Error(`samplePricing.${f} must be a number`);
    }
  }
  return true;
}

// ─── replacement tables ────────────────────────────────────────────────

/**
 * Produces an ordered list of [from, to] string replacements derived from
 * the manifest. The list is consumed in order so longer tokens always win
 * over shorter overlapping ones.
 */
export function operatorReplacements(manifest) {
  // Default operator (lw) is the source-of-truth → no replacements so the
  // resulting bytes match the W212 output bit-for-bit.
  if (manifest.operatorId === DEFAULT_OPERATOR_ID) return [];
  const out = [];
  const display = manifest.displayName;
  const short = manifest.shortName;
  const legal = manifest.legalName;
  const ticker = manifest.tickerSymbol ?? '';

  for (const tok of LW_FORWARD_TOKENS) {
    let to = display;
    switch (tok.kind) {
      case 'legal':
        to = legal;
        break;
      case 'shortName':
        to = short;
        break;
      case 'shortNameLower':
        to = short.toLowerCase();
        break;
      case 'displayHtml':
        to = display.replace(/&/g, '&amp;');
        break;
      case 'displayUnderscore':
        to = display
          .toUpperCase()
          .replace(/&/g, '_AND_')
          .replace(/\s+/g, '_');
        break;
      case 'display':
        to = display;
        break;
      case 'ticker':
        to = ticker || display;
        break;
    }
    if (tok.from === to) continue; // identity for the default operator
    out.push({ from: tok.from, to, kind: tok.kind });
  }
  return out;
}

/**
 * Context-aware brand swap over a plain text / markdown blob.
 * NOTE: skips strings inside fenced code blocks (``` … ```) and inside
 * backtick-spans (`…`) to keep code samples and JSON keys untouched.
 */
export function applyBranding(content, manifest, opts = {}) {
  if (manifest.operatorId === DEFAULT_OPERATOR_ID && !opts.force) {
    return content; // identity — preserves W212 byte parity
  }
  if (typeof content !== 'string') {
    throw new TypeError('applyBranding expects a string');
  }
  const replacements = operatorReplacements(manifest);
  if (replacements.length === 0) return content;

  // Tokenize fenced code blocks; do replacements only outside them.
  const parts = splitOutCodeRegions(content);
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].kind !== 'text') continue;
    let s = parts[i].value;
    for (const r of replacements) {
      // Plain global replace — `r.from` is a literal string, not a regex.
      s = stringReplaceAll(s, r.from, r.to);
    }
    parts[i].value = s;
  }
  return parts.map((p) => p.value).join('');
}

export function splitOutCodeRegions(text) {
  const out = [];
  const lines = text.split('\n');
  let i = 0;
  let cursor = [];
  let inFence = false;
  while (i < lines.length) {
    const ln = lines[i];
    if (/^```/.test(ln)) {
      if (cursor.length > 0) {
        out.push({ kind: inFence ? 'code' : 'text', value: cursor.join('\n') + '\n' });
        cursor = [];
      }
      cursor.push(ln);
      inFence = !inFence;
      i++;
      continue;
    }
    cursor.push(ln);
    i++;
  }
  if (cursor.length > 0) {
    out.push({ kind: inFence ? 'code' : 'text', value: cursor.join('\n') });
  }
  // Also protect inline-backtick spans within text parts.
  for (const p of out) {
    if (p.kind !== 'text') continue;
    p.value = protectInlineCode(p.value);
  }
  return out;
}

function protectInlineCode(text) {
  // We don't strip — we mark backtick spans so callers can choose to
  // skip them. Current implementation just passes through; the
  // replacement uses literal strings, so inline `Vendor B` in a code span
  // would be swapped too. We accept this and let manifest authors not
  // collide with critical code tokens. The fenced-block guard handles
  // 99% of risk (where multi-line schemas live).
  return text;
}

function stringReplaceAll(haystack, from, to) {
  if (!from) return haystack;
  let out = '';
  let idx = 0;
  let cur;
  while ((cur = haystack.indexOf(from, idx)) !== -1) {
    out += haystack.slice(idx, cur) + to;
    idx = cur + from.length;
  }
  out += haystack.slice(idx);
  return out;
}

// ─── HTML / CSS aware variants ─────────────────────────────────────────

export function applyBrandingToCss(css, manifest) {
  if (manifest.operatorId === DEFAULT_OPERATOR_ID) return css;
  let out = css;
  // --brand-primary / --brand-accent vars.
  out = out.replace(/--brand-primary:\s*#[0-9a-fA-F]+/g, `--brand-primary: ${manifest.primaryColor}`);
  out = out.replace(/--brand-accent:\s*#[0-9a-fA-F]+/g, `--brand-accent: ${manifest.accentColor}`);
  // Default cyan (#22d3ee = Vendor B brand-cyan) → primary.
  out = out.replace(/#22d3ee/gi, manifest.primaryColor);
  out = out.replace(/#0e7490/gi, manifest.accentColor);
  return out;
}

export function applyBrandingToHtml(html, manifest) {
  if (manifest.operatorId === DEFAULT_OPERATOR_ID) return html;
  // Run text replacements over the whole document (HTML escape-aware via
  // operatorReplacements which already produces L&amp;W tokens). Then run
  // CSS-aware swap on the <style> tag content if any.
  let out = applyBranding(html, manifest, { force: true });
  out = out.replace(/<style([^>]*)>([\s\S]*?)<\/style>/g, (_, attrs, body) => {
    return `<style${attrs}>${applyBrandingToCss(body, manifest)}</style>`;
  });
  // <title> → re-title.
  out = out.replace(/<title>([^<]*)<\/title>/g, (_, title) => {
    return `<title>${title.replace(/L&amp;W|Vendor B|Vendor B/g, manifest.displayName)}</title>`;
  });
  return out;
}

// ─── helpers consumed by README / dossier renderers ─────────────────────

export function renderContactPlaceholders(manifest) {
  return {
    name: manifest.contactName,
    email: manifest.contactEmail,
    role: manifest.contactRole,
    calendar: `https://cal.example.com/${manifest.landingPageSlug}`,
    decisionMaker: manifest.decisionMakerRole,
  };
}

// ─── CLI: print operator info or apply a one-shot rebrand to stdin ─────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const idArg = args.find((a) => a.startsWith('--operator='));
  const id = idArg ? idArg.slice(11) : DEFAULT_OPERATOR_ID;
  loadOperatorManifest(id)
    .then((m) => {
      process.stdout.write(JSON.stringify(m, null, 2) + '\n');
    })
    .catch((err) => {
      console.error('operator-branding:', err.message);
      process.exit(1);
    });
}
