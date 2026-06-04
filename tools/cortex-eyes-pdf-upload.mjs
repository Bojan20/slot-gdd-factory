#!/usr/bin/env node
/**
 * tools/cortex-eyes-pdf-upload.mjs
 *
 * Live headless test — pokreni server, drag-drop GoO PDF u dropzone,
 * sačekaj da se iframe preview pojavi, screenshot za vizuelni dokaz.
 *
 * Boki spec: *"od sada nadalje pravilo je da uvek za svaki projekat radis
 * sam i otvaras cortex oci i ruke posle svake implementacije"*.
 */
import { spawn } from 'node:child_process';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __filename = fileURLToPath(import.meta.url);
const REPO = resolve(dirname(__filename), '..');
const OUT  = resolve(REPO, 'tools/_eyes');
if (!existsSync(OUT)) mkdirSync(OUT, { recursive: true });

const PDF_PATH = `${process.env.HOME}/Desktop/Gates_of_Olympus_1000_GDD.pdf`;
if (!existsSync(PDF_PATH)) {
  console.error(`❌ PDF fixture missing: ${PDF_PATH}`);
  process.exit(2);
}

const PORT = 5181;
const URL  = `http://127.0.0.1:${PORT}/`;

// 1. Start a short-lived server on PORT
const server = spawn('python3', ['-m', 'http.server', String(PORT)], {
  cwd: REPO,
  stdio: ['ignore', 'pipe', 'pipe'],
});

// Wait for server up
await new Promise(r => setTimeout(r, 800));

let exitCode = 0;
try {
  const browser = await chromium.launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const consoleErrs = [];
  page.on('console', msg => {
    if (msg.type() === 'error') consoleErrs.push(msg.text());
  });
  page.on('pageerror', e => consoleErrs.push(`pageerror: ${e.message}`));

  await page.goto(URL, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01-dropzone-empty.png`, fullPage: true });

  // Use Playwright's setInputFiles on the hidden <input type=file>
  const fileInput = await page.locator('input[type="file"]').first();
  await fileInput.setInputFiles(PDF_PATH);

  // Wait for either iframe preview OR an error message
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02-after-upload.png`, fullPage: true });

  const iframe = await page.$('iframe');
  const errBox = await page.$('.error, [data-error], .toast-error');

  let verdict = 'UNKNOWN';
  if (iframe) {
    const src = await iframe.getAttribute('src');
    verdict = src && src.startsWith('blob:') ? 'IFRAME blob: present' : `IFRAME src=${src}`;
    // Snapshot inside iframe too
    const frame = await iframe.contentFrame();
    if (frame) {
      const title = await frame.title().catch(() => '(no title)');
      const reels = await frame.$$('.reel, [data-reel]');
      const cells = await frame.$$('.cell, [data-cell], .symbol');
      verdict += ` · title=${title} · reels=${reels.length} · cells=${cells.length}`;
    }
  } else if (errBox) {
    verdict = `ERROR: ${(await errBox.innerText()).slice(0, 200)}`;
  }

  console.log('═══ CORTEX EYES — PDF upload live test ═══');
  console.log(`URL          : ${URL}`);
  console.log(`PDF          : ${PDF_PATH}`);
  console.log(`Verdict      : ${verdict}`);
  console.log(`Console errs : ${consoleErrs.length}`);
  for (const e of consoleErrs.slice(0, 5)) console.log(`  • ${e}`);
  console.log(`Screenshots  : ${OUT}/01-dropzone-empty.png + 02-after-upload.png`);
  console.log('═══════════════════════════════════════════');

  if (consoleErrs.length > 0 || !iframe) exitCode = 1;
  await browser.close();
} catch (e) {
  console.error(`💥 ${e.stack || e.message}`);
  exitCode = 2;
} finally {
  server.kill('SIGINT');
}

process.exit(exitCode);
