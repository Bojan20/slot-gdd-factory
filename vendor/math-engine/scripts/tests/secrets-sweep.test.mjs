/**
 * CORTI W205-SECURITY — secrets-sweep.mjs unit specs.
 */

import { describe, it, expect } from 'vitest';
import {
  SECRET_PATTERNS,
  shouldScanFile,
  scanContent,
  redact,
  aggregateHits,
  isAllowlistedPlaceholder,
  runSweep,
  renderMarkdown,
  ensureGitignoreEntries,
} from '../secrets-sweep.mjs';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('secrets-sweep · pattern coverage', () => {
  it('includes aws/github/openai/private-key/db patterns', () => {
    const ids = SECRET_PATTERNS.map((p) => p.id);
    for (const k of ['aws-access-key', 'github-token', 'openai-key', 'pem-private-key', 'db-conn-postgres']) {
      expect(ids).toContain(k);
    }
  });

  it('every pattern has a severity in the standard set', () => {
    const allowed = new Set(['Critical', 'High', 'Medium', 'Low']);
    for (const p of SECRET_PATTERNS) expect(allowed.has(p.severity)).toBe(true);
  });
});

describe('secrets-sweep · shouldScanFile', () => {
  it('skips node_modules / dist / reports', () => {
    expect(shouldScanFile('node_modules/foo/index.js')).toBe(false);
    expect(shouldScanFile('dist/main.js')).toBe(false);
    expect(shouldScanFile('reports/security/foo.md')).toBe(false);
  });
  it('skips binary extensions and package-lock', () => {
    expect(shouldScanFile('public/logo.png')).toBe(false);
    expect(shouldScanFile('package-lock.json')).toBe(false);
  });
  it('scans regular source files', () => {
    expect(shouldScanFile('server/index.ts')).toBe(true);
  });
});

describe('secrets-sweep · scanContent', () => {
  it('detects AWS access key', () => {
    const { hits } = scanContent('const k = "AKIA' + 'ABCDEFGHIJKLMNOP' + '";');
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('aws-access-key');
    expect(hits[0].severity).toBe('Critical');
  });

  it('detects GitHub PAT', () => {
    const tok = 'ghp_' + 'a'.repeat(36);
    const { hits } = scanContent(`X=${tok}`);
    expect(hits.length).toBe(1);
    expect(hits[0].id).toBe('github-token');
  });

  it('detects PEM private key header', () => {
    const { hits } = scanContent('-----BEGIN RSA PRIVATE KEY-----');
    expect(hits[0].id).toBe('pem-private-key');
  });

  it('redacts excerpt', () => {
    const tok = 'ghp_' + 'b'.repeat(36);
    const r = redact(tok);
    expect(r).not.toContain(tok.slice(4, 30));
    expect(r).toContain('len=');
  });

  it('records file + line numbers', () => {
    const src = ['line1', 'line2', '-----BEGIN PRIVATE KEY-----'].join('\n');
    const { hits } = scanContent(src, 'foo.ts');
    expect(hits[0].file).toBe('foo.ts');
    expect(hits[0].line).toBe(3);
  });

  it('clean content yields no hits', () => {
    const { hits } = scanContent('// just a normal comment\nexport const x = 1;\n');
    expect(hits).toEqual([]);
  });
});

describe('secrets-sweep · allowlist', () => {
  it('allowlists docker-compose dev postgres placeholder', () => {
    expect(isAllowlistedPlaceholder('db-conn-postgres',
      'DATABASE_URL: postgres://postgres:postgres@postgres:5432/sme',
      'docker-compose.yml')).toBe(true);
  });
  it('does not allowlist real-looking creds in source code', () => {
    expect(isAllowlistedPlaceholder('db-conn-postgres',
      'const u = "postgres://prod:P4ss@db.example.com/main";',
      'server/state/wallet.ts')).toBe(false);
  });
});

describe('secrets-sweep · aggregateHits', () => {
  it('counts by severity', () => {
    const c = aggregateHits([
      { severity: 'Critical' }, { severity: 'Critical' }, { severity: 'High' },
    ]);
    expect(c.Critical).toBe(2);
    expect(c.High).toBe(1);
    expect(c.Medium).toBe(0);
  });
});

describe('secrets-sweep · runSweep + markdown', () => {
  it('runSweep on a clean tmp tree returns 0 hits', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w205-sweep-'));
    writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n');
    const r = runSweep({ cwd: dir, files: ['a.ts'] });
    expect(r.hits).toEqual([]);
    expect(r.scannedCount).toBe(1);
    rmSync(dir, { recursive: true, force: true });
  });

  it('renderMarkdown emits "No secrets detected." when clean', () => {
    const md = renderMarkdown({ scannedCount: 1, hits: [], counts: { Critical: 0, High: 0, Medium: 0, Low: 0 } }, '2026-05-18');
    expect(md).toContain('No secrets detected.');
  });
});

describe('secrets-sweep · ensureGitignoreEntries', () => {
  it('appends missing entries idempotently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w205-gi-'));
    const p = join(dir, '.gitignore');
    writeFileSync(p, '.env\n');
    const r1 = ensureGitignoreEntries(p, ['.env.local']);
    expect(r1.changed).toBe(true);
    expect(readFileSync(p, 'utf8')).toContain('.env.local');
    const r2 = ensureGitignoreEntries(p, ['.env.local']);
    expect(r2.changed).toBe(false);
    rmSync(dir, { recursive: true, force: true });
  });
});
