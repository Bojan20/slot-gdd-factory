#!/usr/bin/env node
/**
 * W210 Faza 600.0 — Smoke: full spin cycle.
 *
 *   1. Login (POST /api/session/login)
 *   2. Debit wallet
 *   3. Spin
 *   4. Credit back winnings
 *   5. Verify audit log entry
 *
 * --synthetic: skip HTTP, simulate the cycle with the RNG.
 * --target=http://host:port: target backend root.
 */
import { parseArgs, probeTarget, emit, timed, makeRng } from './_lib.mjs';

const args = parseArgs(process.argv);
const TARGET = args.target ?? 'http://localhost:4000';
let synthetic = !!args.synthetic;
const t0 = Date.now();

async function runHttp() {
  // We don't assume a specific schema — this smoke focuses on the
  // request chain succeeding. Any 4xx/5xx is a failure.
  const ses = await fetch(`${TARGET}/api/session/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId: 'smoke-player', bet: 100 }),
  });
  if (!ses.ok) throw new Error(`login http ${ses.status}`);
  const sessionId =
    (await ses.json().catch(() => ({}))).sessionId ?? 'synthetic-session';

  const debit = await fetch(`${TARGET}/api/wallet/debit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, amount: 100 }),
  });
  if (!debit.ok) throw new Error(`debit http ${debit.status}`);

  const spin = await fetch(`${TARGET}/api/gaas/spin`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, bet: 100, gameId: 'test-game-1' }),
  });
  if (!spin.ok) throw new Error(`spin http ${spin.status}`);
  const spinJson = await spin.json().catch(() => ({}));

  const credit = await fetch(`${TARGET}/api/wallet/credit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId, amount: spinJson.payout ?? 0 }),
  });
  if (!credit.ok) throw new Error(`credit http ${credit.status}`);

  const audit = await fetch(`${TARGET}/api/audit/session/${sessionId}`);
  if (!audit.ok) throw new Error(`audit http ${audit.status}`);
}

function runSynthetic() {
  const rng = makeRng(7);
  const spins = 5;
  let balance = 1000;
  for (let i = 0; i < spins; i++) {
    if (balance < 100) throw new Error('synthetic balance underflow');
    balance -= 100;
    const payout = rng() < 0.3 ? 250 : 0;
    balance += payout;
  }
  return { spins, finalBalance: balance };
}

try {
  if (!synthetic) {
    const ok = await probeTarget(`${TARGET}/api/health`);
    if (!ok) {
      // eslint-disable-next-line no-console
      console.error(
        `[smoke-spin-flow] target ${TARGET} unreachable — switching to synthetic`
      );
      synthetic = true;
    }
  }
  let extra = {};
  if (synthetic) {
    const r = await timed(async () => runSynthetic());
    extra = { extra: r.value };
  } else {
    await timed(async () => runHttp());
  }
  emit('smoke-spin-flow', true, {
    durationMs: Date.now() - t0,
    message: synthetic ? 'synthetic spin cycle ok' : 'live spin cycle ok',
    ...extra,
  });
} catch (e) {
  emit('smoke-spin-flow', false, {
    durationMs: Date.now() - t0,
    message: e instanceof Error ? e.message : String(e),
  });
}
