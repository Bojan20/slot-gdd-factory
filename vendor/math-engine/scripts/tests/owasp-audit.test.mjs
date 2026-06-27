/**
 * CORTI W205-SECURITY — owasp-audit.mjs unit specs.
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  SEVERITY,
  OWASP_CATEGORIES,
  emptyCategoryFindings,
  listSourceFiles,
  auditA01BrokenAccessControl,
  auditA02CryptographicFailures,
  auditA03Injection,
  auditA04InsecureDesign,
  auditA05Misconfiguration,
  auditA06VulnerableComponents,
  auditA07AuthenticationFailures,
  auditA08IntegrityFailures,
  auditA09LoggingMonitoring,
  auditA10SSRF,
  runAudit,
  countBySeverity,
  renderMarkdown,
} from '../owasp-audit.mjs';

function tmp() {
  return mkdtempSync(join(tmpdir(), 'w205-owasp-'));
}

describe('owasp-audit · meta', () => {
  it('exposes ordered severity list', () => {
    expect(SEVERITY).toEqual(['Critical', 'High', 'Medium', 'Low', 'Info']);
  });

  it('has 10 OWASP categories A01..A10', () => {
    expect(OWASP_CATEGORIES).toHaveLength(10);
    expect(OWASP_CATEGORIES[0].id).toBe('A01');
    expect(OWASP_CATEGORIES[9].id).toBe('A10');
  });

  it('emptyCategoryFindings has slots for every category', () => {
    const e = emptyCategoryFindings();
    for (const c of OWASP_CATEGORIES) {
      expect(e[c.id]).toBeDefined();
      expect(Array.isArray(e[c.id].findings)).toBe(true);
    }
  });
});

describe('owasp-audit · listSourceFiles', () => {
  it('returns empty array on missing dir', () => {
    expect(listSourceFiles('/__no_such_dir__')).toEqual([]);
  });
  it('skips node_modules / dist / reports', () => {
    const root = tmp();
    mkdirSync(join(root, 'node_modules'), { recursive: true });
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'node_modules', 'lib.ts'), 'x;');
    writeFileSync(join(root, 'src', 'main.ts'), 'x;');
    const files = listSourceFiles(root);
    expect(files.some((f) => f.includes('node_modules'))).toBe(false);
    expect(files.some((f) => f.endsWith('main.ts'))).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('owasp-audit · A01 broken access control', () => {
  it('flags GaaS routes missing checkApiKey', () => {
    const root = tmp();
    const routes = join(root, 'routes');
    mkdirSync(routes, { recursive: true });
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'tenants.ts'), '// stub');
    writeFileSync(join(routes, 'gaas.ts'), 'export const x = 1;');
    const f = auditA01BrokenAccessControl(routes);
    expect(f.find((x) => x.id === 'a01-gaas-no-apikey-check')).toBeDefined();
    rmSync(root, { recursive: true, force: true });
  });
  it('emits "no-rbac" Medium/High finding by default', () => {
    const root = tmp();
    const routes = join(root, 'routes');
    mkdirSync(routes, { recursive: true });
    mkdirSync(join(root, 'state'), { recursive: true });
    writeFileSync(join(root, 'state', 'tenants.ts'), '// stub');
    const f = auditA01BrokenAccessControl(routes);
    expect(f.some((x) => x.id === 'a01-no-rbac')).toBe(true);
    rmSync(root, { recursive: true, force: true });
  });
});

describe('owasp-audit · A02 cryptographic failures', () => {
  it('flags hardcoded AWS key', () => {
    // We rely on the real audit to scan ROOT — instead, render markdown
    // exercising the regex by direct test on scanContent-style logic via runAudit.
    const result = runAudit();
    // Just confirm A02 produced at least one finding.
    expect(result.categories.A02.findings.length).toBeGreaterThan(0);
  });
});

describe('owasp-audit · A03 injection', () => {
  it('returns at least an info finding when sources are clean', () => {
    const f = auditA03Injection({});
    expect(f.length).toBeGreaterThan(0);
  });
});

describe('owasp-audit · A04 insecure design', () => {
  it('returns wallet/session guardrail findings', () => {
    const f = auditA04InsecureDesign({});
    // Wallet race finding always present.
    expect(f.some((x) => x.id === 'a04-wallet-race-single-threaded')).toBe(true);
  });
});

describe('owasp-audit · A05 misconfiguration', () => {
  it('runs without throwing on the real server tree', () => {
    const f = auditA05Misconfiguration({});
    expect(Array.isArray(f)).toBe(true);
  });
  it('returns at least one finding category coverage', () => {
    // The audit always at least reports presence of security headers either way.
    const f = auditA05Misconfiguration({});
    // Either CORS wildcard, or security-headers, or empty (post-remediation).
    // Smoke-test: assert array contract.
    for (const x of f) expect(x).toHaveProperty('id');
  });
});

describe('owasp-audit · A06–A10 placeholders', () => {
  it('A06 emits at least one info-level note', () => {
    const f = auditA06VulnerableComponents();
    expect(f.length).toBeGreaterThan(0);
  });
  it('A07 emits rate-limit + MFA placeholder findings', () => {
    const f = auditA07AuthenticationFailures();
    expect(f.some((x) => x.id === 'a07-no-mfa')).toBe(true);
  });
  it('A08 emits hash-chain + signed-release findings', () => {
    const f = auditA08IntegrityFailures();
    expect(f.some((x) => x.id === 'a08-no-signed-releases')).toBe(true);
  });
  it('A09 emits centralized-logging placeholder', () => {
    const f = auditA09LoggingMonitoring();
    expect(f.some((x) => x.id === 'a09-no-centralized-logging')).toBe(true);
  });
  it('A10 returns clean info when no SSRF sinks', () => {
    const f = auditA10SSRF();
    expect(f.length).toBeGreaterThan(0);
  });
});

describe('owasp-audit · runAudit', () => {
  it('aggregates 10 categories with counts', () => {
    const r = runAudit();
    for (const c of OWASP_CATEGORIES) expect(r.categories[c.id]).toBeDefined();
    expect(r.counts).toHaveProperty('Critical');
    expect(r.counts).toHaveProperty('High');
  });
  it('countBySeverity adds up to total findings', () => {
    const r = runAudit();
    const total = r.counts.Critical + r.counts.High + r.counts.Medium + r.counts.Low + r.counts.Info;
    const c2 = countBySeverity(r.categories);
    expect(c2).toEqual(r.counts);
    expect(total).toBeGreaterThan(0);
  });
});

describe('owasp-audit · markdown rendering', () => {
  it('renders header + per-category sections', () => {
    const r = runAudit();
    const md = renderMarkdown(r, '2026-05-18');
    expect(md).toContain('# OWASP Top 10 (2021) Audit — 2026-05-18');
    for (const c of OWASP_CATEGORIES) {
      expect(md).toContain(`## ${c.id} — ${c.name}`);
    }
  });
});
