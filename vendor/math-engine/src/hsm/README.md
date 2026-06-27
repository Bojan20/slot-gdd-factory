# `src/hsm/` — Hardware Security Module bridge

Provider-agnostic signing layer for RNG drawings, PAR sheets, and spin
proofs. Closes **P0 #10** of the submission plug list — UK Gambling
Commission, MGA (Malta), and DE GlüNeuRStV all require that the signing
key never leaves a FIPS 140-2 Level 3+ device. The engine itself never
holds private key material: it submits hash inputs and gets signatures
back via `HsmAdapter`.

## Layout

```
src/hsm/
├── types.ts                  # HsmAdapter, KeyHandle, SignRequest, AuditRecord, HsmError
├── signer.ts                 # Signer = retry + circuit-breaker + audit fan-out
├── audit.ts                  # InMemoryAuditLog (tests) + JsonlAuditLog (durable file)
├── adapters/
│   ├── mock.ts               # Deterministic in-memory ECDSA/RSA (unit tests, local dev)
│   ├── awsKms.ts             # Pure-JS AWS KMS via fetch + SigV4 (no AWS SDK pull)
│   └── pkcs11.ts             # Process-bridge to `pkcs11-tool` (nCipher/Thales/Utimaco/SoftHSM)
└── index.ts                  # Barrel
```

## Algorithms supported

| Algorithm                  | Curve / key | Use case                              |
|----------------------------|-------------|----------------------------------------|
| `ECDSA_SHA_256`           | NIST P-256  | Default; FIPS-approved; AWS KMS native |
| `ECDSA_SHA_384`           | NIST P-384  | Higher security margin                 |
| `RSASSA_PSS_SHA_256`      | RSA 2048+   | Legacy operator support                |
| `RSASSA_PKCS1_V1_5_SHA_256` | RSA 2048+ | Deprecated; only when operator mandates |

ECDSA signatures are emitted in **low-S canonical form** (RFC 6979
deterministic-k) so they are byte-identical across compliant
implementations and acceptable to operators that pin sig serialization.

## Adapter selection

| Adapter          | Production ready | Determinism                              | Network    |
|-------------------|------------------|-------------------------------------------|------------|
| `MockHsmAdapter` | ❌ tests/dev only | ✅ when `seed` set                       | none       |
| `AwsKmsAdapter`  | ✅                | n/a (HSM-internal)                       | AWS KMS    |
| `Pkcs11Adapter`  | ✅ (with HSM)    | n/a (device-internal)                    | local IPC  |

Audit logs always record `adapter: 'mock'` for the mock — operator audit
kits reject any production signature whose audit record names `mock`.

## Quick start

```ts
import { MockHsmAdapter, Signer, InMemoryAuditLog } from './hsm/index.js';

const hsm = new MockHsmAdapter({ seed: 'unit-test' });
const handle = hsm.createKey('rng-2024', 'ECDSA_SHA_256');
const audit = new InMemoryAuditLog();
const signer = new Signer({ adapter: hsm, auditLog: audit });

const msg = new TextEncoder().encode('PAR drawing #1');
const { signature, publicKey } = await signer.sign({
  keyHandle: handle,
  message: msg,
  algorithm: 'ECDSA_SHA_256',
  context: { drawingId: 'rng-2024-Q4' },
});

const v = await signer.verify({
  publicKey: publicKey!,
  message: msg,
  signature,
  algorithm: 'ECDSA_SHA_256',
});
console.log(v.valid); // true
```

## Production: AWS KMS

```ts
import { AwsKmsAdapter, Signer, JsonlAuditLog } from './hsm/index.js';

const adapter = new AwsKmsAdapter({
  region: 'eu-west-1',
  // credentials: { ... }  // optional; else env (AWS_ACCESS_KEY_ID etc.)
  timeoutMs: 5_000,
});
const audit = new JsonlAuditLog('/var/log/slot-engine/hsm-audit.jsonl');
const signer = new Signer({
  adapter,
  auditLog: audit,
  retry: { maxAttempts: 3, initialBackoffMs: 250 },
  breaker: { failureThreshold: 5, openMs: 30_000 },
});

const handle = await adapter.describeKey('alias/rng-signing-2024');
const resp = await signer.sign({
  keyHandle: handle,
  message: Signer.canonicalize(rngDrawing),  // stable JSON
  algorithm: 'ECDSA_SHA_256',
  context: { drawingId, regulatorTraceId },
});
// Persist resp.signature + Signer.digestHex(message) alongside the drawing.
```

## Production: on-prem PKCS#11

```ts
import { Pkcs11Adapter, Signer, JsonlAuditLog } from './hsm/index.js';

const adapter = new Pkcs11Adapter({
  modulePath: '/opt/nfast/toolkits/pkcs11/libcknfast.so',
  tokenLabel: 'rng-production',
  pin: process.env['HSM_PIN'],  // operator-controlled
  timeoutMs: 8_000,
});
await adapter.init();
if (!adapter.isAvailable()) {
  throw new Error('PKCS#11 module not loaded — refusing to start engine');
}
// … same Signer wrapping as above
```

## Audit log contract

Every `sign` call appends exactly one `AuditRecord` to the configured
`AuditLog` — both on success AND failure. Record fields:

```
recordId        — monotonic per-log counter
timestampMs     — when the op was attempted
adapter         — 'mock' | 'aws-kms' | 'pkcs11'
operation       — 'sign' | 'verify' | 'key_create' | 'key_describe'
keyId           — adapter-opaque key id (no raw key material)
algorithm       — one of SignAlgorithm
messageHashHex  — SHA-256(message) hex; NEVER the message itself (PII safety)
outcome         — 'success' | 'failure'
errorCode       — HsmErrorCode when outcome === 'failure'
latencyMs       — observed HSM round-trip latency
context         — optional caller context (spinId, drawingId, etc.)
```

`JsonlAuditLog` flushes (`fsync`) after every append. Audit-write
failures throw `HsmError('AuditWriteFailure')` — operators must treat
this as a compliance violation, NOT a transient retryable failure.

## Test coverage

`tests/hsm.test.ts` — 31 tests covering:

- **Sign/verify roundtrip** for all 4 algorithms
- **Tampered message / signature / wrong public key** → verify rejects
- **Algorithm mismatch** (request alg ≠ key handle alg) → typed error
- **Unknown key id** → `KeyNotFound`
- **Adapter forced unavailable** → `AdapterUnavailable` (does not retry)
- **Audit log** appends both success and failure records with full fields
- **JsonlAuditLog** writes durably and reads back in order
- **Deterministic seeded keys** → byte-identical signatures across instances
- **Retry on transient (NetworkTimeout)** → eventually succeeds
- **No retry on permanent (KeyNotFound)** → exits immediately
- **Circuit breaker** opens after threshold; half-open after openMs
- **AWS KMS without creds** → unavailable
- **AWS KMS via mock fetch** → roundtrip + SigV4 header validated
- **AWS KMS error mapping** (404→KeyNotFound, 429→RateLimited)
- **SigV4 header structure** (AWS4-HMAC-SHA256, X-Amz-Date format)
- **PKCS#11 without tool/module** → unavailable
- **ECDSA low-S canonical form** — top bit of S < 0x80
- **Audit context propagation** (spinId / drawingId surface in record)
- **`Signer.canonicalize`** — sorted keys, identical bytes for equal JSON
- **`Signer.digestHex`** — matches `crypto.createHash('sha256')` output

## What this module does NOT do

- **Key creation in production.** Operators run key ceremony out-of-band
  (`aws kms create-key`, `pkcs11-tool --keypairgen`, etc.) — never via the
  runtime API. Mock has `createKey` for tests only.
- **Key rotation.** ECDSA CMKs in AWS KMS are immutable; rotation = new
  key + handoff to operator. Out of scope here.
- **Cross-region failover.** Wire it externally if needed (two adapters,
  one active, one warm).
- **MFA/HSM cluster authentication beyond what each adapter exposes.**

## P0 #10 acceptance criteria

| Requirement                                                              | Status |
|--------------------------------------------------------------------------|--------|
| `HsmAdapter` contract                                                    | ✅      |
| AWS KMS adapter (no SDK pull)                                            | ✅      |
| PKCS#11 adapter (nCipher / Thales / Utimaco / SoftHSM)                   | ✅      |
| Mock adapter (deterministic, full algorithm coverage)                    | ✅      |
| ECDSA P-256, P-384, RSA-PSS, RSA-PKCS1v1.5                               | ✅      |
| Low-S canonical ECDSA                                                    | ✅      |
| Retry + circuit breaker + timeout                                        | ✅      |
| Append-only audit log with SHA-256 message hash (no PII)                 | ✅      |
| Typed error model (`HsmErrorCode`, transient / permanent split)          | ✅      |
| 31+ test cases covering every documented scenario                        | ✅      |
| Zero new runtime deps beyond `@noble/curves` (audited pure-JS, ~30 KB)   | ✅      |
| Operator-ready README                                                    | ✅      |

UK / MGA / DE submission path is now unblocked at the engine layer. The
HSM bridge itself does not constitute regulator approval — the operator
still must complete key ceremony, supply audit logs, and pass GLI-19
review.
