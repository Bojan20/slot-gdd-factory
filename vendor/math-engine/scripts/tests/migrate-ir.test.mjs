/**
 * CORTI 200.6-DEVOPS — tests for scripts/migrate-ir.mjs
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LATEST_VERSION,
  MIGRATIONS,
  migrateIr,
  validateIr,
  migrateFile,
  parseArgs,
  runMigrate,
} from '../migrate-ir.mjs';

function makeIr(extra = {}) {
  return {
    schema_version: '1.0.0',
    meta: { id: 'demo', name: 'Demo' },
    topology: { kind: 'rectangular', reels: 5, rows: 3 },
    ...extra,
  };
}

describe('migrate-ir registry', () => {
  it('registry has 0.9.x→1.0.0 and 1.0.0→1.1.0 steps', () => {
    const fromVersions = MIGRATIONS.map((m) => m.from);
    expect(fromVersions).toContain('0.9.x');
    expect(fromVersions).toContain('1.0.0');
  });

  it('latest version constant is 1.1.0', () => {
    expect(LATEST_VERSION).toBe('1.1.0');
  });
});

describe('migrate-ir transformations', () => {
  it('0.9 IR with `metadata` becomes 1.0 IR with `meta`', () => {
    const v09 = {
      metadata: { id: 'demo', name: 'Demo' },
      grid: { reels: 5, rows: 3 },
    };
    const out = migrateIr(v09, '1.0.0');
    expect(out.schema_version).toBe('1.0.0');
    expect(out.meta).toBeDefined();
    expect(out.meta.id).toBe('demo');
    expect(out.topology).toBeDefined();
  });

  it('1.0 IR migrates forward to 1.1.0 with governance block', () => {
    const out = migrateIr(makeIr(), '1.1.0');
    expect(out.schema_version).toBe('1.1.0');
    expect(out.governance).toBeDefined();
    expect(Array.isArray(out.governance.jurisdiction_tags)).toBe(true);
  });

  it('already-at-target IR is returned unchanged', () => {
    const ir = makeIr({ schema_version: '1.1.0', governance: { jurisdiction_tags: ['UKGC'] } });
    const out = migrateIr(ir, '1.1.0');
    expect(out.governance.jurisdiction_tags).toEqual(['UKGC']);
  });

  it('validateIr flags missing fields', () => {
    expect(validateIr(null).length).toBeGreaterThan(0);
    expect(validateIr({}).length).toBeGreaterThan(0);
    expect(validateIr(makeIr())).toEqual([]);
  });
});

describe('migrate-ir file ops', () => {
  it('migrateFile dry-run does not modify file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-ir-test-'));
    const file = join(dir, 'a.ir.json');
    const ir = makeIr();
    writeFileSync(file, JSON.stringify(ir), 'utf8');
    const before = readFileSync(file, 'utf8');
    const rep = migrateFile(file, { dryRun: true, target: '1.1.0' });
    expect(rep.ok).toBe(true);
    expect(rep.fromVersion).toBe('1.0.0');
    expect(rep.toVersion).toBe('1.1.0');
    expect(readFileSync(file, 'utf8')).toBe(before);
  });

  it('migrateFile writes new IR and keeps .bak', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-ir-test-'));
    const file = join(dir, 'b.ir.json');
    writeFileSync(file, JSON.stringify(makeIr()), 'utf8');
    const rep = migrateFile(file, { target: '1.1.0' });
    expect(rep.ok).toBe(true);
    expect(existsSync(file + '.bak')).toBe(true);
    const after = JSON.parse(readFileSync(file, 'utf8'));
    expect(after.schema_version).toBe('1.1.0');
    expect(after.governance).toBeDefined();
  });

  it('migrateFile reports invalid JSON', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-ir-test-'));
    const file = join(dir, 'bad.ir.json');
    writeFileSync(file, '{ this is not json', 'utf8');
    const rep = migrateFile(file, { dryRun: true });
    expect(rep.ok).toBe(false);
    expect(rep.reason).toContain('invalid_json');
  });

  it('batch run via runMigrate processes every *.ir.json in tree', () => {
    const dir = mkdtempSync(join(tmpdir(), 'migrate-ir-batch-'));
    const subdir = join(dir, 'sub');
    mkdirSync(subdir, { recursive: true });
    writeFileSync(join(dir, 'a.ir.json'), JSON.stringify(makeIr()), 'utf8');
    writeFileSync(join(subdir, 'b.ir.json'), JSON.stringify(makeIr()), 'utf8');
    const reports = runMigrate({ file: null, batch: dir, dryRun: true, target: '1.1.0' });
    expect(reports.length).toBe(2);
    expect(reports.every((r) => r.ok)).toBe(true);
  });

  it('runMigrate throws when neither --file nor --batch supplied', () => {
    expect(() => runMigrate({ file: null, batch: null, dryRun: false, target: '1.1.0' })).toThrow();
  });
});

describe('migrate-ir argv parsing', () => {
  it('parses --file --target --dry-run', () => {
    const args = parseArgs(['--file', '/tmp/x.ir.json', '--target', '1.1.0', '--dry-run']);
    expect(args.file).toBe('/tmp/x.ir.json');
    expect(args.target).toBe('1.1.0');
    expect(args.dryRun).toBe(true);
  });

  it('parses --batch', () => {
    const args = parseArgs(['--batch', '/tmp/ir-lib']);
    expect(args.batch).toBe('/tmp/ir-lib');
  });
});
