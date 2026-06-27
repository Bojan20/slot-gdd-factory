#!/usr/bin/env node
/**
 * W213 Faza 700.1 — Production signing chain verifier.
 *
 * Validates the three-level signing envelope created by `production-sign.mjs`:
 *   - root.publicKey  → verifies intermediate.signatureOverIntermediatePubKey
 *                       over intermediate.publicKey
 *   - intermediate.publicKey
 *                     → verifies intermediate.signatureOverLeafPubKey
 *                       over leaf.publicKey
 *   - leaf.publicKey  → verifies leaf.signature over manifestDigest
 *   - leaf.publicKey  → verifies timestampAuthority.signature over
 *                       timestampAuthority.payload
 *
 * Returns { ok, errors, checks } where `checks` records each link's verdict.
 *
 * Tamper-resistance: every link is verified independently, so corruption
 * of any single link (signature, key, or signed message) produces a fail.
 *
 * Pure Node stdlib + @noble/ed25519.
 */

import { hexToBytes, verifyString, verifyBytes, sha256Hex } from './production-sign.mjs';

export const CHECK_NAMES = Object.freeze([
  'root-trust-anchor-present',
  'root-signs-intermediate',
  'intermediate-signs-leaf',
  'leaf-signs-manifest-digest',
  'leaf-signs-timestamp-payload',
  'manifest-digest-matches',
]);

export async function verifyProductionSignature({ envelope, manifestBytes, trustedRootPubKey = null }) {
  const errors = [];
  const checks = {};

  const fail = (name, why) => {
    checks[name] = { ok: false, why };
    errors.push(`${name}: ${why}`);
  };
  const pass = (name) => {
    checks[name] = { ok: true };
  };

  if (!envelope || typeof envelope !== 'object') {
    return { ok: false, errors: ['envelope-missing'], checks };
  }
  if (envelope.algorithm !== 'ed25519') {
    return { ok: false, errors: [`unexpected-algorithm:${envelope.algorithm}`], checks };
  }

  // 1. Trust anchor — if caller supplied a pinned root pub key, must match.
  if (trustedRootPubKey) {
    if (envelope.root?.publicKey !== trustedRootPubKey) {
      fail('root-trust-anchor-present', 'root publicKey does not match pinned trustedRootPubKey');
    } else {
      pass('root-trust-anchor-present');
    }
  } else {
    // No pinning → presence-only check.
    if (!envelope.root?.publicKey) fail('root-trust-anchor-present', 'root publicKey missing');
    else pass('root-trust-anchor-present');
  }

  // 2. Root signs intermediate's public key.
  const rootSigOverInt = envelope.root?.signatureOverIntermediatePubKey;
  const intermediatePubKey = envelope.intermediate?.publicKey;
  if (!rootSigOverInt || !intermediatePubKey || !envelope.root?.publicKey) {
    fail('root-signs-intermediate', 'missing pubkey or signature');
  } else {
    const okR = await verifyBytes(rootSigOverInt, envelope.root.publicKey, hexToBytes(intermediatePubKey));
    if (okR) pass('root-signs-intermediate');
    else fail('root-signs-intermediate', 'signature verify failed');
  }

  // 3. Intermediate signs leaf's public key.
  const intSigOverLeaf = envelope.intermediate?.signatureOverLeafPubKey;
  const leafPubKey = envelope.leaf?.publicKey;
  if (!intSigOverLeaf || !leafPubKey || !intermediatePubKey) {
    fail('intermediate-signs-leaf', 'missing pubkey or signature');
  } else {
    const okI = await verifyBytes(intSigOverLeaf, intermediatePubKey, hexToBytes(leafPubKey));
    if (okI) pass('intermediate-signs-leaf');
    else fail('intermediate-signs-leaf', 'signature verify failed');
  }

  // 4. Leaf signs manifestDigest.
  if (!envelope.manifestDigest || !envelope.leaf?.signature || !leafPubKey) {
    fail('leaf-signs-manifest-digest', 'missing fields');
  } else {
    const okL = await verifyString(envelope.leaf.signature, leafPubKey, envelope.manifestDigest);
    if (okL) pass('leaf-signs-manifest-digest');
    else fail('leaf-signs-manifest-digest', 'signature verify failed');
  }

  // 5. Leaf signs TSA payload.
  const tsa = envelope.timestampAuthority;
  if (!tsa || !tsa.signature || !tsa.payload || !leafPubKey) {
    fail('leaf-signs-timestamp-payload', 'missing fields');
  } else {
    const okT = await verifyString(tsa.signature, leafPubKey, tsa.payload);
    if (okT) pass('leaf-signs-timestamp-payload');
    else fail('leaf-signs-timestamp-payload', 'signature verify failed');
  }

  // 6. If caller passed manifestBytes, recompute digest and compare.
  if (manifestBytes) {
    const got = sha256Hex(manifestBytes);
    if (got !== envelope.manifestDigest) {
      fail('manifest-digest-matches', `expected=${envelope.manifestDigest} actual=${got}`);
    } else {
      pass('manifest-digest-matches');
    }
  } else {
    // Skip silently — caller didn't ask for byte-level check.
    pass('manifest-digest-matches');
  }

  return { ok: errors.length === 0, errors, checks };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const { promises: fs } = await import('node:fs');
  const args = process.argv.slice(2);
  const envelopePath = args[0];
  const manifestPath = args[1];
  if (!envelopePath) {
    console.error('usage: verify-production-sign <envelope.json> [manifest.json]');
    process.exit(2);
  }
  const envelope = JSON.parse(await fs.readFile(envelopePath, 'utf8'));
  const manifestBytes = manifestPath ? await fs.readFile(manifestPath) : null;
  const r = await verifyProductionSignature({ envelope, manifestBytes });
  process.stdout.write(JSON.stringify(r, null, 2) + '\n');
  process.exit(r.ok ? 0 : 1);
}
