/**
 * W211 Faza 700.0 — Demo Theater storyteller / narrator.
 *
 * Consumes the deterministic timeline produced by events.mjs and emits a
 * human-readable narrative in the voice appropriate to the target
 * persona. The narrative is written to
 * `dist/demo-theater/narrative-{ts}.md` as ~30 day-stories.
 *
 * Personas:
 *   cto  — technical: latency, replay determinism, RNG quality, cache
 *   cmo  — commercial: revenue, time-to-market, marketplace activity
 *   cfo  — financial: lab fees avoided, ROI accumulation, NPV ticker
 *
 * The same timeline produces three differently-framed narratives — what
 * shifts is the emphasis, the metrics, and the executive headline.
 */

import { canaryStage, labStage, TENANT_CATALOGUE, RTP_TARGET_CATALOGUE } from './events.mjs';

const PERSONAS = new Set(['cto', 'cmo', 'cfo']);

/** Fallback persona — uses all-of-the-above headers. */
const ALL_PERSONA = 'all';

function summarizeDay(day, dayEvents, persona) {
  const spins = dayEvents.filter((e) => e.type === 'spin');
  const anomalies = dayEvents.filter((e) => e.type === 'anomaly');
  const canary = canaryStage(day);
  const lab = labStage(day);
  const cumulativeSpinVolume = day === 0 ? 0 : approxCumulativeVolume(day);

  // Average RTP/latency from samples for the day.
  let rtpSum = 0;
  let latSum = 0;
  let revenue = 0;
  for (const s of spins) {
    rtpSum += s.payload.rtp_running;
    latSum += s.payload.latency_ms;
    revenue += s.payload.bet - s.payload.win;
  }
  const rtpAvg = spins.length ? rtpSum / spins.length : 0;
  const latAvg = spins.length ? latSum / spins.length : 0;

  const tenants = TENANT_CATALOGUE.map((t) => t.region).join(' & ');
  const driftPp = +(((rtpAvg - 0.96) * 100).toFixed(2));

  // Persona-specific headline.
  let headline = '';
  if (persona === 'cto') {
    headline = `latency_p99 ≈ ${latAvg.toFixed(1)}ms · canary stage s${canary.stage} · replay determinism ok`;
  } else if (persona === 'cmo') {
    headline = `${tenants} live · ${spins.length} sample spins · marketplace tile views climbing`;
  } else if (persona === 'cfo') {
    headline = `est. revenue today ≈ €${(revenue * 200).toFixed(0)} · lab-fee savings tracking on plan`;
  } else {
    headline = `s${canary.stage} canary @ ${canary.rolloutPercent}% · lab ${lab.stage} · ${spins.length} sample spins`;
  }

  // Phase-specific bullet body.
  const bullets = [];
  if (day === 0) {
    bullets.push('- Pilot seed completed. Integration smoke suite green (6/6 scripts).');
    if (persona === 'cto') bullets.push('- RNG attestation chain bootstrapped. HSM keys provisioned.');
    if (persona === 'cmo') bullets.push('- Pilot kickoff comms sent. Brand assets staged in marketplace.');
    if (persona === 'cfo') bullets.push('- Lab fees frozen at €0 — pre-submission window.');
  } else if (day >= 1 && day <= 7) {
    bullets.push(`- First wave traffic on ${tenants}.`);
    bullets.push(`- RTP drift vs production = ${(driftPp >= 0 ? '+' : '')}${driftPp}pp (within 0.5pp tolerance).`);
    if (persona === 'cto') bullets.push('- Cache hit-rate ≈ 88%. All 4 health gates green.');
    if (persona === 'cmo') bullets.push('- ~1 200 unique players cohort A. Session length p50 ≈ 9 min.');
    if (persona === 'cfo') bullets.push(`- ROI ticker: −€${(8000 - day * 1200).toFixed(0)} (still in setup).`);
  } else if (day >= 8 && day <= 14) {
    bullets.push(`- Canary stage s${canary.stage} (${canary.rolloutPercent}%) — health score ≥ 0.94.`);
    if (anomalies.length > 0) {
      bullets.push(`- ANOMALY: ${anomalies[0].payload.message}. No customer impact.`);
    }
    if (persona === 'cto') bullets.push('- Anomaly auto-mitigated by canary controller. Replay deterministic.');
    if (persona === 'cmo') bullets.push('- Conversion to second session ≈ 42%, marketplace tile click-through up 18%.');
    if (persona === 'cfo') bullets.push(`- ROI ticker: +€${(day * 2500 - 12000).toFixed(0)} (break-even crossed ~day 12).`);
  } else if (day >= 15 && day <= 21) {
    bullets.push(`- Full traffic ramp — ${cumulativeSpinVolume.toLocaleString()} spins cumulative.`);
    if (anomalies.length > 0) {
      bullets.push(`- ANOMALY: ${anomalies[0].payload.message}. Within tolerance, no rollback.`);
    }
    if (persona === 'cto') bullets.push('- Operator dashboards refreshing at SLA; alert noise ≈ 0.');
    if (persona === 'cmo') bullets.push('- Quick Hit Dragons is top-3 by spins on UK tenant.');
    if (persona === 'cfo') bullets.push(`- Lab fees avoided this week: €${((day - 14) * 4500).toFixed(0)} (vs traditional cert).`);
  } else if (day === 22) {
    bullets.push('- GLI bundle generated, HSM-signed, ready for submission.');
    bullets.push('- Filename: quick-hit-dragons-gli-ukgc-2026-06-09.zip · 12 documents · 395 KB.');
    if (persona === 'cto') bullets.push('- Manifest SHA-256: 7f3a09c1... · audit chain height: 22 005.');
    if (persona === 'cmo') bullets.push('- Press kit prepared for cert announcement.');
    if (persona === 'cfo') bullets.push('- Submission window opens — clock starts on lab SLA.');
  } else if (day >= 23 && day <= 28) {
    bullets.push(`- Lab cycle day ${day - 22}: ${lab.stage.replace(/_/g, ' ')}.`);
    if (persona === 'cto') bullets.push('- Revision pack regenerated in 18 min (vs 5 days traditional).');
    if (persona === 'cmo') bullets.push('- Operator pre-sells on the cert lockbox demo.');
    if (persona === 'cfo') bullets.push(`- Cumulative lab-fee savings: €${(25000 + (day - 22) * 6000).toFixed(0)}.`);
  } else if (day === 29) {
    bullets.push('- LAB APPROVAL. Cert PDF received. Production certificate issued.');
    if (persona === 'cto') bullets.push('- Cert lockbox slot updated · hash chain anchored.');
    if (persona === 'cmo') bullets.push('- Press release ready · operator can announce mainline GA.');
    if (persona === 'cfo') bullets.push('- NPV positive by week 4. ROI 3.8× projected over year-1.');
  } else if (day === 30) {
    bullets.push('- PILOT COMPLETE. Final dossier sealed.');
    bullets.push(`- 30-day totals: ${cumulativeSpinVolume.toLocaleString()} spins · 1 anomaly auto-mitigated · 0 rollbacks.`);
    if (persona === 'cto') bullets.push('- Full timeline replayable bit-identically with seed 42.');
    if (persona === 'cmo') bullets.push('- Pilot → portfolio expansion proposal queued for board.');
    if (persona === 'cfo') bullets.push('- 30-day ROI: +€48 200. Lab fees avoided: €61 500.');
  }

  return { headline, bullets };
}

/**
 * Approximate cumulative spin volume up to and including `day`. Mirrors
 * spinVolume() in events.mjs.
 */
function approxCumulativeVolume(day) {
  let sum = 0;
  for (let d = 1; d <= day; d++) {
    sum += dayVolume(d);
  }
  return sum;
}

function dayVolume(day) {
  if (day === 0) return 0;
  if (day === 1) return 1000;
  if (day === 2) return 5000;
  if (day < 5) return 25000;
  if (day < 8) return 100000;
  if (day < 15) return 250000;
  if (day < 22) return 500000;
  return 750000;
}

/** Group events by day. */
function bucketByDay(events) {
  const buckets = new Map();
  for (const e of events) {
    const d = e.day ?? 0;
    if (!buckets.has(d)) buckets.set(d, []);
    buckets.get(d).push(e);
  }
  return buckets;
}

/**
 * Render the narrative for a given timeline + persona.
 *
 * Returns a Markdown string with a TOC, a per-day section, and a
 * closing C-level summary tied to the persona.
 */
export function renderNarrative(timeline, persona = ALL_PERSONA) {
  const p = PERSONAS.has(persona) ? persona : ALL_PERSONA;
  const buckets = bucketByDay(timeline.events);
  const lines = [];
  lines.push(`# Demo Theater — 30-day pilot narrative (persona: ${p.toUpperCase()})`);
  lines.push('');
  lines.push(`Seed: \`${timeline.seed}\` · Total events: ${timeline.totalEvents}`);
  lines.push('');
  lines.push('## Timeline');
  lines.push('');

  for (let d = 0; d <= timeline.days; d++) {
    const dayEvents = buckets.get(d) ?? [];
    const { headline, bullets } = summarizeDay(d, dayEvents, p);
    lines.push(`### Day ${d}`);
    lines.push(`_${headline}_`);
    lines.push('');
    for (const b of bullets) lines.push(b);
    lines.push('');
  }

  lines.push('## Executive summary');
  lines.push('');
  if (p === 'cto') {
    lines.push('- 30 days · 4.4M spins sample · p99 latency stable ≤ 95ms · 0 rollbacks.');
    lines.push('- Replay determinism: every event reproducible from seed `42`.');
    lines.push('- 1 wallet-timeout anomaly auto-mitigated by canary controller within 12s.');
  } else if (p === 'cmo') {
    lines.push('- 30 days · 3 tenants (UK / MT / DE) · marketplace tile click-through +18%.');
    lines.push('- Time-to-cert: 22 days vs traditional 90+ — 4.1× faster.');
    lines.push('- Quick Hit Dragons top-3 by spins on lead operator.');
  } else if (p === 'cfo') {
    lines.push('- 30-day ROI: +€48 200. Lab fees avoided: €61 500.');
    lines.push('- Break-even crossed ~day 12. NPV positive by week 4.');
    lines.push('- Year-1 projection: 3.8× return on pilot spend.');
  } else {
    lines.push('- 30 days, 1 anomaly auto-mitigated, 0 rollbacks, lab approval day 29.');
    lines.push('- Pilot dossier finalized day 30 — ready for portfolio expansion.');
  }
  lines.push('');
  return lines.join('\n');
}

/** Emit a single short narration line (used by orchestrator console). */
export function narratorLine(day, hour, kind, persona, payload) {
  // Used by orchestrator for live console output.
  const ts = `Day ${day}, ${String(hour).padStart(2, '0')}:00 UTC`;
  if (kind === 'canary') {
    const s = canaryStage(day);
    return `${ts}: canary stage s${s.stage} @ ${s.rolloutPercent}% — health ok.`;
  }
  if (kind === 'anomaly') {
    return `${ts}: ANOMALY — ${payload.message ?? payload.type}.`;
  }
  if (kind === 'lab') {
    const l = labStage(day);
    return `${ts}: lab pipeline → ${l.stage.replace(/_/g, ' ')} (day ${l.daysInStage}).`;
  }
  if (kind === 'spin' && persona === 'cto') {
    return `${ts}: spin sample · latency ${payload.latency_ms}ms · rtp_running ${payload.rtp_running}.`;
  }
  if (kind === 'spin' && persona === 'cmo') {
    return `${ts}: spin on ${payload.gameId} · player ${payload.playerId}.`;
  }
  if (kind === 'spin' && persona === 'cfo') {
    return `${ts}: spin net €${(payload.bet - payload.win).toFixed(2)}.`;
  }
  return `${ts}: ${kind} event.`;
}

export { PERSONAS, ALL_PERSONA };
