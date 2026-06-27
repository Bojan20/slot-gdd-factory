#!/usr/bin/env node
/**
 * CORTI 200.6-DEVOPS — cert lab submission CLI.
 *
 * Reads a game's IR + PAR + operator-package.zip, POSTs to a (mock or
 * real) certification lab endpoint, polls status every 10s up to 5
 * minutes, and saves the signed cert when approved or surfaces lab
 * feedback when rejected.
 *
 * Stub mode (default) keeps everything local so this can run in CI
 * without a real lab. Set CERT_LAB_URL to a real endpoint to switch.
 *
 * Usage:
 *   npm run cert:submit -- --game classic-5x3-20lines --jurisdiction UKGC
 *   node scripts/cert-lab-submit.mjs --game ... --jurisdiction UKGC --stub
 *
 * Exit codes:
 *   0  approved (cert downloaded)
 *   1  rejected (feedback printed)
 *   2  timeout
 *   3  bad inputs / IO error
 */

import { readFileSync, writeFileSync, existsSync, statSync, mkdirSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..');

const POLL_INTERVAL_MS = 10_000;
const TIMEOUT_MS = 5 * 60_000;

/**
 * @typedef {Object} CliArgs
 * @property {string} game
 * @property {string} jurisdiction
 * @property {string} [irPath]
 * @property {string} [parPath]
 * @property {string} [operatorPackagePath]
 * @property {string} labUrl
 * @property {boolean} stub
 * @property {string} out
 * @property {() => number} [now]
 * @property {(ms: number) => Promise<void>} [sleep]
 */

export function parseArgs(argv) {
  const out = {
    game: '',
    jurisdiction: '',
    irPath: undefined,
    parPath: undefined,
    operatorPackagePath: undefined,
    labUrl: process.env.CERT_LAB_URL ?? '',
    stub: process.env.CERT_LAB_URL ? false : true,
    out: resolve(REPO_ROOT, 'out/cert-submissions'),
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    switch (a) {
      case '--game': out.game = next; i++; break;
      case '--jurisdiction': out.jurisdiction = next; i++; break;
      case '--ir': out.irPath = next; i++; break;
      case '--par': out.parPath = next; i++; break;
      case '--operator-package': out.operatorPackagePath = next; i++; break;
      case '--lab-url': out.labUrl = next; out.stub = false; i++; break;
      case '--stub': out.stub = true; break;
      case '--out': out.out = next; i++; break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
        break;
    }
  }
  return out;
}

function printHelp() {
  console.log(`cert-lab-submit — submit a game to a certification lab.

  --game <id>           Game id (required).
  --jurisdiction <code> Jurisdiction code (UKGC, MGA, NJ, SE…).
  --ir <path>           Override path to game.ir.json.
  --par <path>          Override PAR sheet path.
  --operator-package <path>  Override operator-package.zip path.
  --lab-url <url>       Real cert lab endpoint (overrides stub).
  --stub                Run in stub mode (no real lab call).
  --out <dir>           Output dir for downloaded cert (default out/cert-submissions/).
`);
}

function sha256Hex(bufOrString) {
  const h = createHash('sha256');
  h.update(bufOrString);
  return h.digest('hex');
}

/** Locate canonical IR path under web/studio/ir-library/<bucket>/<id>.ir.json. */
export function findIrPath(gameId, repoRoot = REPO_ROOT) {
  const candidates = [
    join(repoRoot, 'web/studio/ir-library/classics', `${gameId}.ir.json`),
    join(repoRoot, 'web/studio/ir-library/lw-mgaps', `${gameId}.ir.json`),
  ];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** Build the package envelope that's POSTed to the lab. */
export function buildEnvelope(args) {
  const irPath = args.irPath ?? findIrPath(args.game);
  if (!irPath || !existsSync(irPath)) {
    throw new Error(`ir_not_found: game=${args.game} (looked under web/studio/ir-library/)`);
  }
  const irRaw = readFileSync(irPath, 'utf8');
  let ir;
  try {
    ir = JSON.parse(irRaw);
  } catch (err) {
    throw new Error(`ir_invalid_json: ${err.message}`);
  }
  const irSha = sha256Hex(irRaw);

  const par = args.parPath && existsSync(args.parPath)
    ? readFileSync(args.parPath, 'utf8')
    : null;
  const opPkg = args.operatorPackagePath && existsSync(args.operatorPackagePath)
    ? readFileSync(args.operatorPackagePath)
    : null;

  return {
    envelope: {
      game: args.game,
      jurisdiction: args.jurisdiction,
      irSha256: irSha,
      irBytes: irRaw.length,
      parIncluded: par !== null,
      parSha256: par ? sha256Hex(par) : null,
      operatorPackageIncluded: opPkg !== null,
      operatorPackageSha256: opPkg ? sha256Hex(opPkg) : null,
      operatorPackageBytes: opPkg ? opPkg.length : 0,
      submittedAt: new Date().toISOString(),
    },
    ir,
    irSha,
  };
}

/** Stub lab — pretend to do a real submit/poll/approve flow locally. */
export function stubLab() {
  const submissions = new Map();
  let counter = 0;
  return {
    async submit(envelope) {
      counter++;
      const submissionId = `stub-${envelope.game}-${counter.toString(16).padStart(4, '0')}`;
      submissions.set(submissionId, {
        submissionId,
        status: 'submitted',
        polls: 0,
        envelope,
      });
      return { submissionId, status: 'submitted' };
    },
    async poll(submissionId) {
      const s = submissions.get(submissionId);
      if (!s) return { submissionId, status: 'unknown' };
      // Stub auto-advances after 2 polls → approved.
      s.polls++;
      if (s.polls === 1) s.status = 'validating';
      else if (s.polls === 2) s.status = 'reviewing';
      else if (s.polls >= 3) s.status = 'approved';
      // For test coverage of rejected path, allow ?reject in jurisdiction.
      if (s.envelope.jurisdiction === 'REJECT_TEST' && s.polls >= 2) {
        s.status = 'rejected';
        s.feedback = 'stub_lab_forced_rejection';
      }
      return {
        submissionId,
        status: s.status,
        feedback: s.feedback,
        signedCertSha256: s.status === 'approved'
          ? sha256Hex(`signed:${submissionId}:${s.envelope.irSha256}`)
          : undefined,
      };
    },
    async download(submissionId) {
      const s = submissions.get(submissionId);
      if (!s || s.status !== 'approved') return null;
      const certBody = JSON.stringify({
        submissionId,
        irSha256: s.envelope.irSha256,
        jurisdiction: s.envelope.jurisdiction,
        signedAt: new Date().toISOString(),
        signature: sha256Hex(`signed:${submissionId}:${s.envelope.irSha256}`),
      }, null, 2);
      return Buffer.from(certBody, 'utf8');
    },
  };
}

/** Real lab client over fetch. */
function realLab(baseUrl) {
  return {
    async submit(envelope) {
      const res = await fetch(`${baseUrl}/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(envelope),
      });
      if (!res.ok) throw new Error(`lab_submit_failed: ${res.status}`);
      return res.json();
    },
    async poll(submissionId) {
      const res = await fetch(`${baseUrl}/status/${submissionId}`);
      if (!res.ok) throw new Error(`lab_poll_failed: ${res.status}`);
      return res.json();
    },
    async download(submissionId) {
      const res = await fetch(`${baseUrl}/cert/${submissionId}`);
      if (!res.ok) return null;
      return Buffer.from(await res.arrayBuffer());
    },
  };
}

export function defaultSleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Core orchestration — exposed for testing. */
export async function runSubmit(args, lab) {
  if (!args.game) throw new Error('--game required');
  if (!args.jurisdiction) throw new Error('--jurisdiction required');
  const { envelope, irSha } = buildEnvelope(args);
  const sleep = args.sleep ?? defaultSleep;
  const now = args.now ?? Date.now;
  const submitRes = await lab.submit({ ...envelope, ir: undefined });
  const { submissionId } = submitRes;
  const start = now();
  let last = submitRes;
  while (now() - start < TIMEOUT_MS) {
    await sleep(POLL_INTERVAL_MS);
    last = await lab.poll(submissionId);
    if (last.status === 'approved' || last.status === 'rejected') break;
  }
  if (last.status === 'approved') {
    const certBuf = await lab.download(submissionId);
    if (!certBuf) throw new Error('cert_download_failed');
    mkdirSync(args.out, { recursive: true });
    const outFile = join(args.out, `${args.game}-${args.jurisdiction}-${submissionId}.cert.json`);
    writeFileSync(outFile, certBuf);
    return {
      ok: true,
      status: 'approved',
      submissionId,
      irSha256: irSha,
      certPath: outFile,
      certSha256: sha256Hex(certBuf),
    };
  }
  if (last.status === 'rejected') {
    return {
      ok: false,
      status: 'rejected',
      submissionId,
      irSha256: irSha,
      feedback: last.feedback ?? 'no_feedback',
    };
  }
  return {
    ok: false,
    status: 'timeout',
    submissionId,
    irSha256: irSha,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const lab = args.stub ? stubLab() : realLab(args.labUrl);
  if (!args.stub && !args.labUrl) {
    console.error('error: provide --lab-url or set CERT_LAB_URL (or use --stub)');
    process.exit(3);
  }
  let result;
  try {
    result = await runSubmit(args, lab);
  } catch (err) {
    console.error(`error: ${err.message}`);
    process.exit(3);
  }
  console.log(JSON.stringify(result, null, 2));
  if (result.ok) process.exit(0);
  if (result.status === 'rejected') process.exit(1);
  process.exit(2);
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === resolve(process.argv[1] ?? '');
  } catch {
    return false;
  }
})();
if (isMain) {
  main().catch((err) => {
    console.error('fatal:', err);
    process.exit(3);
  });
}
