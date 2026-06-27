/**
 * W212 Faza 800.0 — pitch HTML compositor tests.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  DEFAULT_CSS,
  wrapHtmlDocument,
  escapeHtml,
  markdownToHtmlBody,
  sanitizeOfflineHtml,
  composeFromMarkdownFile,
  composeDeckFile,
  composeAll,
  REPO_ROOT,
} from '../pitch/compose-standalone-html.mjs';

async function tmpDir(label) {
  const d = resolve(tmpdir(), `${label}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`);
  await fs.mkdir(d, { recursive: true });
  return d;
}

describe('pitch HTML compose — primitives', () => {
  it('escapeHtml escapes the standard 5 entities', () => {
    expect(escapeHtml('A & B <c> "d" \'e\''))
      .toBe('A &amp; B &lt;c&gt; &quot;d&quot; &#39;e&#39;');
  });

  it('wrapHtmlDocument emits a standalone HTML5 document', () => {
    const html = wrapHtmlDocument({ title: 'X', bodyHtml: '<p>Y</p>' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<title>X<\/title>/);
    expect(html).toMatch(/<style>/);
    expect(html).toMatch(/<p>Y<\/p>/);
  });

  it('uses DEFAULT_CSS when no css override supplied', () => {
    const html = wrapHtmlDocument({ title: 'X', bodyHtml: '' });
    expect(html).toContain(DEFAULT_CSS.split('\n')[0].trim());
  });
});

describe('pitch HTML compose — markdown → HTML', () => {
  it('renders headings + paragraphs + code blocks', () => {
    const md = '# Title\n\nHello **world**.\n\n```\ncode block\n```\n';
    const body = markdownToHtmlBody(md);
    expect(body).toMatch(/<h1>Title<\/h1>/);
    expect(body).toMatch(/<p>Hello <strong>world<\/strong>\.<\/p>/);
    expect(body).toMatch(/<pre><code>/);
    expect(body).toMatch(/code block/);
  });

  it('renders bullet lists', () => {
    const md = '- one\n- two\n- three';
    const body = markdownToHtmlBody(md);
    expect(body).toMatch(/<ul>/);
    expect(body).toMatch(/<li>one<\/li>/);
    expect(body).toMatch(/<li>three<\/li>/);
  });

  it('renders tables with thead/tbody', () => {
    const md = '| A | B |\n|---|---|\n| 1 | 2 |\n';
    const body = markdownToHtmlBody(md);
    expect(body).toMatch(/<table>/);
    expect(body).toMatch(/<th>A<\/th>/);
    expect(body).toMatch(/<td>1<\/td>/);
  });

  it('escapes html special chars inside inline code', () => {
    const body = markdownToHtmlBody('Hello `<script>` world');
    expect(body).toMatch(/<code>&lt;script&gt;<\/code>/);
  });
});

describe('pitch HTML compose — offline sanitiser', () => {
  it('strips cross-origin stylesheet links', () => {
    const html = '<link rel="stylesheet" href="https://fonts.googleapis.com/x.css">';
    expect(sanitizeOfflineHtml(html)).not.toMatch(/<link/);
  });

  it('strips cross-origin script src tags', () => {
    const html = '<script src="https://cdn.example.com/x.js"></script>';
    expect(sanitizeOfflineHtml(html)).not.toMatch(/<script\s+src/);
  });

  it('keeps inline <style> and inline <script> by default', () => {
    const html = '<style>body{}</style><script>var x=1</script>';
    const out = sanitizeOfflineHtml(html);
    expect(out).toMatch(/<style>/);
    expect(out).toMatch(/<script>var x=1<\/script>/);
  });

  it('strips inline scripts when keepInlineScripts=false', () => {
    const html = '<style>body{}</style><script>var x=1</script>';
    const out = sanitizeOfflineHtml(html, { keepInlineScripts: false });
    expect(out).toMatch(/<style>/);
    expect(out).not.toMatch(/<script/);
  });
});

describe('pitch HTML compose — file IO', () => {
  it('composeFromMarkdownFile reads a real markdown file and emits standalone HTML', async () => {
    const dir = await tmpDir('compose-md');
    const mdPath = resolve(dir, 'doc.md');
    await fs.writeFile(mdPath, '# Hello\n\nWorld.\n');
    const html = await composeFromMarkdownFile({ markdownPath: mdPath, title: 'T' });
    expect(html.startsWith('<!DOCTYPE html>')).toBe(true);
    expect(html).toMatch(/<title>T<\/title>/);
    expect(html).toMatch(/<h1>Hello<\/h1>/);
  });

  it('composeDeckFile reads the live lw-deck.html and sanitises it', async () => {
    const deck = resolve(REPO_ROOT, 'web/pitch/lw-deck.html');
    try {
      await fs.access(deck);
    } catch {
      return; // Skip on partial-repo CI clones.
    }
    const html = await composeDeckFile({ deckPath: deck, title: 'Deck' });
    expect(html).toMatch(/<title>Deck<\/title>/);
    expect(html).not.toMatch(/<link\s[^>]*https?:/i);
  });

  it('composeAll writes outputs into an out dir and returns per-file results', async () => {
    const dir = await tmpDir('compose-all-in');
    const mdPath = resolve(dir, 'in.md');
    await fs.writeFile(mdPath, '# X\n');
    const out = await tmpDir('compose-all-out');
    const results = await composeAll({
      root: dir,
      items: [{ kind: 'markdown', source: 'in.md', title: 'X', outputName: 'x.html' }],
      outDir: out,
    });
    expect(results.length).toBe(1);
    expect(results[0].sizeBytes).toBeGreaterThan(0);
    const back = await fs.readFile(results[0].outputPath, 'utf8');
    expect(back).toMatch(/<h1>X<\/h1>/);
  });
});
