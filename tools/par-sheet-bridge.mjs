#!/usr/bin/env node
/**
 * tools/par-sheet-bridge.mjs
 *
 * N+2 D (2026-06-23) — ES module bridge between ingest.mjs and the
 * vendor-detect + adapter dispatcher.
 *
 * Purpose
 *   ingest.mjs receives an opcioni `--par <path>` flag. This bridge:
 *     1) detects vendor + format (delegated to par-sheet-detect.mjs),
 *     2) dispatches to the matching adapter (XLSX → Python, CSV → MJS,
 *        JSON → inline),
 *     3) normalizes the adapter output into a stable ParBlob shape,
 *     4) writes a per-ingest receipt (par.json + meta tag values),
 *     5) merges PAR data into the in-memory model so downstream
 *        Step 6 (buildSlotHTML) and Step 6c (V9 visual QA) see the
 *        calibrated reels / paytable.
 *
 * NEVER blocks ingest:
 *   - Python missing      → skip with WARN, return { ok:false, skip:true }
 *   - File missing        → skip with WARN
 *   - Adapter timeout     → skip with WARN (60s budget already in dispatch)
 *   - Malformed XLSX      → skip with WARN
 *   The model is left unchanged in skip paths; ingest finishes normally.
 *
 * Public API (named exports, ES modules)
 *   - loadParSheet(parPath, opts?) → Promise<LoadResult>
 *   - applyParToModel(parBlob, model) → ApplyResult
 *   - bridgeIngest(parPath, model, opts?) → Promise<BridgeReceipt>
 *
 * LoadResult = {
 *   ok:        boolean
 *   skip?:     boolean         // graceful skip (Python missing etc.)
 *   reason?:   string
 *   parSheet?: object          // adapter output (per_reel_weights, paytable, ...)
 *   vendor?:   string
 *   format?:   string
 *   adapter?:  string
 *   signals?:  string[]
 * }
 *
 * ApplyResult = {
 *   modelChanged:        boolean
 *   appliedFields:       string[]   // e.g. ['reelStrips.par_sheet_weights']
 *   reelCount:           number
 *   symbolCount:         number
 *   paytableRowCount:    number
 *   warnings:            string[]
 * }
 *
 * BridgeReceipt = LoadResult + ApplyResult + { calibrationInput }
 *
 * Anti-vendor lint:
 *   Vendor codes ('igt', 'pragmatic', 'lw', 'spielo', 'generic') are
 *   adapter-routing metadata only — NEVER copied into model field VALUES.
 *   The merged model exposes `model.reelStrips.par_sheet_source` with the
 *   vendor code as a `vendor: <code>` field for receipt purposes, which
 *   downstream consumers should treat as opaque routing.
 */

import { existsSync, statSync } from 'node:fs';
import { resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = resolve(__filename, '..');
const REPO       = resolve(__dirname, '..');

/* ── load PAR sheet via existing detect+dispatch ─────────────────────── */

/**
 * Load + dispatch a PAR sheet file.
 *
 * Lazy-imports par-sheet-detect.mjs so this module's import cost stays
 * negligible when --par is not used.
 *
 * @param {string} parPath  absolute or repo-relative path
 * @param {object} [opts]   { sheet?: string } - xlsx sheet name override
 * @returns {Promise<LoadResult>}
 */
/* UQ-DEEP-C audit fix (D-CRIT-vendor-signals): par-sheet-detect.mjs
 * generates debug signals like "hdr /^Reel\s+1$/ → igt" or "swid → lw".
 * Those vendor identifiers are PAR-format routing keys (igt/pragmatic/
 * lw/spielo), NOT vendor product names — but anti-vendor-lint scans
 * with case-insensitive \bIGT\b and Light & Wonder patterns, so even
 * the routing key "lw" would leak by substring. Public par.json
 * receipts must NOT carry these tokens. Strip them before persisting.
 *
 * Strategy: replace all known vendor routing keys with neutral tags
 * (`vendorA`/`vendorB`/…) so debug provenance is preserved but no
 * banned tokens survive. Internal callers that need the raw vendor key
 * can still read `LoadResult.vendor` (top-level field), which is the
 * routing identifier and stays as-is for adapter dispatch. */
const VENDOR_KEY_SANITIZE_MAP = Object.freeze({
  igt:        'vendorA',
  pragmatic:  'vendorB',
  lw:         'vendorC',
  spielo:     'vendorD',
});
const VENDOR_KEY_RX = /\b(igt|pragmatic|lw|spielo)\b/gi;

export function sanitizeSignals(signals) {
  if (!Array.isArray(signals)) return [];
  return signals.map((s) => {
    if (typeof s !== 'string') return String(s);
    return s.replace(VENDOR_KEY_RX, (m) => {
      const k = m.toLowerCase();
      return VENDOR_KEY_SANITIZE_MAP[k] || 'vendorX';
    });
  });
}

export async function loadParSheet(parPath, opts = {}) {
  if (!parPath || typeof parPath !== 'string') {
    return { ok: false, reason: 'no PAR path provided' };
  }
  const abs = resolve(parPath);
  if (!existsSync(abs)) {
    return { ok: false, skip: true, reason: `PAR file not found: ${parPath}` };
  }
  try {
    const stat = statSync(abs);
    if (!stat.isFile()) {
      return { ok: false, reason: `PAR path is not a file: ${parPath}` };
    }
    /* 50 MB hard cap — protects against runaway memory on malformed
     * XLSX that openpyxl might read fully into RAM. */
    if (stat.size > 50 * 1024 * 1024) {
      return { ok: false, reason: `PAR file > 50 MB (got ${stat.size}b)` };
    }
  } catch (e) {
    return { ok: false, reason: `stat failed: ${e.message}` };
  }

  /* Lazy import so unused --par path costs nothing. */
  let dispatchIngest;
  try {
    ({ dispatchIngest } = await import(resolve(REPO, 'tools/par-sheet-detect.mjs')));
  } catch (e) {
    return { ok: false, reason: `bridge import failed: ${e.message}` };
  }

  let res;
  try {
    res = dispatchIngest(abs, opts);
  } catch (e) {
    return { ok: false, reason: `dispatch threw: ${e.message}` };
  }

  if (!res || !res.ok) {
    const reason = (res && res.error) || 'unknown dispatch failure';
    /* Distinguish Python-missing (skip) from real failure. The detect
     * tool returns a recognizable error string when openpyxl is missing
     * or python3 not on PATH. */
    const skip = /openpyxl|python3|no such file/i.test(reason) ||
                 /adapter binary not found/i.test(reason);
    return { ok: false, skip, reason, vendor: res?.vendor, format: res?.format };
  }

  return {
    ok: true,
    parSheet: res.parSheet,
    vendor: res.vendor,
    format: res.format,
    adapter: res.adapter,
    /* D-CRIT-vendor-signals: sanitize before crossing the bridge
     * boundary so par.json + model.reelStrips.par_sheet_source.signals
     * (both serialized to operator-visible artifacts) never embed
     * banned vendor routing keys. */
    signals: sanitizeSignals(res.signals || []),
  };
}

/* ── merge PAR data into model ───────────────────────────────────────── */

/**
 * Merge a normalized PAR blob into the universal model.
 *
 * Fields populated (additive overlay — never destroys parser-derived
 * data):
 *   model.reelStrips = model.reelStrips || {}
 *   model.reelStrips.par_sheet_weights[reelIdx] = { sym: weight, ... }
 *   model.reelStrips.par_sheet_paytable[symId][matchCount] = pay
 *   model.reelStrips.par_sheet_source = { vendor, format, basename, signals }
 *   model.__par_calibrated__ = true
 *
 * Pure function — clones the input model first so callers can keep
 * the unmodified copy if needed.
 *
 * @param {object} parBlob   adapter output (per_reel_weights, paytable, ...)
 * @param {object} model     parser model
 * @param {object} [meta]    { vendor, format, basename, signals }
 * @returns {{ model: object, applied: ApplyResult }}
 */
export function applyParToModel(parBlob, model, meta = {}) {
  if (!parBlob || typeof parBlob !== 'object') {
    throw new Error('applyParToModel: parBlob is required');
  }
  if (!model || typeof model !== 'object') {
    throw new Error('applyParToModel: model is required');
  }

  /* Deep-clone model so the caller's reference stays intact. structuredClone
   * is fine here — model is plain JSON. */
  const next = structuredClone(model);
  next.reelStrips = next.reelStrips || {};

  const warnings = [];
  const appliedFields = [];

  /* per_reel_weights: { 0: {sym:w,...}, 1: {...}, ... } */
  if (parBlob.per_reel_weights && typeof parBlob.per_reel_weights === 'object') {
    next.reelStrips.par_sheet_weights = parBlob.per_reel_weights;
    appliedFields.push('reelStrips.par_sheet_weights');
  } else {
    warnings.push('PAR blob missing per_reel_weights — weights overlay skipped');
  }

  /* paytable: [{ symbolId, combos: { '3': pay, '4': pay, '5': pay } }, ...] */
  if (Array.isArray(parBlob.paytable) && parBlob.paytable.length > 0) {
    const pt = {};
    for (const row of parBlob.paytable) {
      if (row && row.symbolId && row.combos && typeof row.combos === 'object') {
        pt[row.symbolId] = row.combos;
      }
    }
    if (Object.keys(pt).length > 0) {
      next.reelStrips.par_sheet_paytable = pt;
      appliedFields.push('reelStrips.par_sheet_paytable');
    }
  } else {
    warnings.push('PAR blob has no paytable rows — paytable overlay skipped');
  }

  /* Provenance metadata — vendor code is opaque routing, not vendor
   * name, BUT routing keys (igt/pragmatic/lw/spielo) lexically collide
   * with anti-vendor-lint patterns. D-CRIT-vendor-signals: sanitize to
   * neutral tags so par.json + model artifacts stay clean. */
  const rawVendor = meta.vendor || parBlob.vendor || 'unknown';
  const sanitizedVendor = VENDOR_KEY_SANITIZE_MAP[String(rawVendor).toLowerCase()]
    || (VENDOR_KEY_RX.test(rawVendor) ? 'vendorX' : rawVendor);
  VENDOR_KEY_RX.lastIndex = 0; /* stateful /g regex — reset after .test() */
  next.reelStrips.par_sheet_source = {
    vendor: sanitizedVendor,
    format: meta.format || null,
    basename: meta.basename || null,
    signals: sanitizeSignals(Array.isArray(meta.signals) ? meta.signals : []),
    appliedAt: new Date().toISOString(),
  };
  appliedFields.push('reelStrips.par_sheet_source');

  /* Top-level marker so anywhere in the codebase a quick boolean check
   * tells "was this model PAR-calibrated?" without traversing the tree. */
  next.__par_calibrated__ = true;
  appliedFields.push('__par_calibrated__');

  const reelCount =
    next.reelStrips.par_sheet_weights
      ? Object.keys(next.reelStrips.par_sheet_weights).length
      : 0;
  const symbolSet = new Set();
  if (next.reelStrips.par_sheet_weights) {
    for (const m of Object.values(next.reelStrips.par_sheet_weights)) {
      for (const k of Object.keys(m || {})) symbolSet.add(k);
    }
  }
  const paytableRowCount = next.reelStrips.par_sheet_paytable
    ? Object.keys(next.reelStrips.par_sheet_paytable).length
    : 0;

  return {
    model: next,
    applied: {
      modelChanged: appliedFields.length > 0,
      appliedFields,
      reelCount,
      symbolCount: symbolSet.size,
      paytableRowCount,
      warnings,
    },
  };
}

/* ── bridge orchestrator (load + apply in one call) ──────────────────── */

/**
 * End-to-end: load PAR sheet, merge into model, return full receipt.
 * Never throws — error paths return { ok: false, reason }.
 *
 * @param {string} parPath
 * @param {object} model
 * @param {object} [opts] { sheet?, basename? }
 * @returns {Promise<BridgeReceipt>}
 */
export async function bridgeIngest(parPath, model, opts = {}) {
  const load = await loadParSheet(parPath, opts);
  if (!load.ok) {
    return { ...load, modelChanged: false, appliedFields: [], warnings: [] };
  }
  let applyOut;
  try {
    applyOut = applyParToModel(load.parSheet, model, {
      vendor: load.vendor,
      format: load.format,
      basename: opts.basename || basename(parPath),
      signals: load.signals,
    });
  } catch (e) {
    return {
      ok: false,
      reason: `applyParToModel failed: ${e.message}`,
      vendor: load.vendor,
      format: load.format,
      modelChanged: false,
      appliedFields: [],
      warnings: [],
    };
  }
  return {
    ok: true,
    vendor: load.vendor,
    format: load.format,
    adapter: load.adapter,
    signals: load.signals,
    model: applyOut.model,
    parSheet: load.parSheet,
    ...applyOut.applied,
  };
}

/* ── CLI ─────────────────────────────────────────────────────────────── */

if (process.argv[1]?.endsWith('par-sheet-bridge.mjs')) {
  const args = process.argv.slice(2);
  const parPath = args[0];
  if (!parPath) {
    console.error('Usage: node tools/par-sheet-bridge.mjs <par-path> [--sheet=<name>]');
    console.error('       (probe only — does not modify any model)');
    process.exit(2);
  }
  const sheetArg = args.find(a => a.startsWith('--sheet='))?.slice(8);
  loadParSheet(parPath, sheetArg ? { sheet: sheetArg } : {}).then(r => {
    /* Trim parSheet payload for CLI readability — full output via library. */
    if (r.parSheet) {
      const trimmed = {
        vendor: r.parSheet.vendor,
        totals: r.parSheet.totals,
        paytableRows: (r.parSheet.paytable || []).length,
        reelCount: Object.keys(r.parSheet.per_reel_weights || {}).length,
      };
      console.log(JSON.stringify({ ...r, parSheet: trimmed }, null, 2));
    } else {
      console.log(JSON.stringify(r, null, 2));
    }
    process.exit(r.ok ? 0 : (r.skip ? 0 : 1));
  });
}
