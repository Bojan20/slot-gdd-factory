/**
 * CORTI W205-SECURITY — dependency-scan.mjs unit specs.
 */

import { describe, it, expect } from 'vitest';
import {
  MANIFEST_ROOTS,
  SEVERITIES,
  emptyBuckets,
  summariseAudit,
  aggregate,
  buildReport,
  renderMarkdown,
  runAuditAt,
} from '../dependency-scan.mjs';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('dependency-scan · meta', () => {
  it('SEVERITIES lists five npm-audit buckets', () => {
    expect(SEVERITIES).toEqual(['critical', 'high', 'moderate', 'low', 'info']);
  });

  it('emptyBuckets initializes zeros', () => {
    expect(emptyBuckets()).toEqual({ critical: 0, high: 0, moderate: 0, low: 0, info: 0 });
  });

  it('MANIFEST_ROOTS covers root + 5 web apps + sdk', () => {
    const ids = MANIFEST_ROOTS.map((m) => m.id);
    expect(ids).toContain('root');
    expect(ids).toContain('web/studio');
    expect(ids).toContain('sdk');
    expect(ids.length).toBeGreaterThanOrEqual(7);
  });
});

describe('dependency-scan · summariseAudit', () => {
  it('passes through skipped/error markers', () => {
    expect(summariseAudit({ skipped: true, reason: 'no_pkg' }).skipped).toBe(true);
    expect(summariseAudit({ error: 'boom' }).error).toBe('boom');
  });

  it('reads metadata.vulnerabilities buckets', () => {
    const json = {
      metadata: { vulnerabilities: { critical: 1, high: 2, moderate: 3, low: 4, info: 0 } },
      vulnerabilities: {},
    };
    const s = summariseAudit(json);
    expect(s.buckets).toEqual({ critical: 1, high: 2, moderate: 3, low: 4, info: 0 });
    expect(s.total).toBe(10);
  });

  it('flattens vulnerabilities into a cves array with via titles', () => {
    const json = {
      metadata: { vulnerabilities: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 } },
      vulnerabilities: {
        ajv: {
          severity: 'moderate', range: '<8',
          via: [{ title: 'ReDoS via $data', name: 'ajv' }],
          fixAvailable: { name: 'ajv', version: '8.0.0', isSemVerMajor: true },
        },
      },
    };
    const s = summariseAudit(json);
    expect(s.cves[0].name).toBe('ajv');
    expect(s.cves[0].via).toContain('ReDoS via $data');
    expect(s.cves[0].fixAvailable.semverMajor).toBe(true);
  });
});

describe('dependency-scan · aggregate + buildReport', () => {
  it('aggregates per-manifest buckets', () => {
    const per = {
      a: { summary: { buckets: { critical: 1, high: 0, moderate: 0, low: 0, info: 0 } } },
      b: { summary: { buckets: { critical: 0, high: 2, moderate: 0, low: 0, info: 0 } } },
    };
    expect(aggregate(per)).toEqual({ critical: 1, high: 2, moderate: 0, low: 0, info: 0 });
    const r = buildReport(per);
    expect(r.totals.critical).toBe(1);
  });
});

describe('dependency-scan · markdown', () => {
  it('renders totals + per-manifest table + critical/high section', () => {
    const per = {
      root: {
        summary: {
          buckets: { critical: 0, high: 1, moderate: 0, low: 0, info: 0 },
          cves: [{ name: 'pkg', severity: 'high', range: '<1', via: ['CVE'], fixAvailable: true }],
        },
      },
    };
    const md = renderMarkdown(buildReport(per), '2026-05-18');
    expect(md).toContain('# Dependency Vulnerability Scan');
    expect(md).toContain('| `root` |');
    expect(md).toContain('## CVEs (Critical/High)');
    expect(md).toContain('`pkg`');
  });
});

describe('dependency-scan · runAuditAt', () => {
  it('returns skipped marker when package.json missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'w205-dep-'));
    const r = runAuditAt(dir);
    expect(r.skipped).toBe(true);
    rmSync(dir, { recursive: true, force: true });
  });
});
