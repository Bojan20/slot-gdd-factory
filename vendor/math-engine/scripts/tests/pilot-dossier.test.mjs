/**
 * W211 Faza 700.0 — Pilot dossier generator tests.
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
  loadSources,
  renderMarkdown,
  markdownToHtml,
  buildDossier,
  parseArgs,
} from '../pilot/build-pilot-dossier.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

async function fixture() {
  const dir = resolve(
    tmpdir(),
    `pilot-dossier-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  );
  await fs.mkdir(dir, { recursive: true });
  const seed = await seedPilot({ root: REPO_ROOT, outDir: dir, force: true });
  const summary = await runSuite({ state: seed.state, spinCount: 100 });
  const suitePath = resolve(dir, 'integration-suite-latest.json');
  await fs.writeFile(suitePath, JSON.stringify(summary, null, 2) + '\n');
  return { dir, state: seed.state, summary };
}

describe('pilot dossier — schema + helpers', () => {
  it('SECTION_TITLES lists exactly 12 entries', () => {
    expect(SECTION_TITLES.length).toBe(12);
  });

  it('parseArgs reads --state= / --suite= / --out=', () => {
    const a = parseArgs([
      'node', 'x', '--state=/tmp/a.json', '--suite=/tmp/b.json', '--out=/tmp/c',
    ]);
    expect(a.state).toBe('/tmp/a.json');
    expect(a.suite).toBe('/tmp/b.json');
    expect(a.out).toBe('/tmp/c');
  });
});

describe('pilot dossier — markdown render', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await fixture();
  });

  it('loadSources reads state + suite files', async () => {
    const s = await loadSources({
      root: ctx.dir,
      state: 'lw-pilot-tenant.json',
      suite: 'integration-suite-latest.json',
    });
    expect(s.state.tenant.id).toBe(ctx.state.tenant.id);
    expect(Array.isArray(s.suite.verdicts)).toBe(true);
  });

  it('renderMarkdown begins with the dossier title', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    expect(md.split('\n')[0]).toBe('# Vendor B Pilot Evaluation Dossier');
  });

  it('renderMarkdown emits all 12 section headings', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    for (let i = 0; i < SECTION_TITLES.length; i++) {
      expect(md).toMatch(new RegExp(`## ${i + 1}\\. ${escape(SECTION_TITLES[i])}`));
    }
  });

  it('renderMarkdown surfaces the pass/fail count', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    expect(md).toMatch(/Steps PASS \/ total/);
  });

  it('renderMarkdown references the wallet provider', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    expect(md).toMatch(/generic-pam/);
  });

  it('renderMarkdown lists each installed template', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    for (const t of ctx.state.installedTemplates) {
      expect(md).toContain(t.templateId);
    }
  });
});

describe('pilot dossier — html render', () => {
  let ctx;
  beforeAll(async () => {
    ctx = await fixture();
  });

  it('markdownToHtml wraps a doctype + style block', () => {
    const md = renderMarkdown(ctx.state, ctx.summary);
    const html = markdownToHtml(md);
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toMatch(/<style>[^<]+<\/style>/);
  });

  it('html includes a <h1> heading + tables', () => {
    const html = markdownToHtml(renderMarkdown(ctx.state, ctx.summary));
    expect(html).toMatch(/<h1>Vendor B Pilot Evaluation Dossier<\/h1>/);
    expect(html).toMatch(/<table>/);
  });

  it('escapes html special chars', () => {
    const html = markdownToHtml('# A & B <c>');
    expect(html).toMatch(/<h1>A &amp; B &lt;c&gt;<\/h1>/);
  });
});

describe('pilot dossier — buildDossier output', () => {
  it('writes markdown + html under the out dir', async () => {
    const ctx = await fixture();
    const out = await buildDossier({
      root: ctx.dir,
      state: 'lw-pilot-tenant.json',
      suite: 'integration-suite-latest.json',
      out: '.',
    });
    expect(existsSync(out.markdownPath)).toBe(true);
    expect(existsSync(out.htmlPath)).toBe(true);
    expect(out.sectionCount).toBe(12);
    expect(out.markdownBytes).toBeGreaterThan(0);
    expect(out.htmlBytes).toBeGreaterThan(out.markdownBytes / 2);
  });

  it('throws when state/suite files are missing', async () => {
    const dir = resolve(
      tmpdir(),
      `pilot-dossier-missing-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
    );
    await fs.mkdir(dir, { recursive: true });
    await expect(
      buildDossier({
        root: dir,
        state: 'no-such-state.json',
        suite: 'no-such-suite.json',
        out: '.',
      })
    ).rejects.toThrow();
  });
});

function escape(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/&/g, '&');
}
