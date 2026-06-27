/**
 * W211 Faza 700.0 — Pilot seed script tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import {
  seedPilot,
  parseArgs,
  deriveSecret,
  encryptSecret,
  buildOperatorApiKey,
  buildTenantToken,
  buildDemoPlayers,
  buildPilotState,
  buildLicenseJwt,
  finalizeStateHash,
} from '../pilot/seed-lw-pilot.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function mkTmp(label) {
  const d = resolve(tmpdir(), `pilot-seed-${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('pilot seed — pure helpers', () => {
  it('parseArgs handles --force', () => {
    const a = parseArgs(['node', 'x', '--force']);
    expect(a.force).toBe(true);
  });

  it('parseArgs handles --out=PATH', () => {
    const a = parseArgs(['node', 'x', '--out=/tmp/xyz']);
    expect(a.out).toBe('/tmp/xyz');
  });

  it('deriveSecret is deterministic and hex', () => {
    const a = deriveSecret('hello');
    const b = deriveSecret('hello');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('encryptSecret wraps with versioned prefix + mac', () => {
    const enc = encryptSecret('shh', 'lbl');
    expect(enc).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[0-9a-f]{16}$/);
  });

  it('buildOperatorApiKey carries identifiable prefix', () => {
    expect(buildOperatorApiKey()).toMatch(/^op_pilot_[0-9a-f]{32}$/);
  });

  it('buildTenantToken is a three-part jwt', () => {
    const tok = buildTenantToken('11111111-2222-3333-4444-555555555555');
    expect(tok.split('.').length).toBe(3);
  });

  it('buildDemoPlayers returns 5 deterministic players with currency', () => {
    const players = buildDemoPlayers('GBP');
    expect(players.length).toBe(5);
    expect(players[0].currency).toBe('GBP');
    expect(players[0].playerId).toBe('pilot-player-alice');
    expect(players[0].playerToken).toMatch(/^pt_[0-9a-f]{24}$/);
  });

  it('buildLicenseJwt produces a 3-part token with tenant subject', () => {
    const jwt = buildLicenseJwt('tenantA', 'tpl-x', 'template');
    const parts = jwt.split('.');
    expect(parts.length).toBe(3);
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    expect(claims.sub).toBe('tenantA');
    expect(claims.itemId).toBe('tpl-x');
    expect(claims.aud).toBe('marketplace.template');
  });

  it('buildPilotState produces a complete shape', () => {
    const s = buildPilotState({ tenantId: 't1' });
    expect(s.tenant.id).toBe('t1');
    expect(s.tenant.jurisdictions).toContain('UKGC');
    expect(s.players.length).toBe(5);
    expect(s.wallet.provider).toBe('generic-pam');
  });

  it('finalizeStateHash is a 64-char hex digest', () => {
    const s = buildPilotState({ tenantId: 't1' });
    const h = finalizeStateHash(s);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('pilot seed — file output + idempotency', () => {
  it('writes state and credentials files', async () => {
    const dir = await mkTmp('write');
    const res = await seedPilot({
      root: REPO_ROOT,
      outDir: dir, // absolute path → resolve(root, dir) = dir
      force: true,
    });
    expect(existsSync(res.statePath)).toBe(true);
    expect(existsSync(res.credsPath)).toBe(true);
    const state = JSON.parse(await fs.readFile(res.statePath, 'utf8'));
    expect(state.installedTemplates.length).toBeGreaterThanOrEqual(1);
    expect(state.initialStateHash).toMatch(/^[0-9a-f]{64}$/);
    const creds = await fs.readFile(res.credsPath, 'utf8');
    expect(creds).toMatch(/PILOT_TENANT_ID=/);
    expect(creds).toMatch(/PILOT_OPERATOR_API_KEY=/);
  });

  it('is idempotent — second call without --force reuses existing seed', async () => {
    const dir = await mkTmp('idem');
    const a = await seedPilot({ root: REPO_ROOT, outDir: dir, force: true });
    const b = await seedPilot({ root: REPO_ROOT, outDir: dir, force: false });
    expect(b.idempotent).toBe(true);
    expect(b.state.initialStateHash).toBe(a.state.initialStateHash);
  });
});
