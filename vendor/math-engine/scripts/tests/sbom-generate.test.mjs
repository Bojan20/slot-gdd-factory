/**
 * W214 Faza 600.3 — SBOM generator specs.
 */

import { describe, it, expect } from 'vitest';
import {
  PACKAGE_ROOTS,
  readPkg,
  listDeps,
  depHash,
  buildBom,
  renderXml,
} from '../security/sbom-generate.mjs';

describe('W214 sbom · constants', () => {
  it('PACKAGE_ROOTS includes the root project', () => {
    expect(PACKAGE_ROOTS.find((r) => r.id === 'root')).toBeDefined();
  });

  it('PACKAGE_ROOTS includes all 8 sub-packages + sdk', () => {
    const ids = PACKAGE_ROOTS.map((r) => r.id);
    expect(ids).toContain('web/studio');
    expect(ids).toContain('sdk');
    expect(ids.length).toBeGreaterThanOrEqual(9);
  });
});

describe('W214 sbom · helpers', () => {
  it('listDeps captures dependencies + devDependencies + optional + peer', () => {
    const deps = listDeps({
      dependencies: { a: '1' },
      devDependencies: { b: '2' },
      optionalDependencies: { c: '3' },
      peerDependencies: { d: '4' },
    });
    expect(deps).toHaveLength(4);
    expect(deps.map((d) => d.section).sort()).toEqual([
      'dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies',
    ]);
  });

  it('depHash is deterministic + 64 chars (sha-256 hex)', () => {
    const a = depHash('foo', '1.2.3');
    const b = depHash('foo', '1.2.3');
    expect(a).toBe(b);
    expect(a).toHaveLength(64);
  });

  it('readPkg returns null when no package.json exists', () => {
    expect(readPkg('/nonexistent/path-that-does-not-exist')).toBeNull();
  });
});

describe('W214 sbom · bom construction', () => {
  it('buildBom produces a CycloneDX 1.5 document', () => {
    const bom = buildBom();
    expect(bom.bomFormat).toBe('CycloneDX');
    expect(bom.specVersion).toBe('1.5');
    expect(bom.metadata?.component?.type).toBe('application');
    expect(Array.isArray(bom.components)).toBe(true);
  });

  it('each component carries a SHA-256 hash', () => {
    const bom = buildBom();
    // bom.components might be empty if running in a clean env — but if
    // any exist they must follow the contract.
    for (const c of bom.components.slice(0, 25)) {
      expect(c.hashes?.[0]?.alg).toBe('SHA-256');
      expect(c.hashes?.[0]?.content).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it('component bom-refs are unique', () => {
    const bom = buildBom();
    const refs = bom.components.map((c) => c['bom-ref']);
    const uniq = new Set(refs);
    // No global collision; uniqueness within a single BoM render.
    expect(uniq.size).toBe(refs.length);
  });
});

describe('W214 sbom · xml renderer', () => {
  it('renderXml produces well-formed envelope', () => {
    const bom = buildBom();
    const xml = renderXml(bom);
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain('<bom xmlns="http://cyclonedx.org/schema/bom/1.5"');
    expect(xml.trim().endsWith('</bom>')).toBe(true);
  });

  it('renderXml escapes special characters in names', () => {
    const fakeBom = {
      serialNumber: 'urn:uuid:1',
      version: 1,
      metadata: { timestamp: '2026-01-01T00:00:00Z' },
      components: [{
        type: 'library',
        'bom-ref': 'pkg:npm/a<b@1.0',
        name: 'a<b>',
        version: '1.0',
        hashes: [{ alg: 'SHA-256', content: 'abcd'.repeat(16) }],
        licenses: [{ license: { id: 'MIT' } }],
      }],
    };
    const xml = renderXml(fakeBom);
    expect(xml).toContain('&lt;');
    expect(xml).toContain('&gt;');
  });
});
