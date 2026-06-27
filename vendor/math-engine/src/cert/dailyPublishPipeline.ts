/**
 * W152 Wave 24 — Daily-Publish Pipeline Scaffold (Faza 13.11).
 *
 * Operator-side template za publishing day's certification dossier
 * (cert-daily.mjs output) na public-audit endpoint. Faza 13.11 traži:
 *   * Engine commit-uje hash-chained daily report (već landed Wave 15
 *     u `scripts/cert-daily.mjs`).
 *   * **Operator's job:** publish that report na auditor-accessible
 *     URL (S3 / IPFS / regulator inbox / public dashboard).
 *
 * Ovaj modul je generic publish-pipeline orkestrator:
 *   1. Discovers latest dossier u `reports/acceptance/cert-daily/`.
 *   2. Validates SHA-256 hash chain integrity vs CHAIN.json.
 *   3. Calls operator-supplied `publish(dossierJson, key)` callback.
 *   4. Records publish status u `reports/acceptance/cert-daily/PUBLISH_LOG.json`.
 *
 * Naming: `dailyPublishPipeline` engine-generic. NIJE vendor term.
 *
 * Pure module — caller wires real S3/IPFS/HTTP via callback. Engine
 * stays portable.
 */

import { sha256 } from '@noble/hashes/sha256';

export interface CertDossierMetadata {
  date: string;
  sha256: string;
  prevSha256: string | null;
}

export interface ChainLedger {
  chain: CertDossierMetadata[];
}

export interface PublishOptions {
  /** Caller-provided publish function. Returns promise that rejects
   *  on transport failure. */
  publish: (dossierJson: string, key: string) => Promise<{ url: string }>;
  /** Key prefix joiner. Default `cert-daily/`. */
  keyPrefix?: string;
  /** Throw on hash-chain integrity failure (vs warn). Default true. */
  strictIntegrityCheck?: boolean;
}

export interface PublishVerdict {
  date: string;
  publishedUrl: string | null;
  integrityOk: boolean;
  publishedAtUtc: string;
  error?: string;
}

/** Compute SHA-256 hex of a string. */
export function sha256Hex(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const digest = sha256(bytes);
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify a chain ledger — every entry's prevSha256 must match the
 *  prior entry's sha256. Returns true iff intact. */
export function verifyChainIntegrity(ledger: ChainLedger): {
  ok: boolean;
  brokenAt: number | null;
  reason: string;
} {
  for (let i = 0; i < ledger.chain.length; i++) {
    const entry = ledger.chain[i];
    const expectedPrev = i === 0 ? null : ledger.chain[i - 1].sha256;
    if (entry.prevSha256 !== expectedPrev) {
      return {
        ok: false,
        brokenAt: i,
        reason: `chain[${i}].prevSha256 = ${entry.prevSha256 ?? 'null'} but expected ${expectedPrev ?? 'null'}`,
      };
    }
  }
  return { ok: true, brokenAt: null, reason: '' };
}

/**
 * Publish a single dossier via caller-supplied callback. Records
 * verdict for audit trail.
 */
export async function publishDossier(
  dossierJson: string,
  date: string,
  ledger: ChainLedger,
  opts: PublishOptions,
): Promise<PublishVerdict> {
  const keyPrefix = opts.keyPrefix ?? 'cert-daily/';
  const key = `${keyPrefix}${date}.json`;
  const strictIntegrity = opts.strictIntegrityCheck ?? true;

  const integrity = verifyChainIntegrity(ledger);
  if (!integrity.ok && strictIntegrity) {
    return {
      date,
      publishedUrl: null,
      integrityOk: false,
      publishedAtUtc: new Date().toISOString(),
      error: `Hash chain integrity failed: ${integrity.reason}`,
    };
  }

  // Verify dossier hash matches ledger entry for this date
  const dossierHash = sha256Hex(dossierJson);
  const ledgerEntry = ledger.chain.find((e) => e.date === date);
  if (ledgerEntry !== undefined && ledgerEntry.sha256 !== dossierHash) {
    return {
      date,
      publishedUrl: null,
      integrityOk: false,
      publishedAtUtc: new Date().toISOString(),
      error: `Dossier hash ${dossierHash} ≠ ledger ${ledgerEntry.sha256}`,
    };
  }

  try {
    const result = await opts.publish(dossierJson, key);
    return {
      date,
      publishedUrl: result.url,
      integrityOk: integrity.ok,
      publishedAtUtc: new Date().toISOString(),
    };
  } catch (e) {
    return {
      date,
      publishedUrl: null,
      integrityOk: integrity.ok,
      publishedAtUtc: new Date().toISOString(),
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Batch-publish all unpublished dossiers from a chain ledger.
 *
 * `lastPublishedDate` is the operator's bookmark — only entries
 * dated > lastPublishedDate are picked up.
 *
 * Returns per-dossier verdicts in chain order.
 */
export async function publishUnpublishedSince(
  dossierLoader: (date: string) => Promise<string>,
  ledger: ChainLedger,
  lastPublishedDate: string | null,
  opts: PublishOptions,
): Promise<PublishVerdict[]> {
  const unpublished = ledger.chain.filter(
    (e) => lastPublishedDate === null || e.date > lastPublishedDate,
  );
  const verdicts: PublishVerdict[] = [];
  for (const entry of unpublished) {
    const dossier = await dossierLoader(entry.date);
    const v = await publishDossier(dossier, entry.date, ledger, opts);
    verdicts.push(v);
    if (v.error !== undefined && opts.strictIntegrityCheck !== false) break; // stop on error
  }
  return verdicts;
}
