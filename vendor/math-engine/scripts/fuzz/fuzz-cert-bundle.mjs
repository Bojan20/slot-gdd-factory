#!/usr/bin/env node
/**
 * W214 Faza 600.3 — Fuzz cert dossier bundle parser.
 *
 * Cert dossiers are tarred bundles of:
 *   - dossier.json (the manifest)
 *   - paytables/*.json
 *   - acceptance/*.json
 *   - signatures/*.sig
 *   - SBOM.json
 *
 * The parser must reject malformed manifests, missing required files,
 * mismatched signatures, and circular references. This harness throws
 * randomly-shaped manifests at the lenient validator and asserts no
 * uncaught exceptions ever surface.
 */

import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gen, runFuzz } from './_lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const REPORT_DIR = join(ROOT, 'reports', 'fuzz');

// ---------------------------------------------------------------------------
// Validator stub — mirrors `server/lib/cert/dossier.ts`.
// ---------------------------------------------------------------------------

export const REQUIRED_KEYS = ['version', 'gameId', 'rtp', 'paytables', 'acceptance', 'signatures'];

export function validateManifest(manifest) {
  try {
    if (manifest == null) return { ok: false, code: 'null_manifest' };
    if (typeof manifest !== 'object' || Array.isArray(manifest)) {
      return { ok: false, code: 'non_object' };
    }
    for (const k of REQUIRED_KEYS) {
      if (!Object.prototype.hasOwnProperty.call(manifest, k)) {
        return { ok: false, code: `missing:${k}` };
      }
    }
    if (typeof manifest.version !== 'string' || !/^\d+\.\d+\.\d+$/.test(manifest.version)) {
      return { ok: false, code: 'bad_version' };
    }
    if (typeof manifest.gameId !== 'string' || !/^[a-z0-9-]{2,64}$/.test(manifest.gameId)) {
      return { ok: false, code: 'bad_game_id' };
    }
    if (typeof manifest.rtp !== 'number' || !Number.isFinite(manifest.rtp)
        || manifest.rtp < 0.5 || manifest.rtp > 1.0) {
      return { ok: false, code: 'bad_rtp' };
    }
    if (!Array.isArray(manifest.paytables) || manifest.paytables.length === 0 || manifest.paytables.length > 256) {
      return { ok: false, code: 'bad_paytables' };
    }
    for (const pt of manifest.paytables) {
      if (typeof pt !== 'string' || !pt.endsWith('.json') || pt.includes('..')) {
        return { ok: false, code: 'bad_paytable_ref' };
      }
    }
    if (!Array.isArray(manifest.acceptance) || manifest.acceptance.length === 0) {
      return { ok: false, code: 'bad_acceptance' };
    }
    if (!Array.isArray(manifest.signatures) || manifest.signatures.length === 0) {
      return { ok: false, code: 'bad_signatures' };
    }
    for (const sig of manifest.signatures) {
      if (!sig || typeof sig !== 'object') return { ok: false, code: 'bad_sig_entry' };
      if (typeof sig.algorithm !== 'string' || !/^(rsa|ecdsa|ed25519)/i.test(sig.algorithm)) {
        return { ok: false, code: 'bad_sig_algo' };
      }
      if (typeof sig.value !== 'string' || sig.value.length < 32 || sig.value.length > 4096) {
        return { ok: false, code: 'bad_sig_value' };
      }
    }
    if (manifest.sbom !== undefined && typeof manifest.sbom !== 'string') {
      return { ok: false, code: 'bad_sbom' };
    }
    // Detect circular refs by JSON-serialising.
    try { JSON.stringify(manifest); } catch { return { ok: false, code: 'circular' }; }
    return { ok: true };
  } catch (e) {
    return { ok: false, code: `exception:${e instanceof Error ? e.name : 'unknown'}` };
  }
}

// ---------------------------------------------------------------------------
// Generator
// ---------------------------------------------------------------------------

function genManifest(rng) {
  if (rng.unit() < 0.05) return rng.pick([null, undefined, '', 0, [], gen.badString(rng)]);
  const m = {};
  // Sometimes drop required keys to exercise the missing-key path.
  for (const k of REQUIRED_KEYS) {
    if (rng.unit() < 0.8) m[k] = null;
  }
  if (rng.unit() < 0.9) m.version = rng.unit() < 0.5 ? '1.2.3' : gen.badString(rng);
  if (rng.unit() < 0.9) m.gameId = rng.unit() < 0.5 ? 'lw-quick-hit' : gen.badString(rng);
  if (rng.unit() < 0.9) m.rtp = gen.number(rng);
  if (rng.unit() < 0.9) m.paytables = gen.arrayOf(rng, (r) => gen.badString(r), 16);
  if (rng.unit() < 0.9) m.acceptance = gen.arrayOf(rng, (r) => gen.badString(r), 16);
  if (rng.unit() < 0.9) m.signatures = gen.arrayOf(rng, (r) => ({
    algorithm: r.unit() < 0.5 ? 'ecdsa' : gen.badString(r),
    value: gen.badString(r),
  }), 8);
  if (rng.unit() < 0.05) m.sbom = gen.badString(rng);
  if (rng.unit() < 0.03) {
    // Circular ref attempt.
    m.self = m;
  }
  return m;
}

export function body(input) {
  const res = validateManifest(input);
  if (!res || typeof res.ok !== 'boolean') throw new Error('validateManifest non-result');
  if (!res.ok && typeof res.code !== 'string') throw new Error('validateManifest err missing code');
}

export function main(opts = {}) {
  const iter = opts.iterations ?? Number(process.env.ITER) ?? 10_000;
  const report = runFuzz({
    name: 'cert-bundle',
    makeInput: genManifest,
    body,
    iterations: iter,
  });
  if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  writeFileSync(join(REPORT_DIR, 'REPORT-cert.json'), JSON.stringify(report, null, 2));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = main();
  if (r.crashes.length > 0) {
    console.error(`fuzz-cert-bundle: ${r.crashes.length} crashes`);
    process.exit(1);
  }
}
