/**
 * W211 Faza 700.0 — Demo Theater events module tests.
 *
 * Confirms shape, determinism, and distribution sanity for the event
 * factory.
 */
import { describe, it, expect } from 'vitest';
import {
  generateTimeline,
  generateDayEvents,
  canaryStage,
  labStage,
  makeRng,
} from '../demo-theater/events.mjs';

describe('events · canaryStage schedule', () => {
  it('day 0 has stage 0 / 0%', () => {
    expect(canaryStage(0)).toEqual({ stage: 0, rolloutPercent: 0 });
  });
  it('day 3 → stage 1 @ 1%', () => {
    expect(canaryStage(3)).toEqual({ stage: 1, rolloutPercent: 1 });
  });
  it('day 22 → stage 4 @ 100% (post-pilot)', () => {
    expect(canaryStage(22)).toEqual({ stage: 4, rolloutPercent: 100 });
  });
});

describe('events · labStage schedule', () => {
  it('pre-submission window before day 22', () => {
    expect(labStage(10).stage).toBe('pre_submission');
  });
  it('day 22 = submitted', () => {
    expect(labStage(22).stage).toBe('submitted');
  });
  it('day 29 = approved', () => {
    expect(labStage(29).stage).toBe('approved');
  });
  it('day 30 = production_cert', () => {
    expect(labStage(30).stage).toBe('production_cert');
  });
});

describe('events · generateDayEvents shape', () => {
  it('every event has type / day / ts / payload', () => {
    const rng = makeRng(42);
    const events = generateDayEvents(5, rng);
    for (const e of events) {
      expect(typeof e.type).toBe('string');
      expect(typeof e.day).toBe('number');
      expect(typeof e.ts).toBe('string');
      expect(typeof e.payload).toBe('object');
    }
  });

  it('emits at least 1 canary, lab, and operator event per day', () => {
    const rng = makeRng(42);
    const events = generateDayEvents(10, rng);
    expect(events.some((e) => e.type === 'canary')).toBe(true);
    expect(events.some((e) => e.type === 'lab')).toBe(true);
    expect(events.some((e) => e.type === 'operator')).toBe(true);
  });

  it('day 8 emits the wallet_timeout anomaly', () => {
    const rng = makeRng(42);
    const events = generateDayEvents(8, rng);
    const ano = events.find((e) => e.type === 'anomaly');
    expect(ano?.payload.type).toBe('wallet_timeout');
  });

  it('day 17 emits the rtp_drift anomaly', () => {
    const rng = makeRng(42);
    const events = generateDayEvents(17, rng);
    const ano = events.find((e) => e.type === 'anomaly');
    expect(ano?.payload.type).toBe('rtp_drift');
  });
});

describe('events · timeline determinism', () => {
  it('same seed → same total event count', () => {
    const a = generateTimeline({ seed: 42, days: 30 });
    const b = generateTimeline({ seed: 42, days: 30 });
    expect(a.totalEvents).toBe(b.totalEvents);
    expect(JSON.stringify(a.events[0])).toBe(JSON.stringify(b.events[0]));
  });

  it('different seed → different first spin payload', () => {
    const a = generateTimeline({ seed: 1, days: 30 });
    const b = generateTimeline({ seed: 999, days: 30 });
    const a0 = a.events.find((e) => e.type === 'spin');
    const b0 = b.events.find((e) => e.type === 'spin');
    expect(JSON.stringify(a0)).not.toBe(JSON.stringify(b0));
  });

  it('30-day run emits all 7 event types', () => {
    const t = generateTimeline({ seed: 42, days: 30 });
    const types = new Set(t.events.map((e) => e.type));
    for (const x of ['spin', 'cache', 'audit', 'canary', 'lab', 'anomaly', 'operator']) {
      expect(types.has(x)).toBe(true);
    }
  });
});

describe('events · spin distribution sanity', () => {
  it('spin volume grows with canary stage (more spins on day 20 vs day 1)', () => {
    const t = generateTimeline({ seed: 42, days: 30 });
    const d1 = t.events.filter((e) => e.day === 1 && e.type === 'spin').length;
    const d20 = t.events.filter((e) => e.day === 20 && e.type === 'spin').length;
    expect(d20).toBeGreaterThanOrEqual(d1);
  });
});
