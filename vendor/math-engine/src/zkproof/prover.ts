/**
 * FAZA 13.4 — Provably Fair Spin Prover
 *
 * Implements Pedersen-style commit-reveal provably-fair protocol:
 *
 *   1. BEFORE spin: casino calls `createCommitment(serverSeed)` → publishes commitment
 *   2. Player sends `clientSeed` (can be random or player-chosen)
 *   3. Casino computes spin: `deriveSpinSeed(serverSeed, clientSeed, spinIndex)`
 *   4. AFTER spin: casino calls `createProof(...)` → sends to player
 *   5. Player calls `verifyProof(proof)` → checks all derivations
 *
 * The arithmetic circuit representation (stub) encodes:
 *   wire_0 = serverSeed (private)
 *   wire_1 = blinding   (private)
 *   wire_2 = hash(wire_0, wire_1)  == commitment  (public check)
 *   wire_3 = clientSeed (public)
 *   wire_4 = spinIndex  (public)
 *   wire_5 = hash(wire_0, wire_3, wire_4) = spinSeed
 *   wire_6..N = RNG outputs from spinSeed (public — the reel stops)
 *
 * In a real SNARK: the prover generates a Groth16 proof that they know
 * private inputs (serverSeed, blinding) satisfying the circuit constraints,
 * without revealing the private inputs. The verifier only checks the proof.
 */

import type {
  SpinCommitment,
  SpinProof,
  SpinOutcome,
  ProofVerificationResult,
  ArithmeticCircuit,
  CircuitWitness,
  ZkSnarkStub,
} from './types.js';

// ─── Hash function (FNV-1a 256-bit → hex) ────────────────────────────────────

/** Deterministic hash: concatenates inputs, returns 64-char hex. */
function hashHex(...parts: string[]): string {
  const input = parts.join('|');
  // FNV-1a 4-lane cross-mixed to 256 bits
  let h0 = BigInt('14695981039346656037');
  let h1 = BigInt('14695981039346656053');
  let h2 = BigInt('14695981039346656071');
  let h3 = BigInt('14695981039346656089');
  const FNV_PRIME = BigInt('1099511628211');
  const MASK64 = BigInt('0xFFFFFFFFFFFFFFFF');

  const enc = new TextEncoder().encode(input);
  for (let i = 0; i < enc.length; i++) {
    const byte = BigInt(enc[i]!);
    if      (i % 4 === 0) { h0 ^= byte; h0 = BigInt.asUintN(64, h0 * FNV_PRIME); }
    else if (i % 4 === 1) { h1 ^= byte; h1 = BigInt.asUintN(64, h1 * FNV_PRIME); }
    else if (i % 4 === 2) { h2 ^= byte; h2 = BigInt.asUintN(64, h2 * FNV_PRIME); }
    else                  { h3 ^= byte; h3 = BigInt.asUintN(64, h3 * FNV_PRIME); }
  }
  // Cross-mix
  h0 ^= h1 ^ h2 ^ h3;
  h1 ^= BigInt.asUintN(64, h0 * FNV_PRIME);
  h2 ^= BigInt.asUintN(64, h1 * FNV_PRIME);
  h3 ^= BigInt.asUintN(64, h2 * FNV_PRIME);

  const toHex = (n: bigint) => n.toString(16).padStart(16, '0');
  return toHex(h0) + toHex(h1) + toHex(h2) + toHex(h3);
}

// ─── RNG derived from spin seed ───────────────────────────────────────────────

/** Derive a sequence of [0,1) floats from a spin seed using LCG. */
function deriveRngSequence(spinSeed: string, count: number): number[] {
  // Convert first 8 chars of seed hash to a 32-bit initial state
  let state = parseInt(spinSeed.slice(0, 8), 16) >>> 0;
  const result: number[] = [];
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    result.push(state / 0x100000000);
  }
  return result;
}

// ─── SpinProver ───────────────────────────────────────────────────────────────

export class SpinProver {
  private readonly reelCount: number;
  private readonly stripLengths: number[];

  constructor(reelCount = 5, stripLengths?: number[]) {
    this.reelCount = reelCount;
    this.stripLengths = stripLengths ?? Array(reelCount).fill(64);
  }

  /**
   * Step 1: Create commitment to server seed.
   * Publish this BEFORE accepting the spin.
   */
  createCommitment(serverSeed: string, spinIndex: number): SpinCommitment {
    const blinding = hashHex('blinding', serverSeed, String(spinIndex), Date.now().toString());
    const commitment = hashHex(serverSeed, blinding);
    return { commitment, spinIndex, createdAtMs: Date.now() };
  }

  /**
   * Step 2: Derive the spin seed from server seed + client seed + spin index.
   * The client sees the commitment but not the server seed.
   */
  deriveSpinSeed(serverSeed: string, clientSeed: string, spinIndex: number): string {
    return hashHex(serverSeed, clientSeed, String(spinIndex));
  }

  /**
   * Step 3: Derive reel stop positions from spin seed.
   */
  deriveOutcome(spinSeed: string, winMultiplier = 1): SpinOutcome {
    const rngSequence = deriveRngSequence(spinSeed, this.reelCount + 4);
    const reelStops = rngSequence
      .slice(0, this.reelCount)
      .map((f, i) => Math.floor(f * this.stripLengths[i]!));
    return { reelStops, winMultiplier, rngSequence };
  }

  /**
   * Step 4: Create the full proof (after spin completes).
   */
  createProof(
    serverSeed: string,
    blinding: string,
    clientSeed: string,
    spinIndex: number,
    outcome: SpinOutcome,
  ): SpinProof {
    const commitment = hashHex(serverSeed, blinding);
    return {
      commitment,
      serverSeed,
      blindingFactor: blinding,
      clientSeed,
      spinIndex,
      outcome,
      proofType: 'pedersen_commitment',
    };
  }

  /**
   * Convenience: create commitment + derive outcome in one call (server-side).
   * Returns { commitment, proof } — publish commitment before spin, proof after.
   */
  proveSpinFull(serverSeed: string, clientSeed: string, spinIndex: number): {
    commitment: SpinCommitment;
    proof: SpinProof;
  } {
    const blinding = hashHex('blinding', serverSeed, String(spinIndex));
    const commitment = this.createCommitment(serverSeed, spinIndex);
    const spinSeed = this.deriveSpinSeed(serverSeed, clientSeed, spinIndex);
    const outcome = this.deriveOutcome(spinSeed);
    const proof = this.createProof(serverSeed, blinding, clientSeed, spinIndex, outcome);
    return { commitment, proof };
  }
}

// ─── SpinVerifier ─────────────────────────────────────────────────────────────

export class SpinVerifier {
  private readonly reelCount: number;
  private readonly stripLengths: number[];

  constructor(reelCount = 5, stripLengths?: number[]) {
    this.reelCount = reelCount;
    this.stripLengths = stripLengths ?? Array(reelCount).fill(64);
  }

  /** Verify a spin proof. Returns detailed result. */
  verify(proof: SpinProof): ProofVerificationResult {
    const checks: string[] = [];
    const failures: string[] = [];

    // Check 1: commitment = H(serverSeed, blindingFactor)
    const expectedCommitment = hashHex(proof.serverSeed, proof.blindingFactor);
    if (expectedCommitment === proof.commitment) {
      checks.push('commitment_matches: H(serverSeed, blinding) == commitment ✓');
    } else {
      failures.push('commitment_mismatch: H(serverSeed, blinding) != commitment');
    }

    // Check 2: spinSeed = H(serverSeed, clientSeed, spinIndex)
    const spinSeed = hashHex(proof.serverSeed, proof.clientSeed, String(proof.spinIndex));
    checks.push(`spin_seed_derived: H(${proof.serverSeed.slice(0,8)}..., ${proof.clientSeed.slice(0,8)}..., ${proof.spinIndex})`);

    // Check 3: RNG sequence matches
    const prover = new SpinProver(this.reelCount, this.stripLengths);
    const expectedOutcome = prover.deriveOutcome(spinSeed, proof.outcome.winMultiplier);

    const rngMatch = proof.outcome.rngSequence.every(
      (v, i) => Math.abs(v - (expectedOutcome.rngSequence[i] ?? -1)) < 1e-10,
    );
    if (rngMatch) {
      checks.push('rng_sequence_matches: deterministic derivation ✓');
    } else {
      failures.push('rng_sequence_mismatch: RNG output differs from expected');
    }

    // Check 4: reel stops match RNG
    const stopsMatch = proof.outcome.reelStops.every(
      (s, i) => s === expectedOutcome.reelStops[i],
    );
    if (stopsMatch) {
      checks.push('reel_stops_match: floor(rng[i] * stripLength[i]) correct ✓');
    } else {
      failures.push('reel_stops_mismatch: stop positions differ from expected');
    }

    // Check 5: stop positions in valid range
    const stopsInRange = proof.outcome.reelStops.every(
      (s, i) => s >= 0 && s < (this.stripLengths[i] ?? 64),
    );
    if (stopsInRange) {
      checks.push('stops_in_range: all stops within reel strip bounds ✓');
    } else {
      failures.push('stops_out_of_range: stop position exceeds strip length');
    }

    const valid = failures.length === 0;
    return {
      valid,
      reason: valid ? null : failures.join('; '),
      checksPerformed: [...checks, ...failures],
    };
  }
}

// ─── Arithmetic circuit builder (SNARK scaffold) ──────────────────────────────

/**
 * Build the arithmetic circuit for spin outcome derivation.
 * This defines the R1CS constraints that a SNARK prover would satisfy.
 * Wire format: each wire has a unique string label.
 */
export function buildSpinCircuit(reelCount: number): ArithmeticCircuit {
  const gates = [];
  const privateInputs = ['server_seed', 'blinding'];
  const publicInputs  = ['commitment', 'client_seed', 'spin_index'];

  // Gate 0: commitment = hash(server_seed, blinding)
  gates.push({ op: 'hash' as const, inputs: ['server_seed', 'blinding'], out: 'computed_commitment' });

  // Gate 1: spin_seed = hash(server_seed, client_seed, spin_index)
  gates.push({ op: 'hash' as const, inputs: ['server_seed', 'client_seed', 'spin_index'], out: 'spin_seed' });

  // Gates 2..N: rng_i = LCG(spin_seed, i) → reel_stop_i = rng_i mod strip_len_i
  for (let i = 0; i < reelCount; i++) {
    gates.push({ op: 'hash' as const, inputs: ['spin_seed', `const_${i}`], out: `rng_${i}` });
    gates.push({ op: 'const' as const, value: BigInt(64), out: `strip_len_${i}` });
    gates.push({ op: 'mul' as const, left: `rng_${i}`, right: `strip_len_${i}`, out: `reel_stop_raw_${i}` });
    // floor → represented as integer division in R1CS
    gates.push({ op: 'add' as const, left: `reel_stop_raw_${i}`, right: 'zero', out: `reel_stop_${i}` });
  }

  const outputWires = ['computed_commitment', ...Array.from({ length: reelCount }, (_, i) => `reel_stop_${i}`)];

  return { publicInputs, privateInputs, gates, outputWires };
}

/**
 * Compute a circuit witness given private inputs.
 * In a real SNARK, this would be fed to the prover algorithm (Groth16 Setup + Prove).
 */
export function computeWitness(
  circuit: ArithmeticCircuit,
  privateValues: Record<string, string>,
  publicValues: Record<string, string>,
): CircuitWitness {
  const witness: CircuitWitness = {};

  // Assign public inputs
  for (const [k, v] of Object.entries(publicValues)) {
    witness[k] = BigInt('0x' + hashHex(v).slice(0, 15));
  }
  // Assign private inputs
  for (const [k, v] of Object.entries(privateValues)) {
    witness[k] = BigInt('0x' + hashHex(v).slice(0, 15));
  }
  witness['zero'] = 0n;

  // Evaluate gates
  for (const gate of circuit.gates) {
    switch (gate.op) {
      case 'const':
        witness[gate.out] = gate.value;
        break;
      case 'input':
        // already assigned
        break;
      case 'hash': {
        const hashInput = gate.inputs.map(w => witness[w]?.toString() ?? '0').join('|');
        witness[gate.out] = BigInt('0x' + hashHex(hashInput).slice(0, 15));
        break;
      }
      case 'add':
        witness[gate.out] = (witness[gate.left] ?? 0n) + (witness[gate.right] ?? 0n);
        break;
      case 'mul':
        witness[gate.out] = (witness[gate.left] ?? 0n) * (witness[gate.right] ?? 0n);
        break;
    }
  }

  return witness;
}

/**
 * Build a SNARK stub (Phase 1 scaffold for real Groth16/PLONK implementation).
 * The stub contains all necessary circuit metadata for future integration.
 */
export function buildSnarkStub(
  serverSeedHash: string,
  clientSeed: string,
  spinIndex: number,
  circuit: ArithmeticCircuit,
): ZkSnarkStub {
  const r1csConstraints = circuit.gates.filter(g => g.op === 'mul').length;
  const circuitId = hashHex('circuit', String(circuit.gates.length), String(r1csConstraints));

  return {
    circuitId,
    r1csConstraints,
    publicInputs: {
      commitment:   serverSeedHash,
      client_seed:  clientSeed,
      spin_index:   String(spinIndex),
    },
    // In real Groth16: proof = (A∈G1, B∈G2, C∈G1) — three group elements
    // Stub: hash of circuit + public inputs as placeholder
    proofBytes: hashHex(circuitId, serverSeedHash, clientSeed, String(spinIndex)),
    note: 'Phase-A scaffold — real SNARK (Groth16/PLONK) integration in Phase 2 pending trusted setup',
  };
}
