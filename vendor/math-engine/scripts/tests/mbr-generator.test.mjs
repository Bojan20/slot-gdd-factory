/**
 * W215 Faza 1300.0 Agent C — MBR generator tests.
 *
 * 15+ specs covering:
 *   * hashStr / mulberry32 determinism
 *   * buildSyntheticDataset returns sensible ranges
 *   * renderMbrMarkdown contains all 8 sections
 *   * renderMbrHtml has a valid <html> shell
 *   * renderMbrPdfStub records the tenant + month
 *   * generateMbr writes md/html/pdf files
 *   * generateMbr rejects bad --tenant and --month
 *   * Generation completes in <5 seconds for synthetic data
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  generateMbr,
  buildSyntheticDataset,
  renderMbrMarkdown,
  renderMbrHtml,
  renderMbrPdfStub,
  hashStr,
  mulberry32,
} from '../csm/generate-mbr.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

describe('hashStr + mulberry32', () => {
  it('is deterministic', () => {
    expect(hashStr('foo')).toBe(hashStr('foo'));
    const a = mulberry32(1234);
    const b = mulberry32(1234);
    for (let i = 0; i < 4; i++) expect(a()).toBe(b());
  });
  it('produces different streams for different seeds', () => {
    expect(hashStr('a')).not.toBe(hashStr('b'));
  });
});

describe('buildSyntheticDataset', () => {
  const d = buildSyntheticDataset('acme', '2026-05');
  it('is stable for identical inputs', () => {
    const d2 = buildSyntheticDataset('acme', '2026-05');
    expect(d2.games.achievedRtp).toBe(d.games.achievedRtp);
    expect(d2.finance.revenueUsd).toBe(d.finance.revenueUsd);
  });
  it('produces RTP in plausible range', () => {
    expect(d.games.targetRtp).toBeGreaterThan(0.9);
    expect(d.games.targetRtp).toBeLessThan(1.0);
    expect(Math.abs(d.games.targetRtp - d.games.achievedRtp)).toBeLessThan(0.01);
  });
  it('produces uptime in plausible range', () => {
    expect(d.ops.uptimePct).toBeGreaterThan(99);
    expect(d.ops.uptimePct).toBeLessThan(100.5);
  });
  it('produces non-negative finance numbers', () => {
    expect(d.finance.revenueUsd).toBeGreaterThanOrEqual(0);
    expect(d.finance.outstandingInvoicesUsd).toBeGreaterThanOrEqual(0);
  });
  it('produces at least 2 roadmap items', () => {
    expect(d.roadmap.length).toBeGreaterThanOrEqual(2);
  });
});

describe('renderMbrMarkdown', () => {
  const d = buildSyntheticDataset('acme', '2026-05');
  const md = renderMbrMarkdown(d);
  it('starts with the MBR title', () => {
    expect(md.startsWith('# Monthly Business Review — acme')).toBe(true);
  });
  it('contains every required section header', () => {
    expect(md).toContain('## Executive Summary');
    expect(md).toContain('## 1. Game Performance');
    expect(md).toContain('## 2. Operational Metrics');
    expect(md).toContain('## 3. Certification Pipeline');
    expect(md).toContain('## 4. Marketplace Usage');
    expect(md).toContain('## 5. Wallet Provider Health');
    expect(md).toContain('## 6. Financial Snapshot');
    expect(md).toContain('## 7. Risks & Mitigations');
    expect(md).toContain('## 8. Roadmap Preview');
  });
  it('contains a numeric RTP value', () => {
    expect(md).toMatch(/Achieved RTP \| \d+\.\d+%/);
  });
});

describe('renderMbrHtml + renderMbrPdfStub', () => {
  const d = buildSyntheticDataset('acme', '2026-05');
  const md = renderMbrMarkdown(d);
  it('html wraps the markdown', () => {
    const html = renderMbrHtml(md, d);
    expect(html.includes('<!doctype html>')).toBe(true);
    expect(html.includes('Monthly Business Review')).toBe(true);
  });
  it('pdf stub records tenant + month', () => {
    const pdf = renderMbrPdfStub(d);
    expect(pdf).toContain('tenant=acme');
    expect(pdf).toContain('month=2026-05');
  });
});

describe('generateMbr — file output', () => {
  it('writes md, html, and pdf stub files', async () => {
    const out = resolve(tmpdir(), `mbr-test-${Date.now()}`);
    const res = await generateMbr({
      tenant: 'acme',
      month: '2026-05',
      mode: 'test',
      outDir: out,
    });
    expect(res.paths.md).toContain('mbr-2026-05.md');
    const md = await fs.readFile(res.paths.md, 'utf-8');
    expect(md).toContain('Monthly Business Review');
    const html = await fs.readFile(res.paths.html, 'utf-8');
    expect(html.startsWith('<!doctype html>')).toBe(true);
    const pdf = await fs.readFile(res.paths.pdfStub, 'utf-8');
    expect(pdf).toContain('[PDF STUB]');
    await fs.rm(out, { recursive: true, force: true });
  });

  it('rejects bad --tenant', async () => {
    await expect(generateMbr({ tenant: 'BAD ID', month: '2026-05' })).rejects.toThrow();
  });

  it('rejects bad --month', async () => {
    await expect(generateMbr({ tenant: 'acme', month: '2026-13-01' })).rejects.toThrow();
  });

  it('completes in under 5 seconds for synthetic data', async () => {
    const out = resolve(tmpdir(), `mbr-perf-${Date.now()}`);
    const t0 = Date.now();
    await generateMbr({ tenant: 'acme', month: '2026-05', mode: 'test', outDir: out });
    expect(Date.now() - t0).toBeLessThan(5000);
    await fs.rm(out, { recursive: true, force: true });
  });
});

describe('mjs module surface', () => {
  it('exports the expected helpers', () => {
    expect(typeof hashStr).toBe('function');
    expect(typeof mulberry32).toBe('function');
    expect(typeof buildSyntheticDataset).toBe('function');
    expect(typeof renderMbrMarkdown).toBe('function');
    expect(typeof renderMbrHtml).toBe('function');
    expect(typeof renderMbrPdfStub).toBe('function');
    expect(typeof generateMbr).toBe('function');
    expect(HERE.endsWith('tests')).toBe(true);
  });
});
