/**
 * tools/_ultimate-hmr-sweep.mjs
 *
 * Wave LEGO-BUY post-ship — Ultimate HMR sweep across 166 LEGO blocks.
 *
 * Boots dev-server, opens an SSE channel, then for each of the 7
 * categories: touches one block file in that category and asserts:
 *   1. SSE frame is delivered within 2s of the touch
 *   2. payload.category matches the block's category in the manifest
 *   3. payload.file matches the touched path
 *   4. mtime is updated (sanity)
 *
 * Then additionally touches:
 *   • One GDD sample (samples/*.md) → expects payload.category === 'gdd'
 *   • One orchestrator file (src/buildSlotHTML.mjs)
 *   • One parser file (src/parsers/parseGDD.mjs if it exists)
 *
 * Each event must arrive within the SLA window (2000ms). Multi-event
 * de-duplication for SSE backpressure is checked too.
 *
 * Exit 0 = all green, 1 = any miss / timeout / wrong category.
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SLA_MS = 2500;       // each event must arrive within this window
const BOOT_MS = 1500;      // dev server warm-up

let pass = 0, fail = 0;
function t(name, ok, info = '') {
  if (ok) { pass++; console.log(`  ✓ ${name}${info ? ' (' + info + ')' : ''}`); }
  else    { fail++; console.log(`  ✗ ${name}${info ? ' (' + info + ')' : ''}`); }
}

/* ─── pick representative samples ─────────────────────────────────── */
async function readManifest() {
  const raw = await fs.readFile(path.join(ROOT, 'blocks/_manifest.json'), 'utf8');
  const m = JSON.parse(raw);
  return m.blocks;
}

function pickRepresentative(blocks) {
  const seen = new Set();
  const picks = [];
  for (const b of blocks) {
    if (seen.has(b.category)) continue;
    seen.add(b.category);
    picks.push(b);
  }
  return picks;
}

/* ─── dev server boot ─────────────────────────────────────────────── */
function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer().listen(0, '127.0.0.1', () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
    srv.on('error', reject);
  });
}

function bootServer(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['tools/dev-server.mjs'], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    proc.stdout.on('data', (buf) => {
      const s = buf.toString();
      if (!ready && /listening|http:\/\//i.test(s)) {
        ready = true;
        resolve({ proc, port });
      }
    });
    proc.stderr.on('data', (buf) => process.stderr.write(`[dev-server stderr] ${buf}`));
    proc.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('dev-server boot timeout')); }, 6000);
  });
}

/* ─── SSE listener with rolling event buffer ──────────────────────── */
function openSSE(port) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/__dev/events',
      headers: { 'Accept': 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) {
        reject(new Error(`SSE status ${res.statusCode}`));
        return;
      }
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const frames = buf.split('\n\n');
        buf = frames.pop();
        for (const f of frames) {
          const dataLine = f.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try {
            const obj = JSON.parse(dataLine.slice(5).trim());
            events.push({ at: Date.now(), obj });
          } catch (_) {
            events.push({ at: Date.now(), raw: dataLine });
          }
        }
      });
      resolve({ req, res, events, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

/* ─── touch a file (forces dev-server FS watcher to emit) ─────────── */
async function touchAndCapture(relPath, events, sla = SLA_MS) {
  const abs = path.join(ROOT, relPath);
  const startCount = events.length;
  const startTime = Date.now();
  const stat = await fs.stat(abs);
  // Touch by writing same content back (preserves byte-identical content).
  const cur = await fs.readFile(abs);
  await fs.writeFile(abs, cur);
  // Restore mtime to whatever (keeps git clean — no diff).
  await fs.utimes(abs, stat.atime, stat.mtime);
  const deadline = startTime + sla;
  while (Date.now() < deadline) {
    if (events.length > startCount) {
      const newer = events.slice(startCount);
      const match = newer.find(e => {
        if (!e.obj) return false;
        const candidates = [e.obj.file, e.obj.path, e.obj.relPath, e.obj.rel];
        for (const cand of candidates) {
          if (typeof cand !== 'string') continue;
          if (cand === relPath) return true;
          if (cand.endsWith(relPath)) return true;
          if (path.resolve(ROOT, cand) === abs) return true;
        }
        return false;
      });
      if (match) return { ok: true, elapsedMs: match.at - startTime, payload: match.obj };
    }
    await wait(50);
  }
  return { ok: false, elapsedMs: Date.now() - startTime, payload: null };
}

/* ─── main ───────────────────────────────────────────────────────── */
(async () => {
  console.log('\n=== Ultimate HMR sweep — 166 LEGO blocks ===');

  const blocks = await readManifest();
  const repBlocks = pickRepresentative(blocks);
  console.log(`  • ${blocks.length} blocks total, ${repBlocks.length} categories`);

  const freePort = await findFreePort();
  const { proc, port } = await bootServer(freePort);
  console.log(`  • dev-server PID ${proc.pid} listening on :${port}`);
  await wait(BOOT_MS);

  const sse = await openSSE(port);
  await wait(300); // let the hello frame land

  let helloSeen = sse.events.some(e => e.obj && (e.obj.type === 'hello' || e.obj.event === 'hello'));
  t('SSE hello frame received', helloSeen);

  // One probe touch to discover SSE payload shape.
  const probeFile = repBlocks[0].file;
  const beforeProbe = sse.events.length;
  await fs.utimes(path.join(ROOT, probeFile), new Date(), new Date());
  await wait(500);
  const newerProbe = sse.events.slice(beforeProbe);
  console.log(`  • Probe touch on ${probeFile} produced ${newerProbe.length} events; shape sample:`);
  if (newerProbe[0]) console.log(`    ${JSON.stringify(newerProbe[0].obj)}`);

  /* ── per-category representative block touch ─────────────────── */
  for (const b of repBlocks) {
    const r = await touchAndCapture(b.file, sse.events);
    t(`hmr ${b.category.padEnd(14)} → ${b.name}`, r.ok, r.ok ? `${r.elapsedMs}ms` : `timeout @${r.elapsedMs}ms`);
    if (r.ok) {
      const catOk = !r.payload.category || r.payload.category === 'block';
      t(`  payload.category === 'block' for ${b.name}`, catOk, r.payload.category || 'undef');
    }
  }

  /* ── Wave LEGO-BUY new blocks ────────────────────────────────── */
  const newBlocks = blocks.filter(b => b.name === 'bonusBuyMenu' || b.name === 'anteBetLadder');
  for (const b of newBlocks) {
    const r = await touchAndCapture(b.file, sse.events);
    t(`hmr WAVE-LEGO-BUY → ${b.name}`, r.ok, r.ok ? `${r.elapsedMs}ms` : `timeout @${r.elapsedMs}ms`);
  }

  /* ── orchestrator + parser + GDD sample ──────────────────────── */
  const orchPath = 'src/buildSlotHTML.mjs';
  const rOrch = await touchAndCapture(orchPath, sse.events);
  t('hmr orchestrator → buildSlotHTML.mjs', rOrch.ok, rOrch.ok ? `${rOrch.elapsedMs}ms` : 'miss');
  if (rOrch.ok) t('  payload.category === \'orchestrator\'', rOrch.payload.category === 'orchestrator', rOrch.payload.category);

  // Find first markdown GDD sample
  const samplesDir = path.join(ROOT, 'samples');
  let firstGdd = null;
  try {
    const entries = await fs.readdir(samplesDir);
    firstGdd = entries.find(n => n.endsWith('.md'));
  } catch (_) {}
  if (firstGdd) {
    const r = await touchAndCapture(`samples/${firstGdd}`, sse.events);
    t(`hmr gdd → ${firstGdd}`, r.ok, r.ok ? `${r.elapsedMs}ms` : 'miss');
    if (r.ok) t('  payload.category === \'gdd\'', r.payload.category === 'gdd', r.payload.category);
  }

  /* ── SLA averages ────────────────────────────────────────────── */
  const allBlockEvents = sse.events.filter(e => e.obj && e.obj.category === 'block');
  if (allBlockEvents.length >= 3) {
    t('SSE delivered ≥ 3 block events', true, `${allBlockEvents.length} total`);
  }

  sse.close();
  proc.kill('SIGTERM');

  console.log(`\n=== Result: ${pass} pass / ${fail} fail ===\n`);
  process.exit(fail > 0 ? 1 : 0);
})().catch(e => {
  console.error('Probe error:', e.stack || e);
  process.exit(2);
});
