#!/usr/bin/env node
/**
 * W213 Faza 700.1 — Production signing chain.
 *
 * Three-level Ed25519 signing tree:
 *
 *    root  (offline; simulated by `dist/pitch/keys/root.json`)
 *      │ signs
 *      ▼
 *    intermediate (`dist/pitch/keys/intermediate.json`)
 *      │ signs
 *      ▼
 *    leaf       (`dist/pitch/keys/leaf.json`)
 *      │ signs
 *      ▼
 *    MANIFEST.json (sha256 of the canonical bytes)
 *
 * On top of the chain we attach an RFC-3161-style timestamp authority
 * stub (`timestampPayload()`) that returns a `{ tsa: ..., signedAt: ... }`
 * record, also signed by the leaf key. Production deployments would
 * replace that with a call to an external TSA over HTTPS.
 *
 * Exports:
 *   - generateKey()                — returns { privateKeyHex, publicKeyHex, id }
 *   - generateChain(keysDir)       — generates + persists root/intermediate/leaf
 *   - loadChain(keysDir)           — reads the three key files; throws if missing
 *   - signPayload(leafKp, payload) — { signature, publicKey, signedAt, signer }
 *   - buildProductionSignature({ chain, manifestBytes, generatedAt })
 *                                  → full signed envelope (root → leaf chain)
 *   - timestampPayload(leafKp, msg) → TSA stub record signed by leaf
 *
 * Pure Node stdlib + @noble/ed25519 + @noble/hashes/sha2.
 */

import { promises as fs, existsSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

export const DEFAULT_KEYS_DIR = resolve(REPO_ROOT, 'dist/pitch/keys');

export const PRODUCTION_SIGN_SCHEMA = 'pitch-production-sign-v1';

// ─── tiny hex helpers ────────────────────────────────────────────────────

export function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
export function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// Lazy noble loader so tests can stub for offline runs.
async function loadEd() {
  const ed = await import('@noble/ed25519');
  const { sha512 } = await import('@noble/hashes/sha2.js');
  if (!ed.hashes.sha512) ed.hashes.sha512 = (msg) => sha512(msg);
  return ed;
}

// ─── key generation / persistence ────────────────────────────────────────

export async function generateKey(label = 'unknown') {
  const ed = await loadEd();
  const priv = ed.utils.randomSecretKey();
  const pub = ed.getPublicKey(priv);
  return {
    id: `${label}-${randomBytes(4).toString('hex')}`,
    label,
    privateKeyHex: bytesToHex(priv),
    publicKeyHex: bytesToHex(pub),
    createdAt: new Date().toISOString(),
  };
}

async function writeKey(file, kp) {
  await fs.mkdir(dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(kp, null, 2) + '\n', { mode: 0o600 });
}

export async function generateChain(opts = {}) {
  const dir = resolve(opts.dir ?? DEFAULT_KEYS_DIR);
  const ed = await loadEd();
  const root = await generateKey('root');
  const intermediate = await generateKey('intermediate');
  const leaf = await generateKey('leaf');

  // Root signs intermediate's public key (binding statement).
  const rootSigOverInt = ed.sign(hexToBytes(intermediate.publicKeyHex), hexToBytes(root.privateKeyHex));
  // Intermediate signs leaf's public key.
  const intSigOverLeaf = ed.sign(hexToBytes(leaf.publicKeyHex), hexToBytes(intermediate.privateKeyHex));

  const chain = {
    schema: PRODUCTION_SIGN_SCHEMA,
    createdAt: new Date().toISOString(),
    root: { id: root.id, publicKeyHex: root.publicKeyHex, createdAt: root.createdAt },
    intermediate: {
      id: intermediate.id,
      publicKeyHex: intermediate.publicKeyHex,
      createdAt: intermediate.createdAt,
      rootSignature: bytesToHex(rootSigOverInt),
    },
    leaf: {
      id: leaf.id,
      publicKeyHex: leaf.publicKeyHex,
      createdAt: leaf.createdAt,
      intermediateSignature: bytesToHex(intSigOverLeaf),
    },
  };

  if (!opts.dryRun) {
    await writeKey(join(dir, 'root.json'), root);
    await writeKey(join(dir, 'intermediate.json'), intermediate);
    await writeKey(join(dir, 'leaf.json'), leaf);
    await writeKey(join(dir, 'chain.json'), chain);
  }
  return { dir, root, intermediate, leaf, chain };
}

export async function loadChain(opts = {}) {
  const dir = resolve(opts.dir ?? DEFAULT_KEYS_DIR);
  const requireFile = async (n) => {
    const p = join(dir, n);
    if (!existsSync(p)) throw new Error(`production-sign: missing key file ${p} (run generateChain first)`);
    return JSON.parse(await fs.readFile(p, 'utf8'));
  };
  const root = await requireFile('root.json');
  const intermediate = await requireFile('intermediate.json');
  const leaf = await requireFile('leaf.json');
  const chain = await requireFile('chain.json');
  return { dir, root, intermediate, leaf, chain };
}

// ─── signing helpers ─────────────────────────────────────────────────────

export async function signString(privateKeyHex, s) {
  const ed = await loadEd();
  const sig = ed.sign(new TextEncoder().encode(s), hexToBytes(privateKeyHex));
  return bytesToHex(sig);
}

export async function verifyString(signatureHex, publicKeyHex, s) {
  const ed = await loadEd();
  try {
    return ed.verify(hexToBytes(signatureHex), new TextEncoder().encode(s), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export async function verifyBytes(signatureHex, publicKeyHex, bytes) {
  const ed = await loadEd();
  try {
    return ed.verify(hexToBytes(signatureHex), bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

// ─── timestamp authority stub (RFC-3161-style) ───────────────────────────

export async function timestampPayload(leafPrivHex, message, opts = {}) {
  const tsaName = opts.tsaName ?? 'slot-math-engine-tsa-stub';
  const ts = opts.now ?? new Date().toISOString();
  const messageDigest = sha256Hex(Buffer.from(message));
  const payload = `tsa=${tsaName};ts=${ts};digest=${messageDigest}`;
  const sig = await signString(leafPrivHex, payload);
  return {
    tsa: tsaName,
    timestampedAt: ts,
    messageDigest,
    payload,
    signature: sig,
  };
}

// ─── full production-sign envelope build ─────────────────────────────────

export async function buildProductionSignature(opts) {
  const { chain, manifestBytes, generatedAt } = opts;
  if (!chain || !chain.leaf || !chain.intermediate || !chain.root) {
    throw new Error('buildProductionSignature: chain (root/intermediate/leaf) is required');
  }
  const digestHex = sha256Hex(manifestBytes);
  const leafSig = await signString(chain.leaf.privateKeyHex, digestHex);
  const tsa = await timestampPayload(chain.leaf.privateKeyHex, digestHex, { now: generatedAt });

  return {
    schema: PRODUCTION_SIGN_SCHEMA,
    algorithm: 'ed25519',
    digestAlgorithm: 'sha256',
    manifestDigest: digestHex,
    signedAt: generatedAt ?? new Date().toISOString(),
    leaf: {
      publicKey: chain.leaf.publicKeyHex,
      signature: leafSig,
      keyId: chain.leaf.id,
    },
    intermediate: {
      publicKey: chain.intermediate.publicKeyHex,
      // Intermediate's sig is over the leaf's public key — proves chain.
      signatureOverLeafPubKey: chain.chain.leaf.intermediateSignature,
      keyId: chain.intermediate.id,
    },
    root: {
      publicKey: chain.root.publicKeyHex,
      // Root's sig is over the intermediate's public key.
      signatureOverIntermediatePubKey: chain.chain.intermediate.rootSignature,
      keyId: chain.root.id,
    },
    timestampAuthority: tsa,
  };
}

// ─── CLI ─────────────────────────────────────────────────────────────────

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2);
  const cmd = args[0] ?? 'help';
  if (cmd === 'gen-keys') {
    const dirArg = args.find((a) => a.startsWith('--dir='));
    generateChain({ dir: dirArg ? dirArg.slice(6) : undefined })
      .then((r) => {
        console.log('production-sign: chain generated at', r.dir);
        console.log('  root:        ', r.root.id, r.root.publicKeyHex);
        console.log('  intermediate:', r.intermediate.id, r.intermediate.publicKeyHex);
        console.log('  leaf:        ', r.leaf.id, r.leaf.publicKeyHex);
      })
      .catch((err) => {
        console.error('production-sign: gen-keys failed', err.message);
        process.exit(1);
      });
  } else if (cmd === 'help' || cmd === '--help') {
    process.stdout.write(
      'production-sign — three-level Ed25519 signing chain\n\n' +
        'Subcommands:\n' +
        '  gen-keys [--dir=<dir>]   Generate root + intermediate + leaf keys.\n' +
        '\n'
    );
  } else {
    console.error('production-sign: unknown command', cmd);
    process.exit(2);
  }
}
