/**
 * FAZA 13.4 — zk-SNARK Proof Layer
 *
 * Provably-fair slot spin proof system.
 *
 * Phase 1 (this): Pedersen-commitment + arithmetic circuit scaffold
 * Phase 2 (future): Real Groth16/PLONK integration via snarkjs/bellman
 *
 * Usage (casino server-side):
 *   const prover = new SpinProver(5, [64, 64, 64, 64, 64]);
 *   const { commitment, proof } = prover.proveSpinFull(serverSeed, clientSeed, spinIdx);
 *   // Publish commitment before spin, reveal proof after
 *
 * Usage (player verification):
 *   const verifier = new SpinVerifier(5);
 *   const result = verifier.verify(proof);
 *   console.log(result.valid, result.reason);
 */
export { SpinProver, SpinVerifier, buildSpinCircuit, computeWitness, buildSnarkStub } from './prover.js';
export type {
  SpinCommitment,
  SpinProof,
  SpinOutcome,
  ProofVerificationResult,
  ArithmeticCircuit,
  CircuitGate,
  CircuitWitness,
  ZkSnarkStub,
} from './types.js';
