/**
 * W213 Faza 700.1 — pilot dossier v2 tests.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { promises as fs, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { seedPilot } from '../pilot/seed-lw-pilot.mjs';
import { runSuite } from '../pilot/run-integration-suite.mjs';
import {
  SECTION_TITLES,
  renderAsciiQr,
  renderMarkdownV2,
  rewriteV1Header,
  renderOperatorBlocks,
  buildDossierV2,
  parseArgs,
} from '../pilot/build-pilot-dossier-v2.mjs';
import { loadOperatorManifest } from '../pitch/operator-branding.mjs';
import { SECTION_TITLES as V1_TITLES } from '../pilot/build-pilot-dossier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

let _SHARED_FIXTURE = null;
async function fixture() {
  if (_SHARED_FIXTURE) return _SHARED_FIXTURE;
  const dir = resolve(tmpdir(), `dossier-v2-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(dir, { recursive: true });
  const seed = await seedPilot({ root: REPO_ROOT, outDir: dir, force: true });
  const summary = await runSuite({ state: seed.state, spinCount: 50 });
  await fs.writeFile(resolve(dir, 'integration-suite-latest.json'),
    JSON.stringify(summary, null, 2) + '\n');
  _SHARED_FIXTURE = { dir, state: seed.state, summary };
  return _SHARED_FIXTURE;
}

describe('pilot-dossier-v2 — schema', () => {
  it('SECTION_TITLES extends V1 with 5 additional sections', () => {
    expect(SECTION_TITLES.length).toBe(V1_TITLES.length + 5);
    expect(SECTION_TITLES).toEqual(expect.arrayContaining([
      'About the Operator',
      'Comparative Analysis vs Existing Pipeline',
      'Commercial Pricing Tiers',
    ]));
  });

  it('parseArgs supports --operator= flag', () => {
    const a = parseArgs(['node', 'x', '--operator=aristocrat']);
    expect(a.operatorId).toBe('aristocrat');
  });
});

describe('pilot-dossier-v2 — ASCII QR', () => {
  it('renderAsciiQr produces a bordered grid', () => {
    const out = renderAsciiQr('https://slotmath.example/pilot/lw');
    expect(out.split('\n').length).toBeGreaterThan(20);
    expect(out.split('\n')[0]).toMatch(/^\+-+\+$/);
  });

  it('renderAsciiQr is deterministic', () => {
    expect(renderAsciiQr('x')).toBe(renderAsciiQr('x'));
  });
});

describe('pilot-dossier-v2 — operator blocks', () => {
  it('renderOperatorBlocks emits Sections 13-17 for aristocrat', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const md = renderOperatorBlocks(manifest, { bulk: { metrics: { measuredRtp: 0.955 } } });
    expect(md).toMatch(/## 13\. About the Operator — Vendor C/);
    expect(md).toMatch(/## 14\. Comparative Analysis/);
    expect(md).toMatch(/## 15\. Before & After — Buffalo Diamond/);
    expect(md).toMatch(/## 16\. Commercial Pricing — Tier-1 Enterprise/);
    expect(md).toMatch(/## 17\. Distribution & Next Steps/);
  });

  it('renderOperatorBlocks lists ticker symbol when present', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const md = renderOperatorBlocks(manifest);
    expect(md).toContain('ALL.AX');
  });

  it('renderOperatorBlocks handles missing ticker gracefully', async () => {
    const manifest = await loadOperatorManifest('hacksaw');
    const md = renderOperatorBlocks(manifest);
    expect(md).toContain('(private)');
  });

  it('renderOperatorBlocks lists sample pricing line items', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const md = renderOperatorBlocks(manifest);
    expect(md).toContain('$140,000');   // pilot
    expect(md).toContain('$950,000');   // year-one
    expect(md).toMatch(/0\.110 mills/);
  });

  it('renderOperatorBlocks Tier-1 includes enterprise perks', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const md = renderOperatorBlocks(manifest);
    expect(md).toMatch(/Tier-1 enterprise includes/);
  });

  it('renderOperatorBlocks Tier-2 includes studio perks', async () => {
    const manifest = await loadOperatorManifest('hacksaw');
    const md = renderOperatorBlocks(manifest);
    expect(md).toMatch(/Tier-2 studio includes/);
  });
});

describe('pilot-dossier-v2 — rewriteV1Header', () => {
  let ctx;
  beforeAll(async () => { ctx = await fixture(); });

  it('rewriteV1Header swaps the # heading to operator displayName', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const v1Sample = '# Vendor B Pilot Evaluation Dossier\n\n**Tenant:** Demo\n**Run ID:** `r-1`';
    const out = rewriteV1Header(v1Sample, manifest);
    expect(out.split('\n')[0]).toBe('# Vendor C Pilot Evaluation Dossier');
    expect(out).toContain('**Operator:** Vendor C');
  });
});

describe('pilot-dossier-v2 — renderMarkdownV2', () => {
  let ctx;
  beforeAll(async () => { ctx = await fixture(); });

  it('with manifest, renders v1 + operator blocks', async () => {
    const manifest = await loadOperatorManifest('aristocrat');
    const md = renderMarkdownV2({ state: ctx.state, suite: ctx.summary, manifest });
    expect(md).toMatch(/^# Vendor C Pilot Evaluation Dossier/);
    expect(md).toMatch(/## 13\. About the Operator/);
  });

  it('without manifest, falls back to v1 byte-identical', async () => {
    const md = renderMarkdownV2({ state: ctx.state, suite: ctx.summary, manifest: null });
    expect(md).toMatch(/^# Vendor B Pilot Evaluation Dossier/);
    expect(md).not.toMatch(/## 13\. About the Operator/);
  });

  it('with default lw manifest, still falls back to v1', async () => {
    const manifest = await loadOperatorManifest('lw');
    const md = renderMarkdownV2({ state: ctx.state, suite: ctx.summary, manifest });
    expect(md).toMatch(/^# Vendor B Pilot Evaluation Dossier/);
  });
});

describe('pilot-dossier-v2 — buildDossierV2 output', () => {
  let ctx;
  beforeAll(async () => { ctx = await fixture(); });

  it('writes md + html with operator-id-prefixed filenames', async () => {
    const r = await buildDossierV2({
      root: ctx.dir,
      state: 'lw-pilot-tenant.json',
      suite: 'integration-suite-latest.json',
      out: '.',
      operatorId: 'aristocrat',
    });
    expect(existsSync(r.markdownPath)).toBe(true);
    expect(existsSync(r.htmlPath)).toBe(true);
    expect(r.markdownPath).toContain('aristocrat-pilot-dossier-v2.md');
    expect(r.htmlPath).toContain('aristocrat-pilot-dossier-v2.html');
    expect(r.sectionCount).toBe(SECTION_TITLES.length);
  });

  it('without operatorId, writes lw-prefixed v1-byte-compat output', async () => {
    const r = await buildDossierV2({
      root: ctx.dir,
      state: 'lw-pilot-tenant.json',
      suite: 'integration-suite-latest.json',
      out: '.',
    });
    expect(r.operatorId).toBe('lw');
    expect(r.sectionCount).toBe(V1_TITLES.length);
  });
});
