/**
 * W212 Faza 600.1 — Mutation refresh tests (Agent C).
 */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import {
  parseArgs,
  parseStrykerJson,
  diffAgainstBaseline,
  findLatestStrykerJson,
  renderMd,
  refresh,
} from '../mutation/refresh.mjs';

function makeStrykerFixture() {
  return {
    files: {
      'src/foo.ts': {
        mutants: [
          { id: '1', status: 'Killed', mutatorName: 'ArithmeticOperator', location: { start: { line: 10 } } },
          { id: '2', status: 'Killed', mutatorName: 'ArithmeticOperator', location: { start: { line: 12 } } },
          { id: '3', status: 'Survived', mutatorName: 'ConditionalExpression', location: { start: { line: 14 } }, replacement: 'true' },
        ],
      },
      'src/bar.ts': {
        mutants: [
          { id: '4', status: 'Killed', mutatorName: 'StringLiteral', location: { start: { line: 1 } } },
          { id: '5', status: 'NoCoverage', mutatorName: 'ArithmeticOperator', location: { start: { line: 2 } } },
        ],
      },
    },
  };
}

function writeFixture(dir, contents, name = 'scoped-test.json') {
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

describe('mutation refresh — parseArgs', () => {
  it('defaults to scoped + with-run', () => {
    const a = parseArgs(['node', 'x']);
    expect(a.scoped).toBe(true);
    expect(a.noRun).toBe(false);
  });

  it('flips to full mode with --full', () => {
    const a = parseArgs(['node', 'x', '--full']);
    expect(a.scoped).toBe(false);
  });

  it('honours --no-run', () => {
    const a = parseArgs(['node', 'x', '--no-run']);
    expect(a.noRun).toBe(true);
  });
});

describe('mutation refresh — parseStrykerJson', () => {
  it('counts killed/survived/timeout/noCoverage correctly', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mut-refresh-'));
    const p = writeFixture(dir, makeStrykerFixture());
    const s = parseStrykerJson(p);
    expect(s.total).toBe(5);
    expect(s.killed).toBe(3);
    expect(s.survived).toBe(1);
    expect(s.noCoverage).toBe(1);
    // strict = (killed + timeout) / scored = 3/5 = 0.6
    expect(s.scoreStrict).toBeCloseTo(0.6, 5);
  });

  it('captures per-file score breakdown and lists survivors', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mut-refresh-'));
    const p = writeFixture(dir, makeStrykerFixture());
    const s = parseStrykerJson(p);
    expect(Object.keys(s.perFile)).toContain('src/foo.ts');
    expect(s.perFile['src/foo.ts'].survived).toBe(1);
    expect(s.survivors.length).toBe(1);
    expect(s.survivors[0].file).toBe('src/foo.ts');
    expect(s.survivors[0].mutator).toBe('ConditionalExpression');
  });
});

describe('mutation refresh — diffAgainstBaseline', () => {
  it('marks first-run when no baseline is provided', () => {
    const d = diffAgainstBaseline({ scoreStrict: 0.8, perFile: {}, survivors: [] }, null);
    expect(d.firstRun).toBe(true);
  });

  it('detects per-file regression when score drops vs baseline', () => {
    const current = {
      scoreStrict: 0.6,
      perFile: { 'src/foo.ts': { scoreStrict: 0.5 } },
      survivors: [],
    };
    const baseline = { scores: { ts: 0.7, 'ts:src/foo.ts': 0.9 } };
    const d = diffAgainstBaseline(current, baseline);
    expect(d.perFileRegression.length).toBe(1);
    expect(d.perFileRegression[0].file).toBe('src/foo.ts');
  });

  it('lists new survivors that are not in baseline survivor set', () => {
    const current = {
      scoreStrict: 0.6,
      perFile: {},
      survivors: [{ file: 'src/foo.ts', line: 10, mutator: 'X' }],
    };
    const baseline = { scores: {}, survivors: [] };
    const d = diffAgainstBaseline(current, baseline);
    expect(d.newSurvivors.length).toBe(1);
  });

  it('does not flag survivors that match baseline survivor set', () => {
    const survivor = { file: 'src/foo.ts', line: 10, mutator: 'X' };
    const current = {
      scoreStrict: 0.6,
      perFile: {},
      survivors: [survivor],
    };
    const baseline = { scores: {}, survivors: [survivor] };
    const d = diffAgainstBaseline(current, baseline);
    expect(d.newSurvivors.length).toBe(0);
  });
});

describe('mutation refresh — renderMd', () => {
  it('produces a markdown report containing headline counts', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mut-refresh-md-'));
    const p = writeFixture(dir, makeStrykerFixture());
    const r = refresh({ noRun: true, jsonPath: p, baseline: null, scoped: true });
    const md = renderMd(r);
    expect(md).toContain('Mutation Refresh');
    expect(md).toContain('Total mutants');
  });
});

describe('mutation refresh — findLatestStrykerJson', () => {
  it('returns null when directory does not exist', () => {
    const dir = resolve(tmpdir(), `does-not-exist-${Date.now()}`);
    expect(findLatestStrykerJson(dir)).toBeNull();
  });

  it('finds scoped-*.json artifact in directory', () => {
    const dir = mkdtempSync(resolve(tmpdir(), 'mut-refresh-find-'));
    const p = writeFixture(dir, makeStrykerFixture(), 'scoped-2026-05-18.json');
    const found = findLatestStrykerJson(dir);
    expect(found).toBe(p);
  });
});
