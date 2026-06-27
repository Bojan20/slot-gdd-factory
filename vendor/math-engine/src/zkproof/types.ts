/**
 * FAZA 13.4 — zk-SNARK Proof Layer Types
 *
 * Crypto-casino native provably-fair proof system.
 * Architecture: Pedersen-style commit-reveal with arithmetic circuit
 * representation of the spin outcome derivation.
 *
 * Design:
 *   Phase 1 (this implementation): Pedersen-commitment scaffold
 *     - Prover commits to server seed: C = H(serverSeed || blinding)
 *     - Player provides clientSeed
 *     - Combined seed: spinSeed = H(C || clientSeed || spinIndex)
 *     - Outcome derived deterministically from spinSeed
 *     - Proof: (C, openedServerSeed, blinding, clientSeed, spinIndex) →
 *              verifier checks derivation without trusting server
 *
 *   Phase 2 (future): Full Groth16/PLONK SNARK
 *     - Arithmetic circuit encoding the hash chain + RNG derivation
 *     - Proof size: O(1) regardless of circuit depth
 *     - Currently stubbed as `zkSnarkStub`
 *
 * The key property (Stake-style provable fair):
 *   Casino publishes H(serverSeed) BEFORE the spin.
 *   After spin, reveals serverSeed.
 *   Player can verify: H(serverSeed) matches published, and outcome
 *   follows deterministically from (serverSeed, clientSeed, spinIndex).
 *
 * References:
 *   - Groth16: https://eprint.iacr.org/2016/260
 *   - PLONK:   https://eprint.iacr.org/2019/953
 */

// ─── Pedersen commitment (Phase 1) ───────────────────────────────────────────

export interface SpinCommitment {
  /** Published hash: H(serverSeed || blinding). Revealed before spin. */
  commitment: string;
  /** spin index this commitment covers. */
  spinIndex: number;
  /** Timestamp when commitment was created. */
  createdAtMs: number;
}

export interface SpinProof {
  /** The commitment hash published before spin. */
  commitment: string;
  /** Opened server seed (revealed after spin). */
  serverSeed: string;
  /** Blinding factor (revealed after spin). */
  blindingFactor: string;
  /** Client-provided seed. */
  clientSeed: string;
  /** Spin index. */
  spinIndex: number;
  /** The spin outcome (grid positions). */
  outcome: SpinOutcome;
  /** Proof type. */
  proofType: 'pedersen_commitment' | 'zk_snark_stub';
}

export interface SpinOutcome {
  /** Stop positions per reel. */
  reelStops: number[];
  /** Total win multiplier. */
  winMultiplier: number;
  /** RNG sequence (first N outputs used). */
  rngSequence: number[];
}

export interface ProofVerificationResult {
  valid: boolean;
  /** null if valid, otherwise explains why invalid. */
  reason: string | null;
  /** Steps checked during verification. */
  checksPerformed: string[];
}

// ─── Arithmetic circuit (scaffold for Phase 2) ───────────────────────────────

/** A gate in the arithmetic circuit. */
export type CircuitGate =
  | { op: 'add';   left: string; right: string; out: string }
  | { op: 'mul';   left: string; right: string; out: string }
  | { op: 'hash';  inputs: string[];            out: string }
  | { op: 'const'; value: bigint;               out: string }
  | { op: 'input'; label: string;               out: string };

/** Witness: assignment of values to all circuit wires. */
export type CircuitWitness = Record<string, bigint>;

export interface ArithmeticCircuit {
  /** Public inputs (known to verifier). */
  publicInputs: string[];
  /** Private inputs (known only to prover). */
  privateInputs: string[];
  /** Gates in topological order. */
  gates: CircuitGate[];
  /** Output wire labels whose values constitute the proof statement. */
  outputWires: string[];
}

/** Stub proof (real SNARK proof would be a field element array). */
export interface ZkSnarkStub {
  /** Circuit identifier. */
  circuitId: string;
  /** R1CS constraint count (would be used by the actual prover). */
  r1csConstraints: number;
  /** Public inputs to the circuit. */
  publicInputs: Record<string, string>;
  /** Stub proof bytes (real impl: π_A, π_B, π_C from Groth16). */
  proofBytes: string;
  /** Note explaining this is a scaffold. */
  note: string;
}
