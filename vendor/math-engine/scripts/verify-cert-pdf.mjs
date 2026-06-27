#!/usr/bin/env node
/**
 * CORTI W204-PROTOCOLS — verify a generated PAR PDF + its ed25519 signature.
 *
 *  Usage: npm run cert:verify -- <submissionId> [--api http://localhost:4000]
 *
 *  Steps:
 *    1. GET /api/cert/<id>/par.pdf and load the PDF metadata via pdf-lib.
 *    2. GET /api/cert/<id> for the signature + parSha256.
 *    3. GET /api/cert/<id>/verify-signature for the server-side verdict.
 *    4. Print a JSON summary { valid, signedAt, signer, gameId, par }.
 *
 *  Exit 0 iff signature is valid AND the PDF parses cleanly.
 */

import { PDFDocument } from 'pdf-lib';

const args = process.argv.slice(2);
let submissionId = null;
let apiBase = 'http://localhost:4000';
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--api' && i + 1 < args.length) { apiBase = args[++i]; continue; }
  if (a.startsWith('--api=')) { apiBase = a.slice('--api='.length); continue; }
  if (!submissionId) submissionId = a;
}

if (!submissionId) {
  console.error('verify-cert-pdf: submissionId is required');
  console.error('usage: npm run cert:verify -- <submissionId> [--api http://localhost:4000]');
  process.exit(2);
}

async function main() {
  // 1. status + signature
  const statusRes = await fetch(`${apiBase}/api/cert/${submissionId}`);
  if (!statusRes.ok) {
    console.error(`verify-cert-pdf: status ${statusRes.status} from /api/cert/${submissionId}`);
    process.exit(1);
  }
  const status = await statusRes.json();
  if (!status.hsmSignature || !status.parSheet) {
    console.error('verify-cert-pdf: submission is not signed yet');
    process.exit(1);
  }

  // 2. fetch PDF + parse metadata
  const pdfRes = await fetch(`${apiBase}/api/cert/${submissionId}/par.pdf`);
  if (!pdfRes.ok) {
    console.error(`verify-cert-pdf: status ${pdfRes.status} from /api/cert/${submissionId}/par.pdf`);
    process.exit(1);
  }
  const pdfBuf = Buffer.from(await pdfRes.arrayBuffer());
  let pdfTitle = '', pdfPages = 0, pdfAuthor = '';
  try {
    const pdf = await PDFDocument.load(pdfBuf);
    pdfTitle = pdf.getTitle() ?? '';
    pdfAuthor = pdf.getAuthor() ?? '';
    pdfPages = pdf.getPageCount();
  } catch (err) {
    console.error('verify-cert-pdf: PDF parse failed:', err?.message ?? err);
    process.exit(1);
  }

  // 3. server-side signature verify
  const verRes = await fetch(`${apiBase}/api/cert/${submissionId}/verify-signature`);
  if (!verRes.ok) {
    console.error(`verify-cert-pdf: status ${verRes.status} from verify-signature`);
    process.exit(1);
  }
  const verify = await verRes.json();

  // 4. summarize
  const summary = {
    valid: verify.valid === true,
    submissionId,
    signedAt: verify.signedAt,
    signer: verify.signer,
    publicKey: verify.publicKey,
    gameId: verify.gameId,
    jurisdiction: verify.jurisdiction,
    parSha256: status.parSheet.sha256,
    parPdfSha256: status.parPdfSha256,
    merkleRoot: status.parSheet.merkleRoot,
    pdfBytes: pdfBuf.length,
    pdfPages,
    pdfTitle,
    pdfAuthor,
    par: status.parSheet,
  };
  process.stdout.write(JSON.stringify(summary, null, 2) + '\n');
  process.exit(summary.valid && pdfPages > 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('verify-cert-pdf: unhandled error:', err?.stack ?? err);
  process.exit(1);
});
