/**
 * W211 Faza 700.0 — Demo Theater narrator tests.
 *
 * Covers persona filtering, narrative coherence, and the live console
 * line formatter.
 */
import { describe, it, expect } from 'vitest';
import { generateTimeline } from '../demo-theater/events.mjs';
import { renderNarrative, narratorLine } from '../demo-theater/narrator.mjs';

const TL = generateTimeline({ seed: 42, days: 30 });

describe('narrator · markdown shape', () => {
  it('emits a per-day section for every day in the timeline', () => {
    const md = renderNarrative(TL, 'cto');
    for (let d = 0; d <= 30; d++) {
      expect(md).toContain(`### Day ${d}`);
    }
  });

  it('CTO narrative mentions latency or determinism somewhere', () => {
    const md = renderNarrative(TL, 'cto');
    expect(md.toLowerCase()).toMatch(/latency|determin/);
  });

  it('CMO narrative mentions revenue or marketplace', () => {
    const md = renderNarrative(TL, 'cmo');
    expect(md.toLowerCase()).toMatch(/marketplace|press|brand|tenants live/);
  });

  it('CFO narrative mentions ROI or lab fees', () => {
    const md = renderNarrative(TL, 'cfo');
    expect(md.toLowerCase()).toMatch(/roi|lab fee|€|savings/);
  });

  it('falls back to "all" persona if invalid persona supplied', () => {
    const md = renderNarrative(TL, 'unknown');
    expect(md).toContain('persona: ALL');
  });

  it('embeds the seed for reproducibility', () => {
    const md = renderNarrative(TL, 'cto');
    expect(md).toContain('Seed: `42`');
  });

  it('flags lab approval on day 29', () => {
    const md = renderNarrative(TL, 'cto');
    expect(md.toLowerCase()).toContain('lab approval');
  });
});

describe('narrator · live console lines', () => {
  it('formats a canary line with day + stage', () => {
    const line = narratorLine(8, 0, 'canary', 'cto', {});
    expect(line).toMatch(/Day 8/);
    expect(line).toMatch(/canary stage s\d/);
  });
});
