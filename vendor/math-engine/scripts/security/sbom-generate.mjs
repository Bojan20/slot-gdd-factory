#!/usr/bin/env node
/**
 * W214 Faza 600.3 — SBOM (Software Bill of Materials) generator.
 *
 * Emits a CycloneDX 1.5 JSON document plus a minimal XML rendering
 * covering:
 *
 *   - root package.json
 *   - 8 sub-package package.jsons
 *   - the Rust workspace (rust-sim/Cargo.toml)
 *
 * For each direct dependency we record:
 *   - name + version (as declared)
 *   - SHA-256 hash of the declared spec (deterministic identifier)
 *   - SPDX license (if discoverable in node_modules/<pkg>/package.json)
 *   - CVE summary (empty unless paired with `dependency-scan.mjs`)
 *
 * Output: reports/sbom/sbom-current.json + sbom-current.xml + a
 * commit-pinned snapshot `sbom-{commitShort}.json`.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..', '..');
const OUT_DIR = join(ROOT, 'reports', 'sbom');

export const PACKAGE_ROOTS = [
  { id: 'root', dir: ROOT },
  { id: 'web/studio', dir: join(ROOT, 'web/studio') },
  { id: 'web/operator', dir: join(ROOT, 'web/operator') },
  { id: 'web/regulator', dir: join(ROOT, 'web/regulator') },
  { id: 'web/marketplace', dir: join(ROOT, 'web/marketplace') },
  { id: 'web/pitch', dir: join(ROOT, 'web/pitch') },
  { id: 'web/onboarding', dir: join(ROOT, 'web/onboarding') },
  { id: 'web/support', dir: join(ROOT, 'web/support') },
  { id: 'sdk', dir: join(ROOT, 'sdk') },
];

export function gitShortSha() {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: ROOT, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

export function readPkg(dir) {
  const p = join(dir, 'package.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function listDeps(pkg) {
  const out = [];
  for (const section of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    const m = pkg?.[section] ?? {};
    for (const [name, version] of Object.entries(m)) {
      out.push({ name, version: String(version), section });
    }
  }
  return out;
}

export function depHash(name, version) {
  return createHash('sha256').update(`${name}@${version}`).digest('hex');
}

export function spdxFromInstalled(rootDir, name) {
  try {
    const sub = join(rootDir, 'node_modules', name, 'package.json');
    if (!existsSync(sub)) return 'UNKNOWN';
    const pj = JSON.parse(readFileSync(sub, 'utf8'));
    if (typeof pj.license === 'string') return pj.license;
    if (Array.isArray(pj.licenses)) return pj.licenses.map((l) => l.type ?? l).join(' OR ');
    if (pj.license && typeof pj.license === 'object' && pj.license.type) return pj.license.type;
    return 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  }
}

export function listRustCrates() {
  // Best-effort parse of rust-sim/Cargo.toml [dependencies] section.
  const cargoPath = join(ROOT, 'rust-sim', 'Cargo.toml');
  if (!existsSync(cargoPath)) return [];
  const src = readFileSync(cargoPath, 'utf8');
  const out = [];
  let inDeps = false;
  for (const line of src.split('\n')) {
    if (/^\[dependencies\]/.test(line)) { inDeps = true; continue; }
    if (/^\[/.test(line) && inDeps) inDeps = false;
    if (inDeps) {
      const m = line.match(/^([a-zA-Z0-9_-]+)\s*=\s*(.+)$/);
      if (m) {
        let version = m[2].trim();
        const versionMatch = version.match(/"([^"]+)"/) ?? version.match(/version\s*=\s*"([^"]+)"/);
        version = versionMatch ? versionMatch[1] : version.replace(/[{}]/g, '').trim();
        out.push({ name: m[1], version, ecosystem: 'cargo' });
      }
    }
  }
  return out;
}

export function buildComponents() {
  const components = [];
  for (const root of PACKAGE_ROOTS) {
    const pkg = readPkg(root.dir);
    if (!pkg) continue;
    for (const d of listDeps(pkg)) {
      components.push({
        type: 'library',
        // The same package can be declared by multiple manifests at the
        // same version (root + sub-package). Disambiguate the bom-ref
        // by qualifier so each component is uniquely addressable.
        'bom-ref': `pkg:npm/${d.name}@${cleanVersion(d.version)}?manifest=${encodeURIComponent(root.id)}&section=${d.section}`,
        name: d.name,
        version: cleanVersion(d.version),
        scope: d.section === 'devDependencies' ? 'optional' : 'required',
        hashes: [{ alg: 'SHA-256', content: depHash(d.name, d.version) }],
        licenses: [{ license: { id: spdxFromInstalled(ROOT, d.name) } }],
        properties: [
          { name: 'manifest', value: root.id },
          { name: 'section', value: d.section },
        ],
      });
    }
  }
  for (const c of listRustCrates()) {
    components.push({
      type: 'library',
      'bom-ref': `pkg:cargo/${c.name}@${cleanVersion(c.version)}?manifest=rust-sim`,
      name: c.name,
      version: cleanVersion(c.version),
      scope: 'required',
      hashes: [{ alg: 'SHA-256', content: depHash(c.name, c.version) }],
      licenses: [{ license: { id: 'UNKNOWN' } }],
      properties: [
        { name: 'manifest', value: 'rust-sim/Cargo.toml' },
        { name: 'ecosystem', value: 'cargo' },
      ],
    });
  }
  return components;
}

function cleanVersion(v) {
  return String(v).replace(/^[\^~>=<\s]+/, '').replace(/\s.*$/, '');
}

export function buildBom() {
  const sha = gitShortSha();
  return {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [{ vendor: 'slot-math-engine-template', name: 'sbom-generate.mjs', version: 'W214' }],
      component: {
        type: 'application',
        name: 'slot-math-engine-template',
        version: sha,
        'bom-ref': `pkg:slot-math-engine-template@${sha}`,
      },
    },
    components: buildComponents(),
  };
}

export function renderXml(bom) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<bom xmlns="http://cyclonedx.org/schema/bom/1.5" serialNumber="${bom.serialNumber}" version="${bom.version}">`,
    `  <metadata><timestamp>${bom.metadata.timestamp}</timestamp></metadata>`,
    '  <components>',
  ];
  for (const c of bom.components) {
    lines.push(`    <component type="${c.type}" bom-ref="${escapeXml(c['bom-ref'])}">`);
    lines.push(`      <name>${escapeXml(c.name)}</name>`);
    lines.push(`      <version>${escapeXml(c.version)}</version>`);
    if (c.hashes?.[0]) lines.push(`      <hashes><hash alg="${c.hashes[0].alg}">${c.hashes[0].content}</hash></hashes>`);
    if (c.licenses?.[0]) lines.push(`      <licenses><license><id>${escapeXml(c.licenses[0].license.id)}</id></license></licenses>`);
    lines.push('    </component>');
  }
  lines.push('  </components>');
  lines.push('</bom>');
  return lines.join('\n');
}

function escapeXml(s) {
  return String(s).replace(/[<>&"']/g, (c) => ({
    '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;',
  })[c]);
}

export function writeArtifacts(bom, outDir = OUT_DIR) {
  if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'sbom-current.json'), JSON.stringify(bom, null, 2));
  writeFileSync(join(outDir, 'sbom-current.xml'), renderXml(bom));
  const sha = bom.metadata.component.version;
  writeFileSync(join(outDir, `sbom-${sha}.json`), JSON.stringify(bom, null, 2));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bom = buildBom();
  writeArtifacts(bom);
  console.log(`sbom: ${bom.components.length} components, sha=${bom.metadata.component.version}`);
}
