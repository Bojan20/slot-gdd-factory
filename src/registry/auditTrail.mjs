/**
 * src/registry/auditTrail.mjs
 *
 * UQ-DEEP-AN · AN-1 · Audit trail formalization (Boki 2026-06-24).
 *
 * Regulator-grade audit log shape derived from the wire-neutral runtime
 * contract (IGT_PLAYA_RUNTIME.md §6 Foundry + IGT_SLOT_GAME_SETTINGS_CONTRACT.md
 * P2.0). Prior to this fix the audit trail was implicit in the
 * /converge response body — auditors had no canonical JSON schema and no
 * dedicated read endpoint. AN-1 closes that gap.
 *
 * ── Public surface ─────────────────────────────────────────────────────
 *   AUDIT_LOG_SCHEMA_VERSION    : '1'
 *   buildAuditEntry(input)      : returns canonical audit shape (no validation)
 *   validateAuditEntry(entry)   : { ok, errors[] } structural validation
 *   hashAuditEntry(entry)       : SHA-256 hex digest of canonical JSON
 *   buildAuditChain(entries)    : { merkleRoot, entries[], signature: null }
 *
 * Vendor-neutral implementation. No symbol or operator-name references in
 * output — only the regulator-mandated math contract.
 */
import { createHash } from 'node:crypto';

export const AUDIT_LOG_SCHEMA_VERSION = '1';

/* Whitelisted enum values per regulator-grade runtime contract. */
const VALID_STAGES = new Set([
  'BaseGame',
  'FreeSpin',
  'LockAndRespin',
  'JACKPOT',
  'PICK_BONUS',
  'END_GAME',
]);

const VALID_GAME_STATUS = new Set(['settled', 'pending']);

const HEX_64_RX = /^[0-9a-f]{64}$/;
const ISO_8601_RX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const SHA256_PREFIXED_RX = /^sha256:[0-9a-f]{64}$/;

/**
 * Build a canonical audit entry from a /spin or /converge outcome.
 *
 * Input shape (all optional except sessionId + spinIdx):
 *   {
 *     sessionId: string,
 *     spinIdx: int,
 *     model: { payback: {...}, ... },             // parsed GDD model
 *     executor: { ... },                          // serverConfig snapshot
 *     outcome: {                                  // /spin or batch outcome
 *       transactionId, payX, measuredRtp,
 *       measuredHitRate, fsTrigger, hnwTrigger
 *     },
 *     rng: { seed: number },
 *     target: { declaredRtp: number|string, hitFrequency: number }
 *   }
 *
 * Returns: regulator-grade audit shape with `schemaVersion: '1'`.
 */
export function buildAuditEntry(input = {}) {
  const {
    sessionId,
    spinIdx,
    model = {},
    executor = null,
    outcome = {},
    rng = {},
    target = {},
  } = input || {};

  const payback = (model && model.payback) || {};
  const declaredRtpRaw =
    target.declaredRtp !== undefined ? target.declaredRtp : payback.rtp;
  /* IGT spec: declaredRtp is REPRESENTATIONAL (string), not float, so the
   * regulator sees the exact spec value "96.00" rather than 0.9600 or 96. */
  const declaredRtp = formatDeclaredRtp(declaredRtpRaw);

  /* paytableHash: if executor snapshot already carries a `sha256:` hash use
   * it verbatim; otherwise derive deterministically from the serverConfig
   * snapshot (or the model if no snapshot). */
  const paytableHash = computePaytableHash(executor || model);

  const measuredRtp = numOr(outcome.measuredRtp, 0);
  const hitFrequencyMeasured = numOr(outcome.measuredHitRate, numOr(target.hitFrequency, 0));

  const gameStatusRaw = outcome.gameStatus || (outcome.pending ? 'pending' : 'settled');

  const entry = {
    schemaVersion: AUDIT_LOG_SCHEMA_VERSION,
    auditLog: {
      paytableHash,
      serverConfig: executor || {},
      sessionId: String(sessionId || ''),
      spinIdx: toInt(spinIdx),
      timestamp: new Date().toISOString(),
      stage: outcome.stage || 'BaseGame',
      gameStatus: gameStatusRaw,
      rngSeed: numOr(rng.seed, 0),
      outcomeDetail: {
        transactionId: outcome.transactionId || `txn-${sessionId}-${toInt(spinIdx)}`,
        payX: numOr(outcome.payX, 0),
        fsTrigger: !!outcome.fsTrigger,
        hnwTrigger: !!outcome.hnwTrigger,
      },
      declaredRtp,
      measuredRtp,
      convergencePass: outcome.convergencePass === true,
      hitFrequency: hitFrequencyMeasured,
    },
  };

  return entry;
}

/**
 * Validate an audit entry against the regulator-grade contract.
 * Returns { ok: boolean, errors: string[] }.
 *
 * Rules (per AN-1 spec):
 *  - paytableHash must be 64-hex-char lowercase (with or without `sha256:` prefix)
 *  - sessionId must be non-empty string
 *  - spinIdx must be integer ≥ 0
 *  - timestamp must be ISO 8601 (regex anchor)
 *  - stage must be one of 6 whitelisted values
 *  - gameStatus must be 'settled' or 'pending'
 *  - rngSeed must be a finite number
 *  - outcomeDetail must be object containing transactionId
 *  - declaredRtp must be string
 *  - measuredRtp must be float in [0, 2]
 *  - hitFrequency must be float in [0, 1]
 */
export function validateAuditEntry(entry) {
  const errors = [];
  if (!entry || typeof entry !== 'object') {
    return { ok: false, errors: ['entry must be object'] };
  }
  const log = entry.auditLog || entry;

  /* paytableHash */
  const ph = log.paytableHash;
  if (typeof ph !== 'string' || ph.length === 0) {
    errors.push('paytableHash must be non-empty string');
  } else {
    const bare = ph.startsWith('sha256:') ? ph.slice(7) : ph;
    if (!HEX_64_RX.test(bare)) {
      errors.push('paytableHash must be 64-hex-char lowercase');
    }
  }

  /* sessionId */
  if (typeof log.sessionId !== 'string' || log.sessionId.length === 0) {
    errors.push('sessionId must be non-empty string');
  }

  /* spinIdx */
  if (typeof log.spinIdx !== 'number' || !Number.isInteger(log.spinIdx) || log.spinIdx < 0) {
    errors.push('spinIdx must be integer >= 0');
  }

  /* timestamp */
  if (typeof log.timestamp !== 'string' || !ISO_8601_RX.test(log.timestamp)) {
    errors.push('timestamp must be ISO 8601');
  }

  /* stage */
  if (!VALID_STAGES.has(log.stage)) {
    errors.push(`stage must be one of: ${[...VALID_STAGES].join(', ')}`);
  }

  /* gameStatus */
  if (!VALID_GAME_STATUS.has(log.gameStatus)) {
    errors.push(`gameStatus must be one of: ${[...VALID_GAME_STATUS].join(', ')}`);
  }

  /* rngSeed */
  if (typeof log.rngSeed !== 'number' || !Number.isFinite(log.rngSeed)) {
    errors.push('rngSeed must be finite number');
  }

  /* outcomeDetail */
  if (!log.outcomeDetail || typeof log.outcomeDetail !== 'object') {
    errors.push('outcomeDetail must be object');
  } else if (typeof log.outcomeDetail.transactionId !== 'string' || log.outcomeDetail.transactionId.length === 0) {
    errors.push('outcomeDetail.transactionId must be non-empty string');
  }

  /* declaredRtp */
  if (typeof log.declaredRtp !== 'string') {
    errors.push('declaredRtp must be string (representational, per IGT spec)');
  }

  /* measuredRtp */
  if (typeof log.measuredRtp !== 'number' || !Number.isFinite(log.measuredRtp)
      || log.measuredRtp < 0 || log.measuredRtp > 2) {
    errors.push('measuredRtp must be float in [0, 2]');
  }

  /* hitFrequency */
  if (typeof log.hitFrequency !== 'number' || !Number.isFinite(log.hitFrequency)
      || log.hitFrequency < 0 || log.hitFrequency > 1) {
    errors.push('hitFrequency must be float in [0, 1]');
  }

  return { ok: errors.length === 0, errors };
}

/**
 * Hash an audit entry with SHA-256 over canonical (key-sorted) JSON.
 * Returns 64-hex digest. Deterministic: same input → same hash,
 * order-independent at every nesting level.
 */
export function hashAuditEntry(entry) {
  const canonical = canonicalJsonStringify(entry);
  return createHash('sha256').update(canonical).digest('hex');
}

/**
 * Build a Merkle-style chain summary over N audit entries.
 *
 * Returns:
 *   { merkleRoot: string, entries: [...], signature: null }
 *
 * merkleRoot derivation (binary Merkle tree, last-duplicated padding):
 *   1. Each entry → leaf hash via hashAuditEntry
 *   2. Pair adjacent leaves → hash(hash_left + hash_right)
 *   3. Odd-out leaf is duplicated (standard Bitcoin-style padding)
 *   4. Repeat until 1 root remains
 *   5. Empty input → '' (no chain to commit)
 *
 * The optional `signature` field is `null` here — operator may sign the
 * merkleRoot externally (e.g. with KMS) and stamp the signed value back
 * onto the chain payload.
 */
export function buildAuditChain(entries) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) {
    return { merkleRoot: '', entries: [], signature: null };
  }
  let layer = list.map((e) => hashAuditEntry(e));
  while (layer.length > 1) {
    const next = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = (i + 1 < layer.length) ? layer[i + 1] : left;  /* duplicate odd-out */
      next.push(createHash('sha256').update(left + right).digest('hex'));
    }
    layer = next;
  }
  return {
    merkleRoot: layer[0],
    entries: list,
    signature: null,
  };
}

/* ── Internal helpers ────────────────────────────────────────────────── */

function numOr(v, fallback) {
  return (typeof v === 'number' && Number.isFinite(v)) ? v : fallback;
}

function toInt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

/* Format declaredRtp per IGT spec — REPRESENTATIONAL string (e.g. "96.00"). */
function formatDeclaredRtp(v) {
  if (typeof v === 'string') return v;
  if (typeof v !== 'number' || !Number.isFinite(v)) return '0.00';
  /* Accept either 0..1 fraction or 0..100 percent. */
  const pct = v > 1 ? v : v * 100;
  return pct.toFixed(2);
}

/* paytableHash derivation: prefer pre-stamped string, otherwise hash the
 * serverConfig snapshot deterministically. Output is always lowercase 64-hex
 * (no `sha256:` prefix — validator accepts both forms). */
function computePaytableHash(source) {
  if (source && typeof source === 'object' && typeof source.paytableHash === 'string') {
    const h = source.paytableHash;
    /* Strip prefix for storage normalization. */
    return h.startsWith('sha256:') ? h.slice(7) : h;
  }
  const canonical = canonicalJsonStringify(source || {});
  return createHash('sha256').update(canonical).digest('hex');
}

/* Canonical JSON: deterministic key ordering at every nesting level so
 * hashAuditEntry is order-independent (semantically identical inputs →
 * identical bytes → identical hash). */
function canonicalJsonStringify(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalJsonStringify).join(',') + ']';
  }
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort();
    const parts = keys.map((k) => JSON.stringify(k) + ':' + canonicalJsonStringify(value[k]));
    return '{' + parts.join(',') + '}';
  }
  return 'null';
}
