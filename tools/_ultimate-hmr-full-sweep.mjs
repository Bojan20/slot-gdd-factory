/**
 * tools/_ultimate-hmr-full-sweep.mjs
 *
 * Ultimate Wave-LEGO-BUY post-ship — exhaustive HMR sweep across
 * ALL 166 LEGO blocks. For each block in blocks/_manifest.json,
 * touches the file and waits for an SSE 'change' event with the
 * matching path. Each event must arrive within SLA window.
 *
 * Reports per-category histogram + latency stats (min/p50/p95/max).
 * Exit 0 = all 166 blocks emitted an HMR event correctly, 1 = any miss.
 */
import http from 'node:http';
import fs   from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';

const ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const SLA_MS = 2000;

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = http.createServer().listen(0, '127.0.0.1', () => {
      const p = srv.address().port;
      srv.close(() => resolve(p));
    });
    srv.on('error', reject);
  });
}

function bootServer(port) {
  return new Promise((resolve, reject) => {
    const proc = spawn(process.execPath, ['tools/dev-server.mjs'], {
      cwd: ROOT, env: { ...process.env, NODE_ENV: 'test', PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    proc.stdout.on('data', (buf) => {
      if (!ready && /listening|http:\/\//i.test(buf.toString())) { ready = true; resolve({ proc, port }); }
    });
    proc.on('error', reject);
    setTimeout(() => { if (!ready) reject(new Error('boot timeout')); }, 6000);
  });
}

function openSSE(port) {
  return new Promise((resolve, reject) => {
    const events = [];
    const req = http.get({ host: '127.0.0.1', port, path: '/__dev/events',
      headers: { 'Accept': 'text/event-stream' } }, (res) => {
      if (res.statusCode !== 200) return reject(new Error(`SSE ${res.statusCode}`));
      let buf = '';
      res.on('data', (chunk) => {
        buf += chunk.toString();
        const frames = buf.split('\n\n'); buf = frames.pop();
        for (const f of frames) {
          const dataLine = f.split('\n').find(l => l.startsWith('data:'));
          if (!dataLine) continue;
          try { events.push({ at: Date.now(), obj: JSON.parse(dataLine.slice(5).trim()) }); }
          catch (_) {}
        }
      });
      resolve({ req, res, events, close: () => req.destroy() });
    });
    req.on('error', reject);
  });
}

async function touchAndCapture(relPath, events) {
  const abs = path.join(ROOT, relPath);
  const startCount = events.length;
  const startTime = Date.now();
  await fs.utimes(abs, new Date(), new Date());
  const deadline = startTime + SLA_MS;
  while (Date.now() < deadline) {
    if (events.length > startCount) {
      const newer = events.slice(startCount);
      const hit = newer.find(e => {
        if (!e.obj || e.obj.type !== 'change') return false;
        const p = e.obj.path || e.obj.file;
        return p === relPath || (typeof p === 'string' && p.endsWith(relPath));
      });
      if (hit) return { ok: true, elapsedMs: hit.at - startTime, payload: hit.obj };
    }
    await wait(30);
  }
  return { ok: false, elapsedMs: Date.now() - startTime, payload: null };
}

function pct(arr, p) {
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.floor((p / 100) * sorted.length);
  return sorted[Math.min(idx, sorted.length - 1)];
}

(async () => {
  console.log('\n=== Full HMR sweep — all 166 LEGO blocks ===');
  const manifest = JSON.parse(await fs.readFile(path.join(ROOT, 'blocks/_manifest.json'), 'utf8'));
  console.log(`  • ${manifest.blocks.length} blocks to test`);

  const port = await findFreePort();
  const { proc } = await bootServer(port);
  await wait(800);
  const sse = await openSSE(port);
  await wait(300);

  const byCat = {};
  const latencies = [];
  const misses = [];

  for (let i = 0; i < manifest.blocks.length; i++) {
    const b = manifest.blocks[i];
    const r = await touchAndCapture(b.file, sse.events);
    if (!r.ok) {
      misses.push(b.name);
    } else {
      latencies.push(r.elapsedMs);
    }
    byCat[b.category] = byCat[b.category] || { total: 0, ok: 0 };
    byCat[b.category].total++;
    if (r.ok) byCat[b.category].ok++;

    if ((i + 1) % 25 === 0) {
      const okCount = manifest.blocks.length - misses.length;
      process.stdout.write(`  ... ${i + 1}/${manifest.blocks.length} touched (${okCount} ok so far)\n`);
    }
    // Brief breath so event queue doesn't coalesce
    await wait(60);
  }

  sse.close();
  proc.kill('SIGTERM');

  /* ── reporting ──────────────────────────────────────────────── */
  console.log('\n  ─ per-category histogram ─');
  for (const [cat, s] of Object.entries(byCat).sort()) {
    const marker = s.ok === s.total ? '✓' : '✗';
    console.log(`    ${marker} ${cat.padEnd(16)} ${String(s.ok).padStart(3)}/${String(s.total).padEnd(3)}`);
  }

  if (latencies.length > 0) {
    console.log('\n  ─ latency stats (SSE event arrival) ─');
    console.log(`    min  : ${Math.min(...latencies)}ms`);
    console.log(`    p50  : ${pct(latencies, 50)}ms`);
    console.log(`    p95  : ${pct(latencies, 95)}ms`);
    console.log(`    max  : ${Math.max(...latencies)}ms`);
    console.log(`    avg  : ${Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)}ms`);
  }

  if (misses.length > 0) {
    console.log(`\n  ✗ ${misses.length} blocks missed HMR event:`);
    for (const n of misses) console.log(`    - ${n}`);
    process.exit(1);
  }

  console.log(`\n=== Result: 166/166 blocks emitted HMR event within ${SLA_MS}ms ===\n`);
  process.exit(0);
})().catch(e => { console.error(e.stack || e); process.exit(2); });
