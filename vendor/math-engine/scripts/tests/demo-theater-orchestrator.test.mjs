/**
 * W211 Faza 700.0 — Demo Theater orchestrator tests.
 *
 * Validates that the 30-day scripted pilot orchestrator emits a
 * complete timeline, writes the three output artifacts, and remains
 * deterministic under a fixed seed.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { runOrchestrator } from '../demo-theater/orchestrator.mjs';

let result;
let tmpDir;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), 'theater-orch-'));
  result = await runOrchestrator({
    cli: { synthetic: true, seed: 42, days: 30, persona: 'cto', quiet: true },
    outDir: tmpDir,
  });
});

describe('demo theater orchestrator — base run', () => {
  it('returns a result object with seed, days, totalEvents', () => {
    expect(result.seed).toBe(42);
    expect(result.days).toBe(30);
    expect(result.totalEvents).toBeGreaterThan(0);
  });

  it('writes timeline.json artifact', () => {
    expect(existsSync(result.paths.json)).toBe(true);
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    expect(json.totalEvents).toBe(result.totalEvents);
    expect(Array.isArray(json.events)).toBe(true);
    expect(json.events.length).toBe(result.totalEvents);
  });

  it('writes timeline.md artifact with 31 day headings (0..30)', () => {
    expect(existsSync(result.paths.md)).toBe(true);
    const md = readFileSync(result.paths.md, 'utf8');
    for (let d = 0; d <= 30; d++) {
      expect(md).toContain(`## Day ${d}`);
    }
  });

  it('writes narrative.md artifact', () => {
    expect(existsSync(result.paths.narrative)).toBe(true);
    const md = readFileSync(result.paths.narrative, 'utf8');
    expect(md).toContain('Demo Theater');
    expect(md).toContain('Day 0');
    expect(md).toContain('Day 30');
  });

  it('emits every event type at least once across the run', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    const types = new Set(json.events.map((e) => e.type));
    for (const t of ['spin', 'cache', 'audit', 'canary', 'lab', 'anomaly', 'operator']) {
      expect(types.has(t)).toBe(true);
    }
  });

  it('events are sorted day-ascending', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    let lastDay = -1;
    for (const e of json.events) {
      expect(e.day).toBeGreaterThanOrEqual(lastDay);
      lastDay = e.day;
    }
  });

  it('day 0 covers the seed phase', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    const day0 = json.events.filter((e) => e.day === 0);
    expect(day0.length).toBeGreaterThan(0);
  });

  it('day 22 emits lab submission stage', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    const labOn22 = json.events.find((e) => e.day === 22 && e.type === 'lab');
    expect(labOn22?.payload?.stage).toBe('submitted');
  });

  it('day 29 reflects lab approval', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    const labOn29 = json.events.find((e) => e.day === 29 && e.type === 'lab');
    expect(labOn29?.payload?.stage).toBe('approved');
  });

  it('exactly 2 anomalies are seeded over 30 days', () => {
    const json = JSON.parse(readFileSync(result.paths.json, 'utf8'));
    const anomalies = json.events.filter((e) => e.type === 'anomaly');
    expect(anomalies.length).toBe(2);
  });

  it('run completes under 5 seconds in synthetic mode', () => {
    expect(result.wallTimeMs).toBeLessThan(5000);
  });
});

describe('demo theater orchestrator — determinism', () => {
  it('same seed produces identical event count', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'theater-a-'));
    const dirB = mkdtempSync(join(tmpdir(), 'theater-b-'));
    const a = await runOrchestrator({
      cli: { synthetic: true, seed: 7, days: 30, persona: 'cmo', quiet: true },
      outDir: dirA,
    });
    const b = await runOrchestrator({
      cli: { synthetic: true, seed: 7, days: 30, persona: 'cmo', quiet: true },
      outDir: dirB,
    });
    expect(a.totalEvents).toBe(b.totalEvents);
    const jaEvs = JSON.parse(readFileSync(a.paths.json, 'utf8')).events;
    const jbEvs = JSON.parse(readFileSync(b.paths.json, 'utf8')).events;
    expect(jaEvs.length).toBe(jbEvs.length);
    expect(jaEvs[0].type).toBe(jbEvs[0].type);
    expect(jaEvs[jaEvs.length - 1].day).toBe(jbEvs[jbEvs.length - 1].day);
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  it('different seed produces different event detail', async () => {
    const dirA = mkdtempSync(join(tmpdir(), 'theater-c-'));
    const dirB = mkdtempSync(join(tmpdir(), 'theater-d-'));
    const a = await runOrchestrator({
      cli: { synthetic: true, seed: 1, days: 30, quiet: true },
      outDir: dirA,
    });
    const b = await runOrchestrator({
      cli: { synthetic: true, seed: 999, days: 30, quiet: true },
      outDir: dirB,
    });
    // Counts can vary slightly thanks to Poisson volumes.
    const jaEvs = JSON.parse(readFileSync(a.paths.json, 'utf8')).events.filter((e) => e.type === 'spin');
    const jbEvs = JSON.parse(readFileSync(b.paths.json, 'utf8')).events.filter((e) => e.type === 'spin');
    // At least the first spin payloads should differ.
    expect(JSON.stringify(jaEvs[0])).not.toBe(JSON.stringify(jbEvs[0]));
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });
});
