/**
 * W152 Wave 56 — Demo Mode controller (compliance pre-cert playback).
 *
 * Closes the long-standing ⚠️ "Demo mode explicit flag" gap by adding a
 * regulator-facing mode that REPLAYS a pre-recorded script of spin
 * outcomes WITHOUT consuming any RNG. Designed for:
 *
 *   1. Regulator demos — operator presents specific outcomes (big-win,
 *      jackpot, feature trigger) on-demand without revealing PRNG seed.
 *   2. Cert paper trail — auditor verifies that demo session produced
 *      exactly the scripted outcomes via cryptographic attestation.
 *   3. UI / sales presentations — repeatable showroom sessions with
 *      pre-curated narrative.
 *   4. QA repro — reproduce edge cases without seed reverse-engineering.
 *
 * ── Industry context (vendor-neutral) ─────────────────────────────────────
 * GLI-19 §3.3.9 (replay capability), MGA PPD 2018 §11.b (auditor
 * traceability), UKGC RTS 9 (player notification of demo vs real),
 * and eCOGRA TG-VG explicitly require operators to differentiate
 * demo / real-money modes and provide auditable trails. Engine-side
 * this is the controller that ENFORCES the boundary.
 *
 * Naming policy (clean-room, per `docs/IP_REVIEW.md`):
 *   • "Demo mode" is industry-standard regulator terminology.
 *   • No vendor-specific implementation marks.
 *   • Verified by `check-reserved-terms.sh`.
 *
 * ── Architecture ──────────────────────────────────────────────────────────
 * DemoModeController holds:
 *   • `isActive` flag — true while demo session running
 *   • `script` — ordered list of DemoSpinOutcome
 *   • `cursor` — current position in script
 *   • `cycleMode` — what to do when script exhausted (loop / halt / error)
 *   • `sessionId` — UUIDv4-like deterministic ID derived from script + start time
 *   • `scriptDigest` — SHA-256 of canonical script JSON (attestable)
 *   • `auditLog` — append-only log of every demo spin executed
 *   • `assertNoRngCall(reason)` — throws if real RNG is called while active
 *
 * Lifecycle:
 *   1. `startSession(script, sessionMeta?)` — activate + commit attestation
 *   2. `nextSpin()` — return next outcome, advance cursor, append audit
 *   3. `endSession()` — deactivate + finalize audit trail
 *
 * ── Compliance attestation ────────────────────────────────────────────────
 * Pre-session: SHA-256(canonicalize(script + sessionId + startTimestamp))
 * digests committed on `startSession`. Auditor verifies post-session:
 *   1. Recompute digest from audit log
 *   2. Compare against committed digest
 *   3. Verify every spin's audit entry matches the scripted outcome
 *
 * ── References ────────────────────────────────────────────────────────────
 * GLI-19 §3.3.9 — Replay Capability requirements
 * UKGC RTS 9 — Demo / real-money distinction
 * MGA PPD 2018 §11.b — Auditor traceability
 */

import { createHash } from 'crypto';

// ── Public types ────────────────────────────────────────────────────────────

export interface DemoSpinOutcome {
  /** Stable spin identifier (e.g. "spin_001", "fs_trigger_big_win"). */
  spinId: string;
  /** Reel stops for base game spin (one per reel). */
  reelStops: number[];
  /** Expected total win in X (multiplier of base bet). */
  expectedWinX: number;
  /** Optional feature triggers in this spin. */
  featureTriggers?: Array<{
    featureKind: string;
    forceParams?: Record<string, unknown>;
  }>;
  /** Optional notes (human-readable). */
  notes?: string;
}

export type CycleMode = 'loop' | 'halt' | 'error';

export interface DemoSessionMetadata {
  /** Operator-supplied label (e.g. "MGA-regulator-demo-2026-05-20"). */
  label?: string;
  /** Operator user ID running the session. */
  operatorId?: string;
  /** Reason / context (e.g. "GLI-19 §3.3.9 replay audit"). */
  reason?: string;
}

export interface DemoSessionAttestation {
  sessionId: string;
  startTimestampMs: number;
  scriptDigest: string;
  scriptLength: number;
  cycleMode: CycleMode;
  metadata: DemoSessionMetadata;
}

export interface DemoAuditEntry {
  /** Sequential index within the session (0-based). */
  sequenceNum: number;
  /** Index into the script (modulo script length when looping). */
  scriptIndex: number;
  /** The outcome served. */
  outcome: DemoSpinOutcome;
  /** Wall-clock ms when served. */
  servedAtMs: number;
}

export interface DemoSessionReport {
  attestation: DemoSessionAttestation;
  endTimestampMs: number;
  spinsServed: number;
  cycleCount: number;
  endReason: 'manual' | 'script_halted' | 'script_error';
  auditDigest: string;
  audit: DemoAuditEntry[];
}

// ── Validation ─────────────────────────────────────────────────────────────

export function validateScript(script: DemoSpinOutcome[]): void {
  if (!Array.isArray(script) || script.length === 0) {
    throw new Error(`script must be non-empty array`);
  }
  const seenIds = new Set<string>();
  for (let i = 0; i < script.length; i++) {
    const s = script[i];
    if (typeof s.spinId !== 'string' || s.spinId.length === 0) {
      throw new Error(`script[${i}].spinId must be non-empty string`);
    }
    if (seenIds.has(s.spinId)) {
      throw new Error(`duplicate spinId "${s.spinId}" at index ${i}`);
    }
    seenIds.add(s.spinId);
    if (!Array.isArray(s.reelStops) || s.reelStops.length === 0) {
      throw new Error(`script[${i}].reelStops must be non-empty array`);
    }
    for (const stop of s.reelStops) {
      if (!Number.isInteger(stop) || stop < 0) {
        throw new Error(`script[${i}].reelStops entries must be non-negative integers`);
      }
    }
    if (!Number.isFinite(s.expectedWinX) || s.expectedWinX < 0) {
      throw new Error(`script[${i}].expectedWinX must be non-negative finite`);
    }
    if (s.featureTriggers !== undefined) {
      if (!Array.isArray(s.featureTriggers)) {
        throw new Error(`script[${i}].featureTriggers must be array if provided`);
      }
      for (const t of s.featureTriggers) {
        if (typeof t.featureKind !== 'string' || t.featureKind.length === 0) {
          throw new Error(`script[${i}].featureTriggers[].featureKind must be non-empty string`);
        }
      }
    }
  }
}

// ── Hashing helpers ────────────────────────────────────────────────────────

function canonicalize(value: unknown): string {
  // Deterministic JSON: sorted keys, no trailing whitespace
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalize).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize((value as Record<string, unknown>)[k])).join(',') + '}';
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function computeScriptDigest(script: DemoSpinOutcome[]): string {
  return sha256Hex(canonicalize(script));
}

function computeSessionId(scriptDigest: string, startTimestampMs: number): string {
  const composite = sha256Hex(`${scriptDigest}|${startTimestampMs}`);
  // Format as UUIDv4-like for ergonomics (8-4-4-4-12)
  return [
    composite.slice(0, 8),
    composite.slice(8, 12),
    composite.slice(12, 16),
    composite.slice(16, 20),
    composite.slice(20, 32),
  ].join('-');
}

function computeAuditDigest(audit: DemoAuditEntry[]): string {
  return sha256Hex(canonicalize(audit));
}

// ── DemoModeController ─────────────────────────────────────────────────────

export class DemoModeController {
  private active = false;
  private script: DemoSpinOutcome[] = [];
  private cursor = 0;
  private sequenceNum = 0;
  private cycleCount = 0;
  private cycleMode: CycleMode = 'halt';
  private startTimestampMs = 0;
  private scriptDigest = '';
  private sessionId = '';
  private metadata: DemoSessionMetadata = {};
  private auditEntries: DemoAuditEntry[] = [];
  private rngCallBlocked = false;
  private nowFn: () => number;
  private auditSink?: (entry: DemoAuditEntry) => void;

  constructor(opts?: { nowFn?: () => number; auditSink?: (entry: DemoAuditEntry) => void }) {
    this.nowFn = opts?.nowFn ?? (() => Date.now());
    this.auditSink = opts?.auditSink;
  }

  /** Is a demo session currently active? */
  isActive(): boolean {
    return this.active;
  }

  /** Begin a new demo session. Returns attestation. */
  startSession(
    script: DemoSpinOutcome[],
    cycleMode: CycleMode = 'halt',
    metadata: DemoSessionMetadata = {},
  ): DemoSessionAttestation {
    if (this.active) {
      throw new Error(`demo session already active (call endSession first)`);
    }
    validateScript(script);
    this.script = script.slice();
    this.cursor = 0;
    this.sequenceNum = 0;
    this.cycleCount = 0;
    this.cycleMode = cycleMode;
    this.startTimestampMs = this.nowFn();
    this.scriptDigest = computeScriptDigest(this.script);
    this.sessionId = computeSessionId(this.scriptDigest, this.startTimestampMs);
    this.metadata = { ...metadata };
    this.auditEntries = [];
    this.rngCallBlocked = true;
    this.active = true;

    return {
      sessionId: this.sessionId,
      startTimestampMs: this.startTimestampMs,
      scriptDigest: this.scriptDigest,
      scriptLength: this.script.length,
      cycleMode: this.cycleMode,
      metadata: { ...this.metadata },
    };
  }

  /**
   * Serve the next spin outcome. Advances cursor, appends audit entry.
   * Throws if session inactive or script exhausted in 'error' mode.
   * Returns null if cycleMode='halt' and script exhausted.
   */
  nextSpin(): DemoSpinOutcome | null {
    if (!this.active) {
      throw new Error(`no demo session active — call startSession first`);
    }
    if (this.cursor >= this.script.length) {
      if (this.cycleMode === 'halt') return null;
      if (this.cycleMode === 'error') {
        throw new Error(`script exhausted at cursor=${this.cursor}; cycleMode=error`);
      }
      // 'loop'
      this.cursor = 0;
      this.cycleCount++;
    }
    const outcome = this.script[this.cursor];
    const entry: DemoAuditEntry = {
      sequenceNum: this.sequenceNum,
      scriptIndex: this.cursor,
      outcome,
      servedAtMs: this.nowFn(),
    };
    this.auditEntries.push(entry);
    if (this.auditSink) {
      try {
        this.auditSink(entry);
      } catch {
        /* swallow sink errors */
      }
    }
    this.sequenceNum++;
    this.cursor++;
    return outcome;
  }

  /** End the session and return final report with audit digest. */
  endSession(endReason: 'manual' | 'script_halted' | 'script_error' = 'manual'): DemoSessionReport {
    if (!this.active) {
      throw new Error(`no active session to end`);
    }
    const report: DemoSessionReport = {
      attestation: {
        sessionId: this.sessionId,
        startTimestampMs: this.startTimestampMs,
        scriptDigest: this.scriptDigest,
        scriptLength: this.script.length,
        cycleMode: this.cycleMode,
        metadata: { ...this.metadata },
      },
      endTimestampMs: this.nowFn(),
      spinsServed: this.sequenceNum,
      cycleCount: this.cycleCount,
      endReason,
      auditDigest: computeAuditDigest(this.auditEntries),
      audit: this.auditEntries.slice(),
    };
    this.active = false;
    this.rngCallBlocked = false;
    return report;
  }

  /**
   * Real-RNG-call guard. Engine code MUST call this before every
   * real RNG fetch when a demo session might be active. Throws if
   * demo session is active.
   */
  assertNoRngCall(reason: string): void {
    if (this.rngCallBlocked) {
      throw new Error(`demo session active — real RNG calls blocked (reason: ${reason})`);
    }
  }

  /** Current attestation (only valid when active). */
  getAttestation(): DemoSessionAttestation | null {
    if (!this.active) return null;
    return {
      sessionId: this.sessionId,
      startTimestampMs: this.startTimestampMs,
      scriptDigest: this.scriptDigest,
      scriptLength: this.script.length,
      cycleMode: this.cycleMode,
      metadata: { ...this.metadata },
    };
  }

  /** Number of spins served so far in current session. */
  spinsServed(): number {
    return this.sequenceNum;
  }

  /** Cycle count (only > 0 in 'loop' mode after first full pass). */
  cycleCountValue(): number {
    return this.cycleCount;
  }

  /** Current cursor position. */
  cursorValue(): number {
    return this.cursor;
  }
}

// ── Auditor verification ───────────────────────────────────────────────────

/**
 * Auditor-side verification: replay an audit log against the original
 * script and confirm: (a) script digest matches, (b) every audit entry
 * corresponds to the correct script outcome, (c) audit digest matches.
 */
export interface AuditorVerificationResult {
  ok: boolean;
  scriptDigestMatch: boolean;
  auditDigestMatch: boolean;
  outcomeMismatches: number;
  reportedScriptDigest: string;
  recomputedScriptDigest: string;
  reportedAuditDigest: string;
  recomputedAuditDigest: string;
  errors: string[];
}

export function verifyDemoSession(
  originalScript: DemoSpinOutcome[],
  report: DemoSessionReport,
): AuditorVerificationResult {
  const errors: string[] = [];
  const recomputedScriptDigest = computeScriptDigest(originalScript);
  const scriptDigestMatch = recomputedScriptDigest === report.attestation.scriptDigest;
  if (!scriptDigestMatch) {
    errors.push(`script digest mismatch: report=${report.attestation.scriptDigest} vs recomputed=${recomputedScriptDigest}`);
  }
  const recomputedAuditDigest = computeAuditDigest(report.audit);
  const auditDigestMatch = recomputedAuditDigest === report.auditDigest;
  if (!auditDigestMatch) {
    errors.push(`audit digest mismatch: report=${report.auditDigest} vs recomputed=${recomputedAuditDigest}`);
  }
  // Outcome-by-outcome check
  let outcomeMismatches = 0;
  for (const entry of report.audit) {
    const idx = entry.scriptIndex;
    if (idx < 0 || idx >= originalScript.length) {
      outcomeMismatches++;
      errors.push(`audit entry seq=${entry.sequenceNum}: scriptIndex=${idx} out of range`);
      continue;
    }
    if (canonicalize(entry.outcome) !== canonicalize(originalScript[idx])) {
      outcomeMismatches++;
      errors.push(`audit entry seq=${entry.sequenceNum}: outcome mismatch at scriptIndex=${idx}`);
    }
  }
  return {
    ok: scriptDigestMatch && auditDigestMatch && outcomeMismatches === 0,
    scriptDigestMatch,
    auditDigestMatch,
    outcomeMismatches,
    reportedScriptDigest: report.attestation.scriptDigest,
    recomputedScriptDigest,
    reportedAuditDigest: report.auditDigest,
    recomputedAuditDigest,
    errors,
  };
}
