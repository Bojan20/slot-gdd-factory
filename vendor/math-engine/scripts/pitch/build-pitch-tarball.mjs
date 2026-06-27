#!/usr/bin/env node
/**
 * W212 Faza 800.0 — Pitch Tarball Bundler — main builder.
 *
 * Single-command pitch tarball export:
 *   npm run pitch:tarball [--include-binaries] [--format=tar.gz|zip|tar]
 *                         [--output=dist/pitch/] [--operator=Vendor B]
 *                         [--bundle-version=YYYYMMDD] [--sign]
 *
 * Bundles ALL pitch + proof artifacts into a single distributable archive:
 *   pitch-package/
 *     README.md               (auto-generated, per-role reading order)
 *     MANIFEST.json           (SHA-256 of every file, signed if --sign)
 *     INSTALL.md              (reproducer steps)
 *     CONTACT.md              (sales placeholder)
 *     VERSION.txt             (engine commit + bundle version + timestamp)
 *     verify.mjs              (companion verifier, embedded)
 *     sales/
 *       01-executive-deck.html
 *       02-roi-calculator.html
 *       03-technical-deep-dive.html
 *       04-competitive-matrix.html
 *       05-pitch-guide.html
 *       06-pilot-dossier.html
 *       storyboards/storyboard-30sec-elevator.md
 *       storyboards/storyboard-5min-deep.md
 *       storyboards/storyboard-90min-board.md
 *     proof/
 *       integration-suite-latest.json
 *       smoke-test-latest.json
 *       closed-form-portfolio.json
 *       industry-pattern-catalog.json
 *       lw-coverage-matrix.json
 *       demo-theater-narrative-cto.md
 *       demo-theater-timeline.json
 *       cert-dossier-samples/{lab}-manifest.json + {lab}.sig
 *     reference/
 *       PILOT_GUIDE.md
 *       PILOT_ARCHITECTURE.md
 *       DEPLOYMENT.md
 *       MULTI_TENANT.md
 *       WALLET_PROVIDERS.md
 *       MARKETPLACE_API.md
 *       CERT_LAB_SUBMISSION.md
 *
 * Bundle filename:
 *   dist/pitch/slot-math-engine-pitch-vYYYYMMDD-{commit-short}.tar.gz
 *
 * Pure Node 18+ stdlib (node:crypto, node:zlib, node:fs.promises). No new deps.
 * Deterministic: same git commit + same bundle-version + same set of source
 * files → byte-identical archive bytes (modulo timestamps embedded in source
 * data — those are inherited from the input files, not minted here).
 */

import { promises as fs, existsSync } from 'node:fs';
import { dirname, resolve, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

import {
  buildManifest,
  computeExpiresAt,
  deriveBundleFilename,
  manifestToJsonBytes,
  resolveGitInfo,
  sha256Hex,
} from './tarball-metadata.mjs';
import {
  DEFAULT_OPERATOR_ID,
  applyBranding,
  applyBrandingToHtml,
  loadOperatorManifest,
} from './operator-branding.mjs';
import {
  composeDeckFile,
  composeFromMarkdownFile,
  markdownToHtmlBody,
  wrapHtmlDocument,
} from './compose-standalone-html.mjs';
import {
  renderContact,
  renderInstall,
  renderReadme,
  renderVersionTxt,
  DEFAULT_OPERATOR_NAME,
  DEFAULT_STATS,
} from './generate-pitch-readme.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(HERE, '..', '..');

// ─── CLI parse ───────────────────────────────────────────────────────────

export function parseArgs(argv) {
  const a = {
    output: 'dist/pitch',
    format: 'tar.gz',
    includeBinaries: false,
    operator: DEFAULT_OPERATOR_NAME,
    operatorId: null,
    bundleVersion: null,
    dryRun: false,
    sign: false,
  };
  for (const arg of argv.slice(2)) {
    if (arg === '--include-binaries') a.includeBinaries = true;
    else if (arg === '--dry-run') a.dryRun = true;
    else if (arg === '--sign') a.sign = true;
    else if (arg.startsWith('--format=')) a.format = arg.slice(9);
    else if (arg.startsWith('--output=')) a.output = arg.slice(9);
    else if (arg.startsWith('--operator=')) {
      const v = arg.slice(11);
      // Lower-case slug → operatorId; anything else → legacy free-text label.
      if (/^[a-z0-9_-]+$/.test(v)) {
        a.operatorId = v;
        a.operator = v;
      } else {
        a.operator = v;
      }
    }
    else if (arg.startsWith('--bundle-version=')) a.bundleVersion = arg.slice(17);
  }
  if (!['tar.gz', 'tar', 'zip'].includes(a.format)) {
    throw new Error(`unsupported format: ${a.format} (expected tar.gz | tar | zip)`);
  }
  return a;
}

function todayStamp() {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `v${y}${m}${day}`;
}

// ─── tar / zip builders (parity with scripts/cert-dossier-build.mjs) ─────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function buildTar(files) {
  // Sort by path → deterministic byte layout.
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const blocks = [];
  for (const f of sorted) {
    if (f.path.length > 100) {
      throw new Error(`tar entry path > 100 chars not supported: ${f.path}`);
    }
    const header = Buffer.alloc(512);
    header.write(f.path, 0, 'utf8');
    header.write('0000644 ', 100, 'ascii');
    header.write('0000000 ', 108, 'ascii');
    header.write('0000000 ', 116, 'ascii');
    const sizeOctal = f.data.length.toString(8).padStart(11, '0') + ' ';
    header.write(sizeOctal, 124, 'ascii');
    header.write('00000000000 ', 136, 'ascii');
    header.write('        ', 148, 'ascii'); // checksum placeholder
    header.write('0', 156, 'ascii');
    header.write('ustar  ', 257, 'ascii');
    let chk = 0;
    for (let i = 0; i < 512; i++) chk += header[i];
    header.write(chk.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    blocks.push(header);
    const data = Buffer.from(f.data);
    blocks.push(data);
    const pad = (512 - (data.length % 512)) % 512;
    if (pad > 0) blocks.push(Buffer.alloc(pad));
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

export function buildZip(files) {
  const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path));
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const f of sorted) {
    const nameBytes = Buffer.from(f.path, 'utf8');
    const dataBytes = Buffer.from(f.data);
    const crc = crc32(dataBytes);
    const size = dataBytes.length;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(size, 18);
    local.writeUInt32LE(size, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, nameBytes, dataBytes);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0x21, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(size, 20);
    central.writeUInt32LE(size, 24);
    central.writeUInt16LE(nameBytes.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, nameBytes);
    offset += local.length + nameBytes.length + dataBytes.length;
  }
  const central = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(sorted.length, 8);
  eocd.writeUInt16LE(sorted.length, 10);
  eocd.writeUInt32LE(central.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, eocd]);
}

// ─── Embedded verifier — recipients run this from inside the bundle ──────

export const EMBEDDED_VERIFIER_MJS = `#!/usr/bin/env node
// Companion verifier — runs from inside a pitch tarball. Pure Node 18+ stdlib.
import { promises as fs } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
async function* walk(dir) {
  for (const e of await fs.readdir(dir, { withFileTypes: true })) {
    const p = resolve(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (e.isFile()) yield p;
  }
}
async function main() {
  const manifestPath = resolve(HERE, 'MANIFEST.json');
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  const want = new Map();
  for (const f of manifest.files) want.set(f.path, f);
  const seen = new Set();
  let bad = 0, missing = 0, extra = 0;
  for await (const abs of walk(HERE)) {
    const rel = relative(HERE, abs).split(/\\\\|\\//).join('/');
    if (rel === 'MANIFEST.json' || rel === 'verify.mjs') continue;
    const expect = want.get(rel);
    if (!expect) { console.warn('extra:', rel); extra++; continue; }
    seen.add(rel);
    const data = await fs.readFile(abs);
    const got = createHash('sha256').update(data).digest('hex');
    if (got !== expect.sha256) { console.error('tampered:', rel); bad++; }
  }
  for (const k of want.keys()) if (!seen.has(k)) { console.error('missing:', k); missing++; }
  if (bad === 0 && missing === 0) { console.log('OK', manifest.files.length, 'files verified'); process.exit(0); }
  console.error(\`FAIL bad=\${bad} missing=\${missing} extra=\${extra}\`);
  process.exit(1);
}
main().catch((e) => { console.error(e); process.exit(2); });
`;

// ─── Optional Ed25519 signing (re-uses W209/W210 HSM key file) ───────────

async function hsmSignString(stringToSign, root) {
  try {
    const ed = await import('@noble/ed25519');
    const { sha512 } = await import('@noble/hashes/sha2.js');
    ed.hashes.sha512 = (msg) => sha512(msg);
    const keyFile = resolve(root, 'server/data/hsm-keys.json');
    if (!existsSync(keyFile)) {
      return { signed: false, reason: 'no-hsm-key-file' };
    }
    const kp = JSON.parse(await fs.readFile(keyFile, 'utf8'));
    const priv = hexToBytes(kp.privateKeyHex);
    const msg = new TextEncoder().encode(stringToSign);
    const sig = ed.sign(msg, priv);
    return {
      signed: true,
      publicKey: kp.publicKeyHex,
      signature: bytesToHex(sig),
      signedAt: new Date().toISOString(),
      signer: kp.signer ?? 'slot-math-engine-hsm',
    };
  } catch (err) {
    return { signed: false, reason: `signer-error:${err.message}` };
  }
}

function bytesToHex(b) {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function hexToBytes(h) {
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.slice(i * 2, i * 2 + 2), 16);
  return out;
}

// ─── Source-file collectors ──────────────────────────────────────────────

async function readIfExists(absPath) {
  if (!existsSync(absPath)) return null;
  return fs.readFile(absPath);
}

async function readJsonIfExists(absPath) {
  if (!existsSync(absPath)) return null;
  try {
    return JSON.parse(await fs.readFile(absPath, 'utf8'));
  } catch {
    return null;
  }
}

const REFERENCE_DOCS = [
  'docs/PILOT_GUIDE.md',
  'docs/PILOT_ARCHITECTURE.md',
  'docs/DEPLOYMENT.md',
  'docs/MULTI_TENANT.md',
  'docs/WALLET_PROVIDERS.md',
  'docs/MARKETPLACE_API.md',
  'docs/CERT_LAB_SUBMISSION.md',
];

const PROOF_FILES = [
  { source: 'dist/pilot/integration-suite-latest.json', name: 'integration-suite-latest.json' },
  { source: 'reports/smoke/summary.json', name: 'smoke-test-latest.json' },
  { source: 'reports/dossier/CLOSED_FORM_PORTFOLIO.json', name: 'closed-form-portfolio.json' },
  { source: 'dist/demo-theater/narrative-synthetic.md', name: 'demo-theater-narrative-cto.md' },
  { source: 'dist/demo-theater/timeline-synthetic.json', name: 'demo-theater-timeline.json' },
];

const STORYBOARD_FILES = [
  { source: 'web/pitch/src/storyboards/storyboard-30sec-elevator.ts', name: 'storyboard-30sec-elevator.md' },
  { source: 'web/pitch/src/storyboards/storyboard-5min-deep.ts', name: 'storyboard-5min-deep.md' },
  { source: 'web/pitch/src/storyboards/storyboard-90min-board.ts', name: 'storyboard-90min-board.md' },
];

const CERT_LABS = ['BMM', 'GLI', 'eCOGRA', 'NMi'];

export async function collectSalesEntries({ root }) {
  const entries = [];
  // 1. Executive deck — self-contained HTML, sanitised.
  const deckPath = resolve(root, 'web/pitch/lw-deck.html');
  if (existsSync(deckPath)) {
    const deckHtml = await composeDeckFile({ deckPath, title: 'Slot Math Engine — Vendor B Acceleration Pilot — Executive Deck' });
    entries.push({ bundlePath: 'pitch-package/sales/01-executive-deck.html', data: Buffer.from(deckHtml, 'utf8') });
  }
  // 2. ROI calculator — wrap the TS source into a readable reference HTML.
  const roiPath = resolve(root, 'web/pitch/src/roi-calculator.ts');
  if (existsSync(roiPath)) {
    const roiTs = await fs.readFile(roiPath, 'utf8');
    const body = `<h1>ROI Calculator — model + reference inputs</h1>
<p>The TypeScript module below contains the canonical ROI model used by the L&amp;W deck.
Pricing/spin-volume defaults are tuned for a Tier-1 omni-channel operator.
The interactive version ships inside <code>01-executive-deck.html</code> (slide 6).</p>
<pre><code>${roiTs.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))}</code></pre>`;
    const html = wrapHtmlDocument({ title: 'ROI Calculator — Reference Source', bodyHtml: body });
    entries.push({ bundlePath: 'pitch-package/sales/02-roi-calculator.html', data: Buffer.from(html, 'utf8') });
  }
  // 3-6. Markdown docs → standalone HTML.
  const mdToHtml = [
    { source: 'docs/LW_TECHNICAL_DEEP_DIVE.md', name: '03-technical-deep-dive.html', title: 'Vendor B Technical Deep Dive' },
    { source: 'docs/LW_VS_COMPETITORS.md', name: '04-competitive-matrix.html', title: 'Vendor B vs Competitors' },
    { source: 'docs/LW_PILOT_PITCH_GUIDE.md', name: '05-pitch-guide.html', title: 'Vendor B Pilot Pitch Guide' },
    { source: 'dist/pilot/L_AND_W_PILOT_DOSSIER.md', name: '06-pilot-dossier.html', title: 'Vendor B Pilot Evaluation Dossier' },
  ];
  for (const item of mdToHtml) {
    const src = resolve(root, item.source);
    if (existsSync(src)) {
      const html = await composeFromMarkdownFile({ markdownPath: src, title: item.title });
      entries.push({ bundlePath: `pitch-package/sales/${item.name}`, data: Buffer.from(html, 'utf8') });
    }
  }
  // Storyboards — copy TS sources as .md docs (each is mostly prose).
  for (const sb of STORYBOARD_FILES) {
    const src = resolve(root, sb.source);
    const data = await readIfExists(src);
    if (data) entries.push({ bundlePath: `pitch-package/sales/storyboards/${sb.name}`, data });
  }
  return entries;
}

export async function collectProofEntries({ root }) {
  const entries = [];
  for (const pf of PROOF_FILES) {
    const data = await readIfExists(resolve(root, pf.source));
    if (data) entries.push({ bundlePath: `pitch-package/proof/${pf.name}`, data });
  }
  // Industry pattern catalog → emit a JSON shell from the markdown doc.
  const catalogMd = await readIfExists(resolve(root, 'docs/INDUSTRY_PATTERN_CATALOG.md'));
  if (catalogMd) {
    const text = catalogMd.toString('utf8');
    const ids = Array.from(text.matchAll(/\bP-(\d{3})\b/g)).map((m) => `P-${m[1]}`);
    const unique = Array.from(new Set(ids)).sort();
    const data = Buffer.from(
      JSON.stringify({ schema: 'industry-pattern-catalog-v1', totalPatternIds: unique.length, patternIds: unique }, null, 2) + '\n',
      'utf8'
    );
    entries.push({ bundlePath: 'pitch-package/proof/industry-pattern-catalog.json', data });
  }
  // Vendor B M-gap coverage matrix — synthesised from the Kimi research doc.
  const lwCoverage = buildLwCoverageMatrix();
  entries.push({
    bundlePath: 'pitch-package/proof/lw-coverage-matrix.json',
    data: Buffer.from(JSON.stringify(lwCoverage, null, 2) + '\n', 'utf8'),
  });
  // Cert dossier samples — 1 manifest+sig per lab.
  for (const lab of CERT_LABS) {
    const labDir = resolve(root, 'dist/cert/rehearsal', lab);
    if (!existsSync(labDir)) continue;
    const labFiles = await fs.readdir(labDir);
    const manifest = labFiles.find((n) => n.endsWith('.manifest.json'));
    const sig = labFiles.find((n) => n.endsWith('.sig'));
    if (manifest) {
      entries.push({
        bundlePath: `pitch-package/proof/cert-dossier-samples/${lab}-manifest.json`,
        data: await fs.readFile(resolve(labDir, manifest)),
      });
    }
    if (sig) {
      entries.push({
        bundlePath: `pitch-package/proof/cert-dossier-samples/${lab}.sig`,
        data: await fs.readFile(resolve(labDir, sig)),
      });
    }
  }
  return entries;
}

export async function collectReferenceEntries({ root }) {
  const entries = [];
  for (const docPath of REFERENCE_DOCS) {
    const data = await readIfExists(resolve(root, docPath));
    if (data) entries.push({ bundlePath: `pitch-package/reference/${basename(docPath)}`, data });
  }
  return entries;
}

export function buildLwCoverageMatrix() {
  // Engine M1..M16 → wave + P-ID + commit hash. Hardcoded from KIMI research
  // (CLAUDE.md says 16/16 closed under W181-W211).
  const rows = [
    { gap: 'M1',  title: 'Hold-and-win tiered jackpot (Pattern-LIL family)', wave: 'W181', pid: 'P-082' },
    { gap: 'M2',  title: 'Cash on Reels / sticky-cash collector',              wave: 'W182', pid: 'P-083' },
    { gap: 'M3',  title: 'Quick Hit symbol-stack jackpot',                    wave: 'W183', pid: 'P-084' },
    { gap: 'M4',  title: 'Pattern-HP multi-pot branched hold-spin',           wave: 'W184', pid: 'P-085' },
    { gap: 'M5',  title: 'Spartacus colossal reels wild transfer',             wave: 'W185', pid: 'P-086' },
    { gap: 'M6',  title: 'Rainbow Riches Megaways variable height ways',       wave: 'W186', pid: 'P-087' },
    { gap: 'M7',  title: 'Bonus bank running balance offset',                  wave: 'W187', pid: 'P-088' },
    { gap: 'M8',  title: 'Cascade meter charge-up trigger',                    wave: 'W188', pid: 'P-089' },
    { gap: 'M9',  title: 'Mystery symbol reveal with chaos pool',              wave: 'W189', pid: 'P-090' },
    { gap: 'M10', title: 'Multi-state frame upgrade Markov',                   wave: 'W190', pid: 'P-091' },
    { gap: 'M11', title: 'Random feature injection during FS',                 wave: 'W189', pid: 'P-092' },
    { gap: 'M12', title: 'Nested mini-slot inside bonus',                      wave: 'W190', pid: 'P-093' },
    { gap: 'M13', title: 'Anticipation reel tease',                            wave: 'W191', pid: 'P-094' },
    { gap: 'M14', title: 'Skill-stop near-miss bonus',                         wave: 'W190', pid: 'P-095' },
    { gap: 'M15', title: 'Multi-level wild Markov',                            wave: 'W195', pid: 'P-096' },
    { gap: 'M16', title: 'Megacluster stack ways aggregator',                  wave: 'W200', pid: 'P-097' },
  ];
  return {
    schema: 'lw-coverage-matrix-v1',
    totalGaps: rows.length,
    closedGaps: rows.length,
    closurePercent: 100,
    rows,
    notes: 'Per docs/research/KIMI_LW_PORTFOLIO_COVERAGE_2026-05-18.md — all 16 M-gaps closed through W181-W211.',
  };
}

// ─── Auto-generated top-level files ──────────────────────────────────────

export function buildAutoGeneratedEntries({ operator, bundleVersion, git, generatedAt, stats, engineVersion }) {
  const entries = [];
  const readme = renderReadme({ operator, bundleVersion, generatedAt, stats });
  entries.push({ bundlePath: 'pitch-package/README.md', data: Buffer.from(readme, 'utf8') });
  entries.push({
    bundlePath: 'pitch-package/INSTALL.md',
    data: Buffer.from(renderInstall({ operator }), 'utf8'),
  });
  entries.push({
    bundlePath: 'pitch-package/CONTACT.md',
    data: Buffer.from(renderContact({ operator }), 'utf8'),
  });
  entries.push({
    bundlePath: 'pitch-package/VERSION.txt',
    data: Buffer.from(renderVersionTxt({
      bundleVersion, gitCommit: git.commit, gitBranch: git.branch, generatedAt, engineVersion,
    }), 'utf8'),
  });
  entries.push({ bundlePath: 'pitch-package/verify.mjs', data: Buffer.from(EMBEDDED_VERIFIER_MJS, 'utf8') });
  return entries;
}

// ─── Engine version reader ───────────────────────────────────────────────

async function readEngineVersion(root) {
  const pkg = await readJsonIfExists(resolve(root, 'package.json'));
  return pkg?.version ?? '0.0.0';
}

// ─── Per-operator rebrand ────────────────────────────────────────────────

const TEXT_LIKE_EXTS = ['.md', '.txt', '.json'];
const HTML_LIKE_EXTS = ['.html', '.htm'];

export function rebrandEntry(entry, manifest) {
  if (!manifest) return entry;
  const path = entry.bundlePath;
  const lower = path.toLowerCase();
  const isHtml = HTML_LIKE_EXTS.some((e) => lower.endsWith(e));
  const isText = TEXT_LIKE_EXTS.some((e) => lower.endsWith(e));
  if (!isHtml && !isText) return entry;
  // Never rebrand MANIFEST / VERSION / sig blobs — they are integrity blobs.
  if (lower.endsWith('manifest.json') || lower.endsWith('.sig')) return entry;
  if (lower.endsWith('version.txt')) return entry;
  // verify.mjs is JS code — leave intact.
  if (lower.endsWith('verify.mjs')) return entry;

  const text = entry.data.toString('utf8');
  const swapped = isHtml ? applyBrandingToHtml(text, manifest) : applyBranding(text, manifest);
  if (swapped === text) return entry;
  return { ...entry, data: Buffer.from(swapped, 'utf8') };
}

// ─── Main pipeline ───────────────────────────────────────────────────────

export async function buildPitchTarball(opts = {}) {
  const root = opts.root ?? REPO_ROOT;
  const format = opts.format ?? 'tar.gz';
  let operator = opts.operator ?? DEFAULT_OPERATOR_NAME;
  const dryRun = opts.dryRun ?? false;
  const sign = opts.sign ?? false;
  const output = resolve(root, opts.output ?? 'dist/pitch');
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const bundleVersion = opts.bundleVersion ?? todayStamp();
  const stats = opts.stats ?? DEFAULT_STATS;

  // ─── Resolve operator manifest if a slug-style id was provided ─────────
  let operatorManifest = null;
  const explicitId =
    opts.operatorId ??
    (typeof operator === 'string' && /^[a-z0-9_-]+$/.test(operator) ? operator : null);
  if (opts.operatorManifest) {
    operatorManifest = opts.operatorManifest;
    operator = operatorManifest.displayName;
  } else if (explicitId) {
    try {
      operatorManifest = await loadOperatorManifest(explicitId);
      operator = operatorManifest.displayName;
    } catch (err) {
      // Unknown slug → fall back to free-text label (keeps W212 callers happy).
      operatorManifest = null;
    }
  }
  const operatorId = operatorManifest?.operatorId ?? null;

  const git = await resolveGitInfo({ root });
  const engineVersion = await readEngineVersion(root);

  // 1. Collect every source entry (sans MANIFEST.json itself).
  let sales = await collectSalesEntries({ root });
  let proof = await collectProofEntries({ root });
  let reference = await collectReferenceEntries({ root });
  const auto = buildAutoGeneratedEntries({
    operator, bundleVersion, git, generatedAt, stats, engineVersion,
  });
  let entries = [...auto, ...sales, ...proof, ...reference];

  // 1b. Rebrand all text/HTML/Markdown payloads against the operator manifest.
  if (operatorManifest && operatorManifest.operatorId !== DEFAULT_OPERATOR_ID) {
    entries = entries.map((e) => rebrandEntry(e, operatorManifest));
  }

  // 2. Hash everything → manifest. (Manifest itself isn't hashed.)
  let manifest = buildManifest({
    entries,
    engineVersion,
    bundleVersion,
    format,
    git,
    timestamp: generatedAt,
    operator: operatorManifest
      ? {
          operatorId: operatorManifest.operatorId,
          displayName: operatorManifest.displayName,
          legalName: operatorManifest.legalName,
          tier: operatorManifest.tier,
          hqLocation: operatorManifest.hqLocation,
          tickerSymbol: operatorManifest.tickerSymbol,
        }
      : null,
    intendedAudience: operatorManifest?.decisionMakerRole ?? null,
    pricingTier: operatorManifest?.pricingTierLabel ?? null,
    expiresAt: opts.expiresAt ?? (operatorManifest ? computeExpiresAt(generatedAt, 90) : null),
  });

  // 3. Optional Ed25519 signature over the canonical manifest JSON.
  if (sign) {
    const unsignedBytes = manifestToJsonBytes(manifest);
    const sigResult = await hsmSignString(sha256Hex(unsignedBytes), root);
    if (sigResult.signed) {
      manifest = { ...manifest, signature: {
        algorithm: 'ed25519',
        publicKey: sigResult.publicKey,
        signature: sigResult.signature,
        signedAt: sigResult.signedAt,
        signer: sigResult.signer,
        message: 'sha256(MANIFEST.json bytes without signature field)',
      } };
    }
  }
  const manifestBytes = manifestToJsonBytes(manifest);
  const allEntries = [
    ...entries,
    { bundlePath: 'pitch-package/MANIFEST.json', data: manifestBytes },
  ];

  // 4. Build archive bytes per requested format.
  const tarFiles = allEntries.map((e) => ({ path: e.bundlePath, data: e.data }));
  let archiveBytes;
  let archiveExt;
  if (format === 'tar.gz') {
    archiveBytes = gzipSync(buildTar(tarFiles), { level: 9 });
    archiveExt = 'tar.gz';
  } else if (format === 'tar') {
    archiveBytes = buildTar(tarFiles);
    archiveExt = 'tar';
  } else if (format === 'zip') {
    archiveBytes = buildZip(tarFiles);
    archiveExt = 'zip';
  } else {
    throw new Error(`unsupported format: ${format}`);
  }
  const filename = deriveBundleFilename({
    bundleVersion,
    commitShort: git.commitShort,
    format: archiveExt,
    operatorId,
  });

  const result = {
    filename,
    outputPath: resolve(output, filename),
    fileCount: allEntries.length,
    archiveSize: archiveBytes.length,
    manifest,
    entries: allEntries,
    format,
    git,
    engineVersion,
    bundleVersion,
    operator,
    operatorId,
    operatorManifest,
  };

  if (!dryRun) {
    await fs.mkdir(output, { recursive: true });
    await fs.writeFile(result.outputPath, archiveBytes);
    // Side-car MANIFEST.json next to the tarball for quick inspection.
    await fs.writeFile(resolve(output, filename + '.manifest.json'), manifestBytes);
  }
  return result;
}

// ─── CLI ────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv);
  const t0 = Date.now();
  buildPitchTarball({
    output: args.output,
    format: args.format,
    operator: args.operator,
    operatorId: args.operatorId ?? undefined,
    bundleVersion: args.bundleVersion ?? undefined,
    dryRun: args.dryRun,
    sign: args.sign,
  }).then((r) => {
    const elapsed = ((Date.now() - t0) / 1000).toFixed(2);
    console.log(`[pitch:tarball] ${args.dryRun ? 'DRY-RUN' : 'wrote'} ${r.outputPath}`);
    console.log(`[pitch:tarball] files=${r.fileCount} size=${(r.archiveSize / 1024).toFixed(1)}KB elapsed=${elapsed}s`);
    console.log(`[pitch:tarball] operator=${r.operator}${r.operatorId ? ` (id=${r.operatorId})` : ''}`);
    console.log(`[pitch:tarball] git=${r.git.commitShort} branch=${r.git.branch} engine=${r.engineVersion} bundle=${r.bundleVersion}`);
  }).catch((err) => {
    console.error('[pitch:tarball] FAILED', err);
    process.exit(1);
  });
}
