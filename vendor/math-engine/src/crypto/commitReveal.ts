import { ChaCha20Rng } from './chacha20.js';
import type { CommitRevealSession, SpinProof, VerificationResult } from './types.js';

// ─────────────────────────────────────────────────────────────────────────────
// FNV-1a 128-bit hash (4-lane, cross-mixed) → 32 hex chars
// ─────────────────────────────────────────────────────────────────────────────

// Four independent FNV-1a 32-bit lanes with distinct offset bases and primes,
// cross-mixed after every byte to achieve 128-bit (32 hex char) output.

const FNV_PRIME  = 0x01000193; // 16777619
const FNV_OFFSET = [
  0x811c9dc5, // lane 0
  0xa3b6f5e1, // lane 1
  0xd1e3c7a9, // lane 2
  0xf7b2d843, // lane 3
] as const;

export function fnv1a256(input: string): string {
  const encoder = new TextEncoder();
  const bytes   = encoder.encode(input);

  // 4 independent 32-bit accumulators seeded with distinct offsets
  let h0 = FNV_OFFSET[0] >>> 0;
  let h1 = FNV_OFFSET[1] >>> 0;
  let h2 = FNV_OFFSET[2] >>> 0;
  let h3 = FNV_OFFSET[3] >>> 0;

  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];

    // XOR-then-multiply each lane
    h0 = Math.imul(h0 ^ b, FNV_PRIME) >>> 0;
    h1 = Math.imul(h1 ^ b, FNV_PRIME) >>> 0;
    h2 = Math.imul(h2 ^ b, FNV_PRIME) >>> 0;
    h3 = Math.imul(h3 ^ b, FNV_PRIME) >>> 0;

    // Cross-mix: each lane XORs into the next (rotated position)
    h1 ^= (h0 >>> 13) | (h0 << 19);  h1 >>>= 0;
    h2 ^= (h1 >>> 7)  | (h1 << 25);  h2 >>>= 0;
    h3 ^= (h2 >>> 17) | (h2 << 15);  h3 >>>= 0;
    h0 ^= (h3 >>> 11) | (h3 << 21);  h0 >>>= 0;
  }

  // Final avalanche
  h0 ^= h1; h0 = Math.imul(h0, FNV_PRIME) >>> 0;
  h1 ^= h2; h1 = Math.imul(h1, FNV_PRIME) >>> 0;
  h2 ^= h3; h2 = Math.imul(h2, FNV_PRIME) >>> 0;
  h3 ^= h0; h3 = Math.imul(h3, FNV_PRIME) >>> 0;

  return (
    h0.toString(16).padStart(8, '0') +
    h1.toString(16).padStart(8, '0') +
    h2.toString(16).padStart(8, '0') +
    h3.toString(16).padStart(8, '0')
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Session ID generator
// ─────────────────────────────────────────────────────────────────────────────

let _sessionCounter = 0;

function generateSessionId(): string {
  _sessionCounter++;
  return fnv1a256(`session:${Date.now()}:${Math.random()}:${_sessionCounter}`);
}

function generateServerSeed(): string {
  return fnv1a256(`seed:${Date.now()}:${Math.random()}:${_sessionCounter}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// CommitRevealManager
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateSessionOptions {
  sessionId?: string;
}

export class CommitRevealManager {
  private _sessions = new Map<string, CommitRevealSession & { _serverSeed: string }>();

  /**
   * Create a new commit-reveal session.
   * The returned session shows serverSeedHash (commitment) but NOT serverSeed.
   */
  createSession(playerSeed: string, opts?: CreateSessionOptions): CommitRevealSession {
    const sessionId  = opts?.sessionId ?? generateSessionId();
    const serverSeed = generateServerSeed();
    const serverSeedHash = fnv1a256(serverSeed + ':commitment');

    const internal = {
      sessionId,
      serverSeedHash,
      playerSeed,
      nonce:    0,
      revealed: false,
      // _serverSeed is kept internal; not exposed on the public interface
      _serverSeed: serverSeed,
    };

    this._sessions.set(sessionId, internal);

    // Return only the public fields — no serverSeed
    return {
      sessionId,
      serverSeedHash,
      playerSeed,
      nonce:    0,
      revealed: false,
    };
  }

  private _getSession(sessionId: string) {
    const s = this._sessions.get(sessionId);
    if (!s) throw new Error(`Unknown sessionId: ${sessionId}`);
    return s;
  }

  /**
   * Create a ChaCha20Rng for the next spin.
   * Increments the session nonce each call.
   */
  spinRng(sessionId: string): ChaCha20Rng {
    const s = this._getSession(sessionId);
    const derivedSeed = `${s._serverSeed}:${s.playerSeed}:${s.nonce}`;
    s.nonce++;
    return new ChaCha20Rng(derivedSeed);
  }

  /**
   * Return a SpinProof for the current spin state.
   * Before reveal, serverSeed is '[hidden until reveal]'.
   */
  spinProof(sessionId: string): SpinProof {
    const s = this._getSession(sessionId);
    const spinIndex  = s.nonce; // nonce has already been incremented after spinRng
    const serverSeed = s.revealed ? s._serverSeed : '[hidden until reveal]';
    const derivedSeed = fnv1a256(`${s._serverSeed}:${s.playerSeed}:${s.nonce}`);
    const proofHash   = fnv1a256(
      `${s._serverSeed}:${s.playerSeed}:${s.nonce}:${derivedSeed}`
    );

    return {
      sessionId,
      spinIndex,
      serverSeed,
      playerSeed: s.playerSeed,
      nonce:      s.nonce,
      derivedSeed,
      proofHash,
    };
  }

  /**
   * Reveal the server seed for a session (marks it revealed).
   * Returns the server seed.
   */
  revealSession(sessionId: string): string {
    const s = this._getSession(sessionId);
    s.revealed   = true;
    s.serverSeed = s._serverSeed;
    return s._serverSeed;
  }

  /**
   * Verify a SpinProof against a known serverSeed.
   */
  verifyProof(proof: SpinProof, serverSeed: string): VerificationResult {
    const expectedDerivedSeed = fnv1a256(`${serverSeed}:${proof.playerSeed}:${proof.nonce}`);
    if (expectedDerivedSeed !== proof.derivedSeed) {
      return {
        valid:           false,
        reason:          'derivedSeed mismatch',
        recomputedHash:  expectedDerivedSeed,
      };
    }

    const expectedProofHash = fnv1a256(
      `${serverSeed}:${proof.playerSeed}:${proof.nonce}:${proof.derivedSeed}`
    );
    if (expectedProofHash !== proof.proofHash) {
      return {
        valid:           false,
        reason:          'proofHash mismatch',
        recomputedHash:  expectedProofHash,
      };
    }

    return { valid: true, recomputedHash: expectedProofHash };
  }
}
