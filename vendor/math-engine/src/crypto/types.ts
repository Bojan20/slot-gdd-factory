export interface CommitRevealSession {
  sessionId: string;
  serverSeedHash: string;
  playerSeed: string;
  nonce: number;
  revealed: boolean;
  serverSeed?: string;
}

export interface SpinProof {
  sessionId: string;
  spinIndex: number;
  serverSeed: string;
  playerSeed: string;
  nonce: number;
  derivedSeed: string;
  proofHash: string;
}

export interface VerificationResult {
  valid: boolean;
  reason?: string;
  recomputedHash?: string;
}
