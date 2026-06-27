/**
 * P0 #10 — HSM bridge public API.
 *
 * High-level entry points:
 *
 *   - `Signer`              — retry + breaker + audit wrapper around any adapter
 *   - `MockHsmAdapter`      — in-memory ECDSA / RSA, deterministic when seeded
 *   - `AwsKmsAdapter`       — pure-JS AWS KMS over fetch+SigV4
 *   - `Pkcs11Adapter`       — process-bridge to `pkcs11-tool` (OpenSC)
 *   - `JsonlAuditLog`       — file-backed append-only log
 *   - `InMemoryAuditLog`    — test-only audit log
 *
 * Types `KeyHandle`, `SignRequest`, `SignResponse`, `VerifyRequest`,
 * `VerifyResponse`, `HsmError` are re-exported.
 */

export * from './types.js';
export { MockHsmAdapter, type MockHsmConfig } from './adapters/mock.js';
export { AwsKmsAdapter, type AwsKmsConfig, signSigV4 } from './adapters/awsKms.js';
export { Pkcs11Adapter, type Pkcs11Config } from './adapters/pkcs11.js';
export { Signer, type SignerConfig } from './signer.js';
export { JsonlAuditLog, InMemoryAuditLog } from './audit.js';
