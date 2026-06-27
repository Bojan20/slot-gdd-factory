/**
 * CORTI W207-DOCS - regression test for the docs auto-generator.
 *
 * Runs the generator with vitest's `expect` smoke-tests so a malformed
 * route table or an SDK-export rename doesn't silently destroy the docs
 * site at PR time.
 */

import { describe, it, expect } from 'vitest';
import { execSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GEN_API = resolve(ROOT, 'web/docs/content/generated/api-routes.md');
const GEN_SDK = resolve(ROOT, 'web/docs/content/generated/sdk-reference.md');

describe('scripts/generate-api-docs.mjs', () => {
  it('runs successfully', () => {
    execSync(`node ${resolve(ROOT, 'scripts/generate-api-docs.mjs')}`, { cwd: ROOT, stdio: 'pipe' });
    expect(existsSync(GEN_API)).toBe(true);
    expect(existsSync(GEN_SDK)).toBe(true);
  });

  it('api-routes.md contains all 10 route files', () => {
    const text = readFileSync(GEN_API, 'utf8');
    for (const f of [
      'admin.ts',
      'audit.ts',
      'cert.ts',
      'gaas.ts',
      'health.ts',
      'license.ts',
      'lobby.ts',
      'session.ts',
      'signup.ts',
      'wallet.ts',
    ]) {
      expect(text).toContain(`## ${f}`);
    }
  });

  it('sdk-reference.md contains all four SDK source files', () => {
    const text = readFileSync(GEN_SDK, 'utf8');
    for (const f of ['index.ts', 'types.ts', 'client.ts', 'kernel-author.ts']) {
      expect(text).toContain(`## sdk/${f}`);
    }
  });

  it('api-routes.md captures the GaaS spin route', () => {
    const text = readFileSync(GEN_API, 'utf8');
    expect(text).toMatch(/POST.*\/api\/gaas\/spin/);
  });
});
