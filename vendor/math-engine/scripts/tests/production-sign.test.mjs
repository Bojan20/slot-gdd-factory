/**
 * W213 Faza 700.1 — production signing chain tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

import {
  generateChain,
  loadChain,
  signString,
  verifyString,
  verifyBytes,
  buildProductionSignature,
  timestampPayload,
  sha256Hex,
  hexToBytes,
  bytesToHex,
  PRODUCTION_SIGN_SCHEMA,
} from '../pitch/production-sign.mjs';
import {
  verifyProductionSignature,
  CHECK_NAMES,
} from '../pitch/verify-production-sign.mjs';

async function tmpKeysDir() {
  const d = resolve(tmpdir(), `prodsign-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('production-sign — chain generation', () => {
  it('generateChain writes root + intermediate + leaf + chain.json', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    for (const f of ['root.json', 'intermediate.json', 'leaf.json', 'chain.json']) {
      const data = await fs.readFile(resolve(dir, f), 'utf8');
      expect(JSON.parse(data)).toBeTruthy();
    }
    expect(r.chain.schema).toBe(PRODUCTION_SIGN_SCHEMA);
  });

  it('loadChain reads back the same keys', async () => {
    const dir = await tmpKeysDir();
    const a = await generateChain({ dir });
    const b = await loadChain({ dir });
    expect(b.root.publicKeyHex).toBe(a.root.publicKeyHex);
    expect(b.intermediate.publicKeyHex).toBe(a.intermediate.publicKeyHex);
    expect(b.leaf.publicKeyHex).toBe(a.leaf.publicKeyHex);
  });

  it('generated keys are 64-hex (32 bytes) public and private', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    for (const k of [r.root, r.intermediate, r.leaf]) {
      expect(k.privateKeyHex.length).toBe(64);
      expect(k.publicKeyHex.length).toBe(64);
    }
  });

  it('chain.json contains rootSignature over intermediate pubkey', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    const ok = await verifyBytes(
      r.chain.intermediate.rootSignature,
      r.chain.root.publicKeyHex,
      hexToBytes(r.chain.intermediate.publicKeyHex)
    );
    expect(ok).toBe(true);
  });

  it('chain.json contains intermediateSignature over leaf pubkey', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    const ok = await verifyBytes(
      r.chain.leaf.intermediateSignature,
      r.chain.intermediate.publicKeyHex,
      hexToBytes(r.chain.leaf.publicKeyHex)
    );
    expect(ok).toBe(true);
  });
});

describe('production-sign — signing helpers', () => {
  it('signString + verifyString round-trip with leaf key', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    const sig = await signString(r.leaf.privateKeyHex, 'hello');
    expect(await verifyString(sig, r.leaf.publicKeyHex, 'hello')).toBe(true);
    expect(await verifyString(sig, r.leaf.publicKeyHex, 'tampered')).toBe(false);
  });

  it('timestampPayload returns TSA record signed by leaf', async () => {
    const dir = await tmpKeysDir();
    const r = await generateChain({ dir });
    const t = await timestampPayload(r.leaf.privateKeyHex, 'msg');
    expect(t.tsa).toBeTruthy();
    expect(t.signature.length).toBe(128);
    expect(await verifyString(t.signature, r.leaf.publicKeyHex, t.payload)).toBe(true);
  });
});

describe('production-sign — envelope build + verify', () => {
  it('end-to-end verifyProductionSignature returns ok=true', async () => {
    const dir = await tmpKeysDir();
    const chain = await generateChain({ dir });
    const manifestBytes = Buffer.from(JSON.stringify({ files: [] }, null, 2));
    const envelope = await buildProductionSignature({
      chain, manifestBytes, generatedAt: '2099-01-01T00:00:00.000Z',
    });
    const r = await verifyProductionSignature({ envelope, manifestBytes });
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    for (const name of CHECK_NAMES) expect(r.checks[name]?.ok).toBe(true);
  });

  it('detects tampered manifest bytes', async () => {
    const dir = await tmpKeysDir();
    const chain = await generateChain({ dir });
    const original = Buffer.from('original');
    const envelope = await buildProductionSignature({ chain, manifestBytes: original });
    const tampered = Buffer.from('tampered');
    const r = await verifyProductionSignature({ envelope, manifestBytes: tampered });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/manifest-digest-matches/);
  });

  it('detects tampered leaf signature', async () => {
    const dir = await tmpKeysDir();
    const chain = await generateChain({ dir });
    const manifestBytes = Buffer.from('payload');
    const envelope = await buildProductionSignature({ chain, manifestBytes });
    // Flip first byte of leaf signature.
    const old = envelope.leaf.signature;
    envelope.leaf.signature =
      (old[0] === '0' ? '1' : '0') + old.slice(1);
    const r = await verifyProductionSignature({ envelope, manifestBytes });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/leaf-signs-manifest-digest/);
  });

  it('detects tampered intermediate→leaf link', async () => {
    const dir = await tmpKeysDir();
    const chain = await generateChain({ dir });
    const manifestBytes = Buffer.from('payload');
    const envelope = await buildProductionSignature({ chain, manifestBytes });
    envelope.intermediate.signatureOverLeafPubKey =
      '00' + envelope.intermediate.signatureOverLeafPubKey.slice(2);
    const r = await verifyProductionSignature({ envelope, manifestBytes });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/intermediate-signs-leaf/);
  });

  it('detects pinned trust-anchor mismatch', async () => {
    const dir = await tmpKeysDir();
    const chain = await generateChain({ dir });
    const manifestBytes = Buffer.from('payload');
    const envelope = await buildProductionSignature({ chain, manifestBytes });
    const r = await verifyProductionSignature({
      envelope, manifestBytes, trustedRootPubKey: '00'.repeat(32),
    });
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/root-trust-anchor-present/);
  });

  it('hexToBytes / bytesToHex round-trips', () => {
    const orig = '0123456789abcdef'.repeat(4);
    expect(bytesToHex(hexToBytes(orig))).toBe(orig);
  });

  it('sha256Hex stable for empty buffer', () => {
    expect(sha256Hex(Buffer.alloc(0)))
      .toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });
});
