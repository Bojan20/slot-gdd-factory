#!/usr/bin/env node
/** Convert WoO HTML → PDF using Playwright headless Chromium. */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const browser = await chromium.launch();
const page = await browser.newPage();

/* Inject a polished print CSS so PDF looks like a proper professional GDD. */
const baseHtml = readFileSync('/tmp/woo.html', 'utf8');
const styled = baseHtml.replace('</head>', `
<style>
  @page { size: A4; margin: 18mm 14mm; }
  body { font-family: -apple-system, "SF Pro Text", "Helvetica Neue", Helvetica, Arial, sans-serif; font-size: 10.5pt; line-height: 1.5; color: #1a1a1a; max-width: none; margin: 0; padding: 0; }
  h1 { font-size: 22pt; color: #0d1437; border-bottom: 3px solid #c9a227; padding-bottom: 0.3em; margin-top: 1.4em; page-break-after: avoid; }
  h2 { font-size: 16pt; color: #0d1437; border-bottom: 1.5px solid #c9a227; padding-bottom: 0.2em; margin-top: 1.6em; page-break-after: avoid; }
  h3 { font-size: 13pt; color: #1c2a5e; margin-top: 1.2em; page-break-after: avoid; }
  h4 { font-size: 11pt; color: #2a3a7a; margin-top: 0.9em; page-break-after: avoid; }
  p, ul, ol { margin: 0.45em 0; }
  code { background: #f3f3f6; padding: 1px 4px; border-radius: 3px; font-family: "SF Mono", "Menlo", Consolas, monospace; font-size: 9.5pt; color: #1c2a5e; }
  pre { background: #0d1437; color: #f6f1d6; padding: 10px 14px; border-radius: 6px; font-size: 8.8pt; line-height: 1.35; overflow: visible; page-break-inside: avoid; }
  pre code { background: transparent; color: inherit; padding: 0; font-size: 8.8pt; }
  table { border-collapse: collapse; width: 100%; margin: 0.5em 0 0.8em; page-break-inside: avoid; }
  th { background: #0d1437; color: #f6f1d6; text-align: left; padding: 5px 8px; font-size: 9.5pt; }
  td { border: 1px solid #d6d6d6; padding: 4px 8px; font-size: 9.5pt; vertical-align: top; }
  tr:nth-child(even) td { background: #f8f6ee; }
  strong { color: #0d1437; }
  blockquote { border-left: 3px solid #c9a227; background: #faf6e6; padding: 6px 12px; margin: 0.6em 0; font-style: italic; color: #4a4a4a; page-break-inside: avoid; }
  hr { border: 0; border-top: 1px dashed #c9a227; margin: 1.4em 0; }
  a { color: #1c2a5e; text-decoration: none; }
  /* Title page treatment via first h1 */
  body > h1:first-of-type { font-size: 28pt; text-align: center; margin-top: 24mm; border: none; }
</style>
</head>`);

await page.setContent(styled, { waitUntil: 'load' });
await page.pdf({
  path: '/Users/vanvinklstudio/Desktop/GDD/Wrath_of_Olympus_GDD.pdf',
  format: 'A4',
  margin: { top: '0', bottom: '0', left: '0', right: '0' },
  printBackground: true,
  preferCSSPageSize: true,
});
await browser.close();
console.log('PDF written:', '/Users/vanvinklstudio/Desktop/GDD/Wrath_of_Olympus_GDD.pdf');
