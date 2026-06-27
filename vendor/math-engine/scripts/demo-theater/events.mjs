/**
 * W211 Faza 700.0 — Demo Theater event-log generator.
 *
 * Deterministic event factory used by the orchestrator. Given a seed,
 * the same 30-day timeline is reproduced bit-identically across runs —
 * mandatory for CI replay and snapshot tests.
 *
 * Event categories:
 *   - spin      : per-player spin (bet/win/RTP_running/latency_ms)
 *   - cache     : key namespace hit/miss + ttl remaining
 *   - audit     : hash-chain advance for the audit ledger
 *   - canary    : rollout stage transitions / health gate evaluations
 *   - lab       : GLI / BMM lab submission pipeline state
 *   - anomaly   : synthetic incident triggers (1-2 across 30 days)
 *   - operator  : dashboard refresh tick (role + ts)
 *
 * Spin volume follows a daily Poisson-like rate that escalates with the
 * canary rollout — 1k on day 1, 100k on day 5+, etc. The RTP_running
 * field converges towards the configured target as spin count grows.
 *
 * All distributions use a seeded LCG (1664525 / 1013904223) so no
 * external entropy ever leaks into the simulation.
 */

/** Seeded LCG — matches scripts/smoke-tests/_lib.mjs (W210). */
export function makeRng(seed = 42) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

/** Box-Muller transform for Gaussian latency samples. */
function gauss(rng, mean, sigma) {
  // Avoid log(0)
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return mean + sigma * z;
}

/** Knuth-style Poisson sampler — adequate for λ ≤ ~500. */
function poisson(rng, lambda) {
  if (lambda <= 0) return 0;
  if (lambda > 50) {
    // Normal approximation for fast path
    return Math.max(0, Math.round(gauss(rng, lambda, Math.sqrt(lambda))));
  }
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  while (true) {
    k++;
    p *= rng();
    if (p <= L) return k - 1;
  }
}

/** Pick a weighted element. */
function pickWeighted(rng, items) {
  const total = items.reduce((s, it) => s + it.w, 0);
  let x = rng() * total;
  for (const it of items) {
    x -= it.w;
    if (x <= 0) return it.v;
  }
  return items[items.length - 1].v;
}

/** Canary rollout schedule (W210 4-stage canary). */
export function canaryStage(day) {
  if (day < 3) return { stage: 0, rolloutPercent: 0 };
  if (day < 8) return { stage: 1, rolloutPercent: 1 };
  if (day < 15) return { stage: 2, rolloutPercent: 5 };
  if (day < 22) return { stage: 3, rolloutPercent: 25 };
  return { stage: 4, rolloutPercent: 100 };
}

/** Lab submission pipeline schedule. */
export function labStage(day) {
  if (day < 22) return { stage: 'pre_submission', daysInStage: day };
  if (day === 22) return { stage: 'submitted', daysInStage: 0 };
  if (day <= 25) return { stage: 'lab_review', daysInStage: day - 22 };
  if (day <= 28) return { stage: 'revision_cycle', daysInStage: day - 25 };
  if (day === 29) return { stage: 'approved', daysInStage: 0 };
  return { stage: 'production_cert', daysInStage: day - 29 };
}

/** Spin volume curve: 1k → 100k/day as canary ramps. */
function spinVolume(day) {
  if (day === 0) return 0;
  if (day === 1) return 1000;
  if (day === 2) return 5000;
  if (day < 5) return 25000;
  if (day < 8) return 100000;
  if (day < 15) return 250000;
  if (day < 22) return 500000;
  return 750000;
}

/** Target RTP per game (mock). */
const RTP_TARGETS = {
  'quick-hit-dragons': 0.962,
  'huff-n-puff-storm': 0.955,
  'spartacus-conquest': 0.968,
  'rainbow-riches-vault': 0.949,
};

/** Tenant catalogue (mock). */
const TENANTS = [
  { id: 'tenant-uk-001', region: 'UK', label: 'PlayUK Casino' },
  { id: 'tenant-mt-002', region: 'MT', label: 'MaltaSpins Ltd' },
  { id: 'tenant-de-003', region: 'DE', label: 'BerlinBet GmbH' },
];

const CACHE_NAMESPACES = ['rtp_table', 'paytable', 'session', 'jurisdiction', 'paroli'];

/** Anomaly schedule — exactly 2 in 30 days. */
function anomalyDay(day) {
  if (day === 8) {
    return {
      type: 'wallet_timeout',
      severity: 'medium',
      triggered_action: 'cache_ttl_extended',
      message:
        'wallet provider latency p99 spike to 380ms — cache TTL extended 30s→120s, queue drained in 12s',
    };
  }
  if (day === 17) {
    return {
      type: 'rtp_drift',
      severity: 'low',
      triggered_action: 'auto_observed_gate',
      message:
        'rtp drift +0.18pp on tenant-de-003 — within 0.5pp tolerance, no rollback',
    };
  }
  return null;
}

/**
 * Generate every event for one simulated calendar day.
 *
 * Returns an array of envelope events. Each event has:
 *   { type, day, ts (HH:MM UTC string), payload }
 *
 * The events are pre-sorted by their hour.
 */
export function generateDayEvents(day, rng) {
  const out = [];
  const stage = canaryStage(day);
  const lab = labStage(day);
  const volume = spinVolume(day);

  // Decimate so the log stays browsable (sample 1 in 200 of large volume).
  const decim = Math.max(1, Math.floor(volume / 50));
  const spinSamples = Math.min(50, Math.floor(volume / Math.max(1, decim)));

  // RTP_running converges to target as volume grows.
  const game = pickWeighted(rng, [
    { v: 'quick-hit-dragons', w: 4 },
    { v: 'huff-n-puff-storm', w: 3 },
    { v: 'spartacus-conquest', w: 2 },
    { v: 'rainbow-riches-vault', w: 2 },
  ]);
  const target = RTP_TARGETS[game];
  const confidence = Math.min(1, day / 30);
  const sigma = 0.04 * (1 - confidence) + 0.002;

  for (let i = 0; i < spinSamples; i++) {
    const tenant = TENANTS[Math.floor(rng() * TENANTS.length)];
    const bet = pickWeighted(rng, [
      { v: 0.2, w: 5 },
      { v: 0.5, w: 4 },
      { v: 1.0, w: 3 },
      { v: 2.0, w: 2 },
      { v: 5.0, w: 1 },
    ]);
    const rtpRunning = Math.max(0.5, Math.min(1.5, gauss(rng, target, sigma)));
    const win = +(bet * rtpRunning * (rng() < 0.32 ? rng() * 3 : 0)).toFixed(4);
    const latency = Math.max(5, gauss(rng, 28 + (day === 8 ? 60 : 0), 6));
    const hour = Math.floor((i / spinSamples) * 24);
    const minute = Math.floor(rng() * 60);
    out.push({
      type: 'spin',
      day,
      ts: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} UTC`,
      payload: {
        tenantId: tenant.id,
        playerId: `p_${Math.floor(rng() * 100000).toString(36)}`,
        gameId: game,
        bet,
        win,
        rtp_running: +rtpRunning.toFixed(4),
        latency_ms: +latency.toFixed(1),
      },
    });
  }

  // Cache events — proportional to spin volume.
  const cacheCount = Math.min(12, Math.max(2, Math.floor(volume / 50000)));
  for (let i = 0; i < cacheCount; i++) {
    const ns = CACHE_NAMESPACES[Math.floor(rng() * CACHE_NAMESPACES.length)];
    const hit = rng() < 0.88;
    out.push({
      type: 'cache',
      day,
      ts: `${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')} UTC`,
      payload: {
        namespace: ns,
        key: `k_${Math.floor(rng() * 1000).toString(16)}`,
        hit,
        ttl_remaining_s: hit ? Math.floor(rng() * 120) : 0,
      },
    });
  }

  // Audit hash-chain advances.
  const auditCount = Math.min(6, Math.max(1, Math.floor(volume / 100000)));
  for (let i = 0; i < auditCount; i++) {
    const sha = Array.from({ length: 8 }, () =>
      Math.floor(rng() * 16).toString(16)
    ).join('');
    out.push({
      type: 'audit',
      day,
      ts: `${String(Math.floor(rng() * 24)).padStart(2, '0')}:${String(Math.floor(rng() * 60)).padStart(2, '0')} UTC`,
      payload: {
        hash_chain_height: day * 1000 + i,
        event_type: pickWeighted(rng, [
          { v: 'spin_settled', w: 6 },
          { v: 'wallet_op', w: 2 },
          { v: 'cert_event', w: 1 },
        ]),
        sha256_hex_prefix: sha,
      },
    });
  }

  // Canary stage event — 1 per day.
  out.push({
    type: 'canary',
    day,
    ts: '00:00 UTC',
    payload: {
      stage: stage.stage,
      rollout_percent: stage.rolloutPercent,
      health_score: +(0.94 + rng() * 0.06).toFixed(3),
      gates_passed: 4,
    },
  });

  // Lab pipeline event — 1 per day.
  out.push({
    type: 'lab',
    day,
    ts: '00:00 UTC',
    payload: {
      stage: lab.stage,
      lab_name: day < 28 ? 'GLI' : 'GLI',
      days_in_stage: lab.daysInStage,
    },
  });

  // Anomaly event (if scheduled).
  const ano = anomalyDay(day);
  if (ano) {
    out.push({
      type: 'anomaly',
      day,
      ts: '09:17 UTC',
      payload: ano,
    });
  }

  // Operator dashboard refresh — 3 roles per day.
  for (const role of ['ops_admin', 'compliance_lead', 'cfo']) {
    out.push({
      type: 'operator',
      day,
      ts: '08:00 UTC',
      payload: {
        dashboard_refreshed_at: `day_${day}T08:00:00Z`,
        viewer_role: role,
      },
    });
  }

  return out;
}

/** Generate the full 30-day timeline. */
export function generateTimeline(opts = {}) {
  const seed = opts.seed ?? 42;
  const days = opts.days ?? 30;
  const rng = makeRng(seed);
  const events = [];
  const dailyCounts = [];
  for (let d = 0; d <= days; d++) {
    const dayEvents = generateDayEvents(d, rng);
    events.push(...dayEvents);
    dailyCounts.push({
      day: d,
      total: dayEvents.length,
      byType: countByType(dayEvents),
      spinVolume: spinVolume(d),
      canary: canaryStage(d),
      lab: labStage(d),
    });
  }
  return {
    seed,
    days,
    totalEvents: events.length,
    events,
    dailyCounts,
  };
}

function countByType(evs) {
  const out = {};
  for (const e of evs) out[e.type] = (out[e.type] ?? 0) + 1;
  return out;
}

/** Tenant catalogue exposed for narrator. */
export const TENANT_CATALOGUE = TENANTS;
export const RTP_TARGET_CATALOGUE = RTP_TARGETS;
