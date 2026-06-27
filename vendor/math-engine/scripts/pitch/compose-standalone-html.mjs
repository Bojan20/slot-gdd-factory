#!/usr/bin/env node
/**
 * W212 Faza 800.0 — Pitch Tarball Bundler — standalone HTML compositor.
 *
 * Converts the W211 multi-file web/pitch artifacts (and any markdown
 * source) into single-file HTML documents that recipients can open
 * directly via file:// (e.g., from an email attachment) without an HTTP
 * server, npm install, or any external font/CDN fetch.
 *
 * The deck (`web/pitch/lw-deck.html`) is already a self-contained,
 * offline-safe HTML — it inlines its CSS in a <style> block, uses
 * system fonts, and has no external <script src> tags. We re-emit it
 * verbatim while stripping any accidentally-introduced cross-origin
 * <link rel="stylesheet"> or <script src=""> nodes.
 *
 * Markdown sources (pilot dossier, deep dive, competitive matrix,
 * pitch guide, storyboards) are rendered into the same vanilla-CSS
 * stylesheet used by `build-pilot-dossier.mjs::markdownToHtml`.
 *
 * Exports:
 *   - DEFAULT_CSS (shared offline-safe stylesheet)
 *   - wrapHtmlDocument({ title, bodyHtml, css })
 *   - escapeHtml(text)
 *   - markdownToHtmlBody(md)
 *   - sanitizeOfflineHtml(html, { keepInlineScripts? })
 *   - composeFromMarkdownFile({ markdownPath, title })
 *   - composeDeckFile({ deckPath, title })
 *   - composeAll({ root, items, outDir })
 *
 * The compositor never executes JS or fetches assets. Output is one
 * .html string per input — byte-identical given identical input.
 */

import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

export const DEFAULT_CSS = `
  :root {
    --bg: #0a0e14;
    --bg-2: #10161f;
    --bg-3: #161d28;
    --line: #1c2533;
    --line-2: #2b3849;
    --text: #d6dde5;
    --text-mute: #a8b5c5;
    --accent: #00d9ff;
    --accent-2: #7fffd4;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: var(--bg); color: var(--text);
    font: 15px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; }
  body { padding: 24px; max-width: 1100px; margin: 0 auto; }
  h1 { color: var(--accent); font-size: 26px; margin: 0 0 16px; }
  h2 { color: var(--accent); font-size: 20px; margin: 24px 0 8px; }
  h3 { color: var(--accent-2); font-size: 16px; margin: 18px 0 6px; }
  a { color: var(--accent); }
  code { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    background: var(--bg-3); padding: 1px 5px; border-radius: 3px; font-size: 0.9em; }
  pre { background: var(--bg-3); padding: 12px; border-radius: 6px;
    border: 1px solid var(--line); overflow-x: auto; }
  pre code { background: transparent; padding: 0; }
  table { border-collapse: collapse; margin: 12px 0; font-size: 14px; }
  th, td { border: 1px solid var(--line-2); padding: 6px 10px; text-align: left; }
  th { background: var(--bg-2); color: var(--accent-2); }
  ul, ol { padding-left: 24px; }
  hr { border: 0; border-top: 1px solid var(--line); margin: 24px 0; }
  blockquote { border-left: 3px solid var(--accent); padding: 4px 14px;
    color: var(--text-mute); margin: 12px 0; background: var(--bg-2); }
`.trim();

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function wrapHtmlDocument({ title, bodyHtml, css }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>${css ?? DEFAULT_CSS}</style>
</head>
<body>
${bodyHtml}
</body>
</html>
`;
}

/** Minimal block-level markdown → HTML (no external deps). */
export function markdownToHtmlBody(md) {
  const lines = String(md ?? '').split('\n');
  const out = [];
  let inCode = false;
  let inList = false;
  let inOrdered = false;
  let inTable = false;
  let tableHeaderEmitted = false;
  let para = [];

  const flushPara = () => {
    if (para.length === 0) return;
    out.push(`<p>${inlineMd(para.join(' '))}</p>`);
    para = [];
  };
  const closeList = () => {
    if (inList) { out.push('</ul>'); inList = false; }
    if (inOrdered) { out.push('</ol>'); inOrdered = false; }
  };
  const closeTable = () => {
    if (inTable) { out.push('</tbody></table>'); inTable = false; tableHeaderEmitted = false; }
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.startsWith('```')) {
      flushPara(); closeList(); closeTable();
      if (!inCode) { out.push('<pre><code>'); inCode = true; }
      else { out.push('</code></pre>'); inCode = false; }
      continue;
    }
    if (inCode) { out.push(escapeHtml(raw)); continue; }
    const line = raw.replace(/\s+$/, '');
    if (line === '') { flushPara(); closeList(); closeTable(); continue; }

    const heading = /^(#{1,6})\s+(.+)$/.exec(line);
    if (heading) {
      flushPara(); closeList(); closeTable();
      const level = heading[1].length;
      out.push(`<h${level}>${inlineMd(heading[2])}</h${level}>`);
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      flushPara(); closeTable();
      if (!inList) { closeList(); out.push('<ul>'); inList = true; }
      out.push(`<li>${inlineMd(line.replace(/^[-*]\s+/, ''))}</li>`);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      flushPara(); closeTable();
      if (!inOrdered) { closeList(); out.push('<ol>'); inOrdered = true; }
      out.push(`<li>${inlineMd(line.replace(/^\d+\.\s+/, ''))}</li>`);
      continue;
    }
    if (line.startsWith('|') && line.endsWith('|')) {
      flushPara(); closeList();
      const cells = line.slice(1, -1).split('|').map((c) => c.trim());
      // separator row like |---|---|
      if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
      if (!inTable) { out.push('<table><thead>'); inTable = true; tableHeaderEmitted = false; }
      if (!tableHeaderEmitted) {
        out.push('<tr>' + cells.map((c) => `<th>${inlineMd(c)}</th>`).join('') + '</tr>');
        out.push('</thead><tbody>');
        tableHeaderEmitted = true;
      } else {
        out.push('<tr>' + cells.map((c) => `<td>${inlineMd(c)}</td>`).join('') + '</tr>');
      }
      continue;
    }
    if (line.startsWith('> ')) {
      flushPara(); closeList(); closeTable();
      out.push(`<blockquote>${inlineMd(line.slice(2))}</blockquote>`);
      continue;
    }
    if (/^-{3,}$/.test(line) || /^_{3,}$/.test(line)) {
      flushPara(); closeList(); closeTable();
      out.push('<hr />');
      continue;
    }
    para.push(line);
  }
  if (inCode) out.push('</code></pre>');
  flushPara(); closeList(); closeTable();
  return out.join('\n');
}

function inlineMd(s) {
  let t = escapeHtml(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  return t;
}

/** Strip cross-origin <link>/<script src> that would break offline opens. */
export function sanitizeOfflineHtml(html, opts = {}) {
  const keepInlineScripts = opts.keepInlineScripts ?? true;
  let out = String(html);
  // Remove <link rel=stylesheet href="http..."> and similar.
  out = out.replace(/<link[^>]*\srel\s*=\s*["']?stylesheet["']?[^>]*?\shref\s*=\s*["'](https?:\/\/|\/\/)[^"']*["'][^>]*>/gi, '');
  // Remove <link rel=preconnect/preload/dns-prefetch> (font CDN hints)
  out = out.replace(/<link[^>]*\srel\s*=\s*["']?(preconnect|preload|dns-prefetch|prefetch)["']?[^>]*>/gi, '');
  // Remove cross-origin <script src=…>.
  out = out.replace(/<script[^>]*\ssrc\s*=\s*["'](https?:\/\/|\/\/)[^"']*["'][^>]*><\/script>/gi, '');
  if (!keepInlineScripts) {
    out = out.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '');
  }
  return out;
}

export async function composeFromMarkdownFile({ markdownPath, title }) {
  if (!existsSync(markdownPath)) {
    throw new Error(`markdown source not found: ${markdownPath}`);
  }
  const md = await fs.readFile(markdownPath, 'utf8');
  const body = markdownToHtmlBody(md);
  return wrapHtmlDocument({ title: title ?? basename(markdownPath), bodyHtml: body });
}

export async function composeDeckFile({ deckPath, title }) {
  if (!existsSync(deckPath)) {
    throw new Error(`deck source not found: ${deckPath}`);
  }
  const raw = await fs.readFile(deckPath, 'utf8');
  const sanitized = sanitizeOfflineHtml(raw);
  // The deck is already a full <!doctype html>; if a custom title was
  // requested, swap the <title> tag.
  if (title) {
    return sanitized.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(title)}</title>`);
  }
  return sanitized;
}

/**
 * Compose a batch of (input, title, outputName) tuples into an out dir.
 * Returns an array of `{ outputPath, sourcePath, sizeBytes }` records.
 */
export async function composeAll({ root, items, outDir }) {
  if (!existsSync(outDir)) await fs.mkdir(outDir, { recursive: true });
  const results = [];
  for (const item of items) {
    const src = resolve(root, item.source);
    let html;
    if (item.kind === 'deck') {
      html = await composeDeckFile({ deckPath: src, title: item.title });
    } else if (item.kind === 'markdown') {
      html = await composeFromMarkdownFile({ markdownPath: src, title: item.title });
    } else if (item.kind === 'raw-html') {
      html = sanitizeOfflineHtml(await fs.readFile(src, 'utf8'));
      if (item.title) {
        html = html.replace(/<title>[^<]*<\/title>/i, `<title>${escapeHtml(item.title)}</title>`);
      }
    } else {
      throw new Error(`unknown compose kind: ${item.kind}`);
    }
    const outPath = resolve(outDir, item.outputName);
    await fs.writeFile(outPath, html);
    results.push({ outputPath: outPath, sourcePath: src, sizeBytes: Buffer.byteLength(html, 'utf8') });
  }
  return results;
}

// ─── CLI ─────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const outDir = resolve(REPO_ROOT, 'dist', 'pitch', 'standalone');
  const items = [
    {
      kind: 'deck',
      source: 'web/pitch/lw-deck.html',
      title: 'Vendor B Acceleration Pilot — Executive Deck',
      outputName: '01-executive-deck.html',
    },
  ];
  composeAll({ root: REPO_ROOT, items, outDir }).then((r) => {
    for (const f of r) console.log(`composed ${basename(f.outputPath)} (${f.sizeBytes}B)`);
  });
}
