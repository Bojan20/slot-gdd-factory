/**
 * W152 P2-14 — Verifiable Random Function (VRF) adapter.
 *
 * Per KIMI 15 (`docs/W152/15-zk-verifiable-rng.md`), the production
 * baseline for "provably-fair" slot RNG in 2025–2026 is **ECVRF**
 * (RFC 9381, ciphersuite `SECP256K1_SHA256_TAI` — the suite Rollbit
 * upgraded to in 2025) and **Chainlink VRF v2.5** for the on-chain
 * GLI-19-certified path. We deliberately do NOT build ZK-per-spin
 * (Halo2/Risc0/SP1) because:
 *
 *   1. No regulator has approved a ZK-per-spin slot RNG as of 2026-Q1.
 *   2. Per-spin proof latency is 7–15 s (Risc0) — incompatible with
 *      the <200 ms RGS SLA from KIMI 13.
 *   3. UKGC is actively cracking down on unlicensed crypto-native
 *      operators (KIMI 15 §3).
 *
 * What this module provides:
 *   * `VRFProver` interface — abstract beta + proof emitter, used by
 *     the engine when an integrator wires in a real ECVRF / Chainlink
 *     VRF backend.
 *   * `Sha256CommitRevealVRF` — minimal in-process implementation: the
 *     "server seed / client seed / nonce" pattern that Stake, BC.Game
 *     and most crypto-native casinos still ship. Provides verifiable
 *     determinism, NOT cryptographic VRF. Acceptable for *provably-fair
 *     transparency layer* on top of a GLI-19-certified primary RNG.
 *   * `ChainlinkVRFv2_5Adapter` — strict typed bridge to the on-chain
 *     coordinator. Marked async because the on-chain round-trip is
 *     ~2 s (KIMI 15 §2). NOT a default — wire in via DI.
 *   * `NoOpVRFProver` — null object for tests / non-VRF jurisdictions.
 *
 * IMPORTANT — what this module is NOT:
 *   * It is NOT a replacement for the GLI-19 certified RNG. Every
 *     production game still runs `RngFactory.create('chacha20', seed)`
 *     for the actual outcome stream; the VRF emits a *proof* the
 *     player can verify after the fact.
 *   * It is NOT a ZK circuit. `proof` is whatever the chosen backend
 *     supplies (commit-reveal bytes / VRF π / Chainlink txn hash).
 *
 * RFC 9381 reference: https://www.rfc-editor.org/rfc/rfc9381
 */

import { sha256 } from '@noble/hashes/sha2';

// ─── Public types ──────────────────────────────────────────────────────────

/**
 * A single VRF emission. `beta` is the pseudo-random output the engine
 * (or downstream consumer) uses as entropy. `proof` is opaque bytes
 * the player or auditor verifies via the backend's `verify()` API —
 * always opaque to the engine.
 */
export interface VRFOutput {
  /** 32-byte pseudo-random output (interpret per backend). */
  beta: Uint8Array;
  /** Backend-specific proof bytes. Hex-encode for storage / audit log. */
  proof: Uint8Array;
  /** Audit metadata — backend name, ciphersuite, optional txn hash. */
  metadata: VRFMetadata;
}

export interface VRFMetadata {
  /** "ecvrf-secp256k1-sha256-tai", "sha256-commit-reveal", "chainlink-vrf-v2.5", … */
  backend: string;
  /** RFC 9381 ciphersuite string if applicable. */
  ciphersuite?: string;
  /** Optional Chainlink transaction hash (on-chain backend). */
  txHash?: string;
  /** UTC ISO timestamp of proof generation. */
  generatedAtUtc: string;
}

/** Abstract VRF backend. */
export interface VRFProver {
  /**
   * Generate a VRF output for the given input (typically a session/spin
   * identifier or game-round seed).
   *
   * The input is opaque bytes; backends may hash, encode, or pass it
   * through unmodified.
   */
  prove(input: Uint8Array): Promise<VRFOutput>;
  /** Verify a previously generated `output` against the original `input`. */
  verify(input: Uint8Array, output: VRFOutput): Promise<boolean>;
  /** Backend identifier (logged in PAR sheets / audit dossier). */
  readonly backendId: string;
}

// ─── SHA-256 commit-reveal (default, in-process) ──────────────────────────

/**
 * Commit-reveal VRF: server publishes `H(serverSeed)` before the game,
 * reveals `serverSeed` after the game. The player can recompute the
 * full keystream as `SHA256(serverSeed || clientSeed || nonce)` and
 * verify their outcome.
 *
 * This is the model Stake, BC.Game, Rollbit (pre-ECVRF) used and is
 * accepted by crypto-native players as "provably fair". It is NOT a
 * cryptographic VRF — adversaries who can choose `serverSeed` can
 * still bias outputs. Pair with a true CSPRNG for the actual entropy
 * (`ChaCha20Rng`); the commit-reveal layer is a transparency feature.
 */
export class Sha256CommitRevealVRF implements VRFProver {
  readonly backendId = 'sha256-commit-reveal';

  /**
   * @param serverSeed 32+ bytes. MUST be drawn from a CSPRNG.
   * @param clientSeed Optional player-supplied input (string or bytes).
   */
  constructor(
    private readonly serverSeed: Uint8Array,
    private readonly clientSeed: Uint8Array = new Uint8Array(0),
  ) {
    if (serverSeed.length < 32) {
      throw new Error(
        'Sha256CommitRevealVRF: serverSeed must be ≥ 32 bytes for security',
      );
    }
  }

  /** Public commitment the operator publishes BEFORE the round. */
  commitment(): Uint8Array {
    return sha256(this.serverSeed);
  }

  async prove(input: Uint8Array): Promise<VRFOutput> {
    // β = SHA256(server || client || input)
    const buf = new Uint8Array(
      this.serverSeed.length + this.clientSeed.length + input.length,
    );
    buf.set(this.serverSeed, 0);
    buf.set(this.clientSeed, this.serverSeed.length);
    buf.set(input, this.serverSeed.length + this.clientSeed.length);
    const beta = sha256(buf);
    // π = (server || client) — once revealed, anyone can recompute β.
    const proof = new Uint8Array(this.serverSeed.length + this.clientSeed.length);
    proof.set(this.serverSeed, 0);
    proof.set(this.clientSeed, this.serverSeed.length);
    return {
      beta,
      proof,
      metadata: {
        backend: this.backendId,
        generatedAtUtc: new Date().toISOString(),
      },
    };
  }

  async verify(input: Uint8Array, output: VRFOutput): Promise<boolean> {
    // Recover server/client from proof, recompute β, compare.
    const serverLen = this.serverSeed.length;
    if (output.proof.length < serverLen) return false;
    const server = output.proof.slice(0, serverLen);
    const client = output.proof.slice(serverLen);
    const buf = new Uint8Array(server.length + client.length + input.length);
    buf.set(server, 0);
    buf.set(client, server.length);
    buf.set(input, server.length + client.length);
    const expected = sha256(buf);
    if (expected.length !== output.beta.length) return false;
    for (let i = 0; i < expected.length; i++) {
      if (expected[i] !== output.beta[i]) return false;
    }
    return true;
  }
}

// ─── Chainlink VRF v2.5 adapter (stub) ────────────────────────────────────

/**
 * Bridge to the on-chain Chainlink VRF v2.5 coordinator. Marked async
 * because the round-trip is ~2 seconds (KIMI 15 §2). The actual
 * Web3 call is out of scope here — the integrator wires in their
 * preferred Ethers/Viem/Web3.js client through the `requester`
 * callback. We provide the typing + audit-trail contract so the
 * engine can stay backend-agnostic.
 *
 * Per KIMI 15, Chainlink VRF v2.5 is the ONLY on-chain randomness
 * oracle with a GLI-19 certification (via BMM Testlabs). If a
 * studio wants on-chain provably-fair, this is the path.
 */
export class ChainlinkVRFv2_5Adapter implements VRFProver {
  readonly backendId = 'chainlink-vrf-v2.5';

  constructor(
    /**
     * Caller-supplied function that talks to the on-chain coordinator
     * and returns `{ beta, proof, txHash }` for the given input. The
     * adapter stays Web3-library agnostic.
     */
    private readonly requester: (input: Uint8Array) => Promise<{
      beta: Uint8Array;
      proof: Uint8Array;
      txHash: string;
    }>,
  ) {}

  async prove(input: Uint8Array): Promise<VRFOutput> {
    const { beta, proof, txHash } = await this.requester(input);
    return {
      beta,
      proof,
      metadata: {
        backend: this.backendId,
        ciphersuite: 'secp256k1_sha256_tai',
        txHash,
        generatedAtUtc: new Date().toISOString(),
      },
    };
  }

  async verify(_input: Uint8Array, output: VRFOutput): Promise<boolean> {
    // Verification happens on-chain via the coordinator contract; the
    // off-chain adapter trusts the txHash receipt. A full client-side
    // ECVRF verifier (RFC 9381 §5) would go here for trustless replay.
    return Boolean(output.metadata.txHash);
  }
}

// ─── No-op VRF ─────────────────────────────────────────────────────────────

/**
 * Null object — used by tests and by games shipped to non-crypto
 * jurisdictions that don't need a transparency layer. Every `prove`
 * returns a zero β / empty proof; `verify` always returns false to
 * make sure callers never confuse this with a real proof.
 */
export class NoOpVRFProver implements VRFProver {
  readonly backendId = 'noop';

  async prove(_input: Uint8Array): Promise<VRFOutput> {
    return {
      beta: new Uint8Array(32),
      proof: new Uint8Array(0),
      metadata: { backend: this.backendId, generatedAtUtc: new Date().toISOString() },
    };
  }

  async verify(_input: Uint8Array, _output: VRFOutput): Promise<boolean> {
    return false;
  }
}
