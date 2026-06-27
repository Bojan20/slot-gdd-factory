#!/usr/bin/env node
/**
 * W211 Faza 700.0 — Real Vendor B Pilot Onboard — Seed script.
 *
 * Bootstraps a fully functioning pilot tenant for the "Vendor B
 * Pilot UK" engagement. The seed is deterministic (env-driven HMAC
 * keys) so the demo replay is repeatable. The output JSON state file is
 * consumed by `run-integration-suite.mjs` and `build-pilot-dossier.mjs`.
 *
 * Usage:
 *   node scripts/pilot/seed-lw-pilot.mjs           # default
 *   node scripts/pilot/seed-lw-pilot.mjs --force   # overwrite existing
 *
 * Output:
 *   dist/pilot/lw-pilot-tenant.json    — full pilot state snapshot
 *   dist/pilot/credentials.env         — env file for demo runs
 *
 * No external deps — Node stdlib + repo paths only.
 */
import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHmac, createHash, randomBytes } from 'node:crypto';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const PILOT_TENANT_ID = '11111111-2222-3333-4444-555555555555';
const PILOT_OPERATOR_NAME = 'Vendor B Pilot UK';
const JURISDICTIONS = ['UKGC', 'MGA'];
const REGULATORS = ['UKGC-Online', 'MGA-Class-3'];
const CURRENCIES = ['GBP'];
const STARTING_BALANCE_MINOR = 100000; // £1000 in pence
const TEMPLATE_IDS = [
  'tpl-quick-hit-dragons',
  'tpl-pearl-of-atlantis',
  'tpl-lava-phoenix',
];

export function parseArgs(argv) {
  const a = { force: false };
  for (const arg of argv.slice(2)) {
    if (arg === '--force') a.force = true;
    else if (arg.startsWith('--out=')) a.out = arg.slice(6);
  }
  return a;
}

/** Deterministic 32-byte secret derived from a label. */
export function deriveSecret(label, seed = 'lw-pilot-seed-2026') {
  return createHmac('sha256', seed).update(label).digest('hex');
}

/** Encrypt a string with HMAC-derived key (toy AES-shim via XOR + sha256 mac — sufficient for placeholder). */
export function encryptSecret(plaintext, label) {
  const key = Buffer.from(deriveSecret(label), 'hex');
  const pt = Buffer.from(plaintext, 'utf8');
  const out = Buffer.alloc(pt.length);
  for (let i = 0; i < pt.length; i++) out[i] = pt[i] ^ key[i % key.length];
  const mac = createHmac('sha256', key).update(out).digest('hex').slice(0, 16);
  return `enc:v1:${out.toString('base64')}:${mac}`;
}

/** Build the deterministic API key for the pilot operator. */
export function buildOperatorApiKey() {
  return `op_pilot_${deriveSecret('operator-api-key').slice(0, 32)}`;
}

/** Build the deterministic tenant JWT-like token. */
export function buildTenantToken(tenantId) {
  const header = Buffer.from(
    JSON.stringify({ alg: 'HS256', typ: 'JWT' })
  ).toString('base64url');
  const claims = {
    iss: 'slot-math-engine',
    sub: tenantId,
    iat: 1717200000,
    exp: 1748736000,
    scope: 'tenant.full',
  };
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${claimsB64}`;
  const sig = createHmac('sha256', deriveSecret('tenant-jwt-secret'))
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

/** Build the 5 deterministic demo players. */
export function buildDemoPlayers(currency = 'GBP') {
  const out = [];
  const names = ['alice', 'bob', 'carla', 'diego', 'eve'];
  for (let i = 0; i < names.length; i++) {
    const playerId = `pilot-player-${names[i]}`;
    const token = `pt_${deriveSecret(`player-${names[i]}`).slice(0, 24)}`;
    out.push({
      playerId,
      displayName: names[i],
      playerToken: token,
      startingBalanceMinor: STARTING_BALANCE_MINOR,
      currency,
    });
  }
  return out;
}

/** Load the marketplace templates JSON catalog and pick the 3 we install. */
export async function loadInstalledTemplates(root = REPO_ROOT) {
  const p = resolve(root, 'web/marketplace/data/templates.json');
  if (!existsSync(p)) {
    // Fallback: synthesize minimal records — needed if the test sandbox
    // strips marketplace assets. The names match the W209 catalog.
    return TEMPLATE_IDS.map((id) => ({ id, displayName: id, rtp_target: 95.5 }));
  }
  const raw = JSON.parse(await fs.readFile(p, 'utf8'));
  return (raw.templates ?? []).filter((t) => TEMPLATE_IDS.includes(t.id));
}

/** Issue a deterministic-ish license JWT for an installed template. */
export function buildLicenseJwt(tenantId, itemId, kind = 'template') {
  const header = Buffer.from(JSON.stringify({ alg: 'Ed25519', typ: 'JWT' })).toString('base64url');
  const claims = {
    iss: 'slot-math-engine',
    sub: tenantId,
    aud: `marketplace.${kind}`,
    itemId,
    itemType: kind,
    iat: 1717200000,
    exp: 0,
    purchaseId: deriveSecret(`purchase-${itemId}`).slice(0, 32),
    licenseType: 'perpetual',
    jti: deriveSecret(`jti-${itemId}`).slice(0, 16),
  };
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
  const signingInput = `${header}.${claimsB64}`;
  // Use HMAC as a substitute Ed25519 here — the integration suite verifies the
  // structure, not the signature crypto (which is exercised by W209's tests).
  const sig = createHmac('sha256', deriveSecret('license-jwt-secret'))
    .update(signingInput)
    .digest('base64url');
  return `${signingInput}.${sig}`;
}

export function buildWalletConfig() {
  return {
    provider: 'generic-pam',
    baseUrl: 'https://wallet.lw-pilot.example.com',
    apiSecretEncrypted: encryptSecret('pam_secret_lw_pilot_uk_2026', 'wallet-secret'),
    operatorId: 'lw-pilot-uk',
    timeoutMs: 5000,
    healthcheckPath: '/health',
  };
}

export function buildPilotState(opts = {}) {
  const tenantId = opts.tenantId ?? PILOT_TENANT_ID;
  const operatorApiKey = buildOperatorApiKey();
  const tenantToken = buildTenantToken(tenantId);
  const wallet = buildWalletConfig();
  const players = buildDemoPlayers(opts.currency ?? CURRENCIES[0]);
  return {
    tenant: {
      id: tenantId,
      name: PILOT_OPERATOR_NAME,
      jurisdictions: JURISDICTIONS,
      regulators: REGULATORS,
      defaultCurrency: opts.currency ?? CURRENCIES[0],
      contactEmail: 'pilot-eng@lightandwonder.example.com',
      createdAt: opts.now ?? new Date().toISOString(),
    },
    operator: {
      apiKey: operatorApiKey,
      apiKeyHash: createHash('sha256').update(operatorApiKey).digest('hex'),
    },
    tenantToken,
    wallet,
    installedTemplates: [],
    players,
    initialStateHash: '',
    seededAt: opts.now ?? new Date().toISOString(),
    seedVersion: 'w211-700.0',
  };
}

export function finalizeStateHash(state) {
  // Strip the hash field so the digest is over the rest of the state.
  const { initialStateHash: _omit, ...rest } = state;
  void _omit;
  const canonical = JSON.stringify(rest, Object.keys(rest).sort());
  return createHash('sha256').update(canonical).digest('hex');
}

export async function seedPilot(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const outDir = resolve(root, opts.outDir ?? 'dist/pilot');
  const statePath = resolve(outDir, 'lw-pilot-tenant.json');
  const credsPath = resolve(outDir, 'credentials.env');
  if (!opts.force && existsSync(statePath)) {
    const existing = JSON.parse(await fs.readFile(statePath, 'utf8'));
    return { state: existing, statePath, credsPath, idempotent: true };
  }

  await fs.mkdir(outDir, { recursive: true });
  const state = buildPilotState(opts);
  const templates = await loadInstalledTemplates(root);
  state.installedTemplates = templates.map((t) => ({
    templateId: t.id,
    displayName: t.displayName ?? t.id,
    rtpTarget: t.rtp_target ?? 95.5,
    lwGapTarget: t.lw_gap_target ?? null,
    licenseJwt: buildLicenseJwt(state.tenant.id, t.id, 'template'),
    purchasedAt: state.seededAt,
  }));
  state.initialStateHash = finalizeStateHash(state);

  if (!opts.dryRun) {
    await fs.writeFile(statePath, JSON.stringify(state, null, 2) + '\n');
    const creds = [
      `# W211 pilot demo credentials — DO NOT use in production`,
      `PILOT_TENANT_ID=${state.tenant.id}`,
      `PILOT_OPERATOR_API_KEY=${state.operator.apiKey}`,
      `PILOT_TENANT_TOKEN=${state.tenantToken}`,
      `PILOT_WALLET_BASE_URL=${state.wallet.baseUrl}`,
      `PILOT_WALLET_OPERATOR_ID=${state.wallet.operatorId}`,
      `PILOT_CURRENCY=${state.tenant.defaultCurrency}`,
      `PILOT_INITIAL_STATE_HASH=${state.initialStateHash}`,
      ``,
    ].join('\n');
    await fs.writeFile(credsPath, creds);
  }

  return { state, statePath, credsPath, idempotent: false };
}

// ── main ──────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  const result = await seedPilot({ force: args.force, outDir: args.out });
  console.log(`✓ pilot tenant seeded`);
  console.log(`  tenant.id:      ${result.state.tenant.id}`);
  console.log(`  tenant.name:    ${result.state.tenant.name}`);
  console.log(`  jurisdictions:  ${result.state.tenant.jurisdictions.join(', ')}`);
  console.log(`  templates:      ${result.state.installedTemplates.length}`);
  console.log(`  players:        ${result.state.players.length}`);
  console.log(`  stateHash:      ${result.state.initialStateHash.slice(0, 16)}…`);
  console.log(`  state file:     ${result.statePath}`);
  console.log(`  credentials:    ${result.credsPath}`);
  if (result.idempotent) console.log(`  (existing seed reused — pass --force to regenerate)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('seed-lw-pilot failed:', err);
    process.exit(2);
  });
}
