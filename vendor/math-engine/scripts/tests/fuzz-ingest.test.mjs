/**
 * W215 Faza 600.4 — Findings ingestion specs.
 */

import { describe, it, expect } from 'vitest';
import {
  classify,
  suggestFixLocation,
  renderRegressionTest,
  renderIssueBody,
} from '../fuzz/ingest-findings.mjs';

describe('W215 ingest · classifier', () => {
  it('classifies timeouts', () => {
    expect(classify('operation timed out after 1000ms', '')).toBe('timeout');
  });
  it('classifies null-pointer dereferences', () => {
    expect(classify("Cannot read properties of undefined (reading 'foo')", '')).toBe('null_pointer');
  });
  it('classifies type errors', () => {
    expect(classify('x.map is not a function', 'TypeError: x.map is not a function')).toBe('type_error');
  });
  it('classifies stack overflows', () => {
    expect(classify('Maximum call stack size exceeded', '')).toBe('stack_overflow');
  });
  it('classifies state corruption (conservation violations)', () => {
    expect(classify('conservation violated: 100 != 95', '')).toBe('state_corruption');
  });
  it('classifies prototype pollution', () => {
    expect(classify('prototype pollution attempt: __proto__', '')).toBe('prototype_pollution');
  });
  it('classifies parse errors', () => {
    expect(classify('invalid_json near position 5', '')).toBe('parse_error');
  });
  it('classifies crypto/signature failures', () => {
    expect(classify('bad signature: hmac mismatch', '')).toBe('crypto');
  });
  it('falls back to uncategorised for unknown messages', () => {
    expect(classify('something weird happened', '')).toBe('uncategorised');
  });
});

describe('W215 ingest · suggestFixLocation', () => {
  it('returns first non-fuzz-lib frame', () => {
    const stack = [
      'Error: boom',
      '    at body (/path/to/scripts/fuzz/_lib.mjs:42:13)',
      '    at runIt (/path/to/server/lib/spin.mjs:88:7)',
    ].join('\n');
    expect(suggestFixLocation(stack)).toBe('/path/to/server/lib/spin.mjs:88');
  });
  it('returns null when no frames match', () => {
    expect(suggestFixLocation('Error: x\n  at native')).toBe(null);
  });
  it('skips _lib-v2 frames too', () => {
    const stack = [
      '    at runFuzzV2 (/p/scripts/fuzz/_lib-v2.mjs:200:10)',
      '    at body (/p/server/x.mjs:5:5)',
    ].join('\n');
    expect(suggestFixLocation(stack)).toBe('/p/server/x.mjs:5');
  });
});

describe('W215 ingest · regression generator', () => {
  it('emits a vitest test module for a crash record', () => {
    const out = renderRegressionTest('spin-engine', {
      seed: 1234,
      message: 'conservation violated',
      stack: '',
      key: 'abcd1234',
    });
    expect(out).toContain("describe('fuzz regression");
    expect(out).toContain('seed 1234');
    expect(out).toContain('FuzzRng');
  });

  it('handles missing seed', () => {
    const out = renderRegressionTest('h', { message: 'x', stack: '', key: 'k' });
    expect(out).toContain('seed 0');
  });
});

describe('W215 ingest · issue body generator', () => {
  it('contains all sections', () => {
    const out = renderIssueBody('spin-engine', {
      seed: 7,
      iter: 12,
      key: 'abc',
      message: 'oops',
      stack: '    at /p/file.mjs:10:1',
      sample: { foo: 'bar' },
    });
    expect(out).toContain('## Fuzz finding');
    expect(out).toContain('### Message');
    expect(out).toContain('### Stack');
    expect(out).toContain('### Minimal input sample');
    expect(out).toContain('### Reproduce');
    expect(out).toContain('FUZZ_SEED=7');
  });
});
