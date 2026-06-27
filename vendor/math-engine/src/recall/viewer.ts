/**
 * Faza 11.6 — Spin Recall / Replay CLI Viewer.
 *
 * Provides human-readable display of journal entries, chain verification,
 * dispute certificates, and session-level summaries.
 */

import { computeEntryHash } from './integrity.js';
import type { SpinJournalEntry } from './types.js';
import { ZERO_HASH } from './types.js';

// ─── Types ─────────────────────────────────────────────────────────────

export interface SpinDisplay {
  spinIndex: number;
  /** Reconstructed grid — row-major 2D array of symbol labels (or empty if no trace). */
  grid: string[][];
  win: number;
  features: string[];
  chainValid: boolean;
  signature: string;
}

export interface ChainVerificationReport {
  totalSpins: number;
  integrityOk: boolean;
  firstBrokenAt?: number;
  brokenSignatures: number[];
}

export interface DisputeCertificate {
  spinIndex: number;
  signature: string;
  prevSignature: string;
  grid: string[][];
  win: number;
  chainIntegrityOk: boolean;
  verificationTimestamp: number;
  verdictMessage: string;
}

// ─── SpinReplayViewer ──────────────────────────────────────────────────

export class SpinReplayViewer {
  private readonly journal: SpinJournalEntry[];

  constructor(journal: SpinJournalEntry[]) {
    this.journal = journal.slice(); // defensive copy
  }

  // ── getSpin ─────────────────────────────────────────────────────────

  getSpin(index: number): SpinDisplay | undefined {
    if (index < 0 || index >= this.journal.length) return undefined;
    const entry = this.journal[index];
    return this.entryToDisplay(entry, index);
  }

  // ── formatSpinAscii ─────────────────────────────────────────────────

  formatSpinAscii(index: number): string {
    if (index < 0 || index >= this.journal.length) {
      return `[Error] Spin #${index} out of bounds (journal has ${this.journal.length} entries)`;
    }
    const display = this.getSpin(index);
    if (!display) {
      return `[Error] Spin #${index} not found`;
    }

    const lines: string[] = [];
    const border = '+' + '-'.repeat(50) + '+';
    lines.push(border);
    lines.push(`| Spin #${display.spinIndex}${' '.repeat(Math.max(1, 43 - String(display.spinIndex).length))}|`);
    lines.push(border);

    // Grid
    if (display.grid.length > 0) {
      for (const row of display.grid) {
        const rowStr = '| ' + row.map((cell) => cell.padEnd(6)).join(' | ') + ' |';
        lines.push(rowStr);
      }
    } else {
      lines.push('| (no grid data)                                   |');
    }

    lines.push(border);
    lines.push(`| Win: ${display.win} mc${' '.repeat(Math.max(1, 42 - String(display.win).length))}|`);
    if (display.features.length > 0) {
      lines.push(`| Features: ${display.features.join(', ').substring(0, 39).padEnd(39)}|`);
    }
    lines.push(`| Chain: ${display.chainValid ? 'VERIFIED' : 'BROKEN  '}${' '.repeat(38)}|`);
    lines.push(`| Sig: ${display.signature.substring(0, 16)}...${' '.repeat(29)}|`);
    lines.push(border);

    return lines.join('\n');
  }

  // ── verifyChain ─────────────────────────────────────────────────────

  verifyChain(): ChainVerificationReport {
    const totalSpins = this.journal.length;
    if (totalSpins === 0) {
      return { totalSpins: 0, integrityOk: true, brokenSignatures: [] };
    }

    const brokenSignatures: number[] = [];
    let firstBrokenAt: number | undefined;
    let prevHash: string = ZERO_HASH;

    for (let i = 0; i < this.journal.length; i++) {
      const entry = this.journal[i];
      let broken = false;

      // Check prev_hash linkage
      if (entry.prev_hash !== prevHash) {
        broken = true;
      }

      // Recompute entry_hash
      if (!broken) {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { entry_hash: _ignored, ...withoutHash } = entry;
        const recomputed = computeEntryHash(withoutHash);
        if (recomputed !== entry.entry_hash) {
          broken = true;
        }
      }

      if (broken) {
        brokenSignatures.push(i);
        if (firstBrokenAt === undefined) {
          firstBrokenAt = i;
        }
      }

      prevHash = entry.entry_hash;
    }

    return {
      totalSpins,
      integrityOk: brokenSignatures.length === 0,
      firstBrokenAt,
      brokenSignatures,
    };
  }

  // ── disputeCertificate ───────────────────────────────────────────────

  disputeCertificate(spinIndex: number): DisputeCertificate {
    const entry = spinIndex >= 0 && spinIndex < this.journal.length
      ? this.journal[spinIndex]
      : undefined;

    const now = Date.now();

    if (!entry) {
      return {
        spinIndex,
        signature: ZERO_HASH,
        prevSignature: ZERO_HASH,
        grid: [],
        win: 0,
        chainIntegrityOk: false,
        verificationTimestamp: now,
        verdictMessage: `invalid: spin index ${spinIndex} does not exist in this journal`,
      };
    }

    // Verify this entry's hash
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { entry_hash: _ignored, ...withoutHash } = entry;
    const recomputed = computeEntryHash(withoutHash);
    const hashOk = recomputed === entry.entry_hash;

    // Check prev_hash against predecessor
    let prevHashOk = true;
    if (spinIndex === 0) {
      prevHashOk = entry.prev_hash === ZERO_HASH;
    } else {
      prevHashOk = entry.prev_hash === this.journal[spinIndex - 1].entry_hash;
    }

    const chainIntegrityOk = hashOk && prevHashOk;
    const verdictMessage = chainIntegrityOk
      ? `verified: spin #${spinIndex} hash chain is intact`
      : `invalid: spin #${spinIndex} chain integrity failed (hash_ok=${hashOk}, prev_ok=${prevHashOk})`;

    const display = this.entryToDisplay(entry, spinIndex);

    return {
      spinIndex,
      signature: entry.entry_hash,
      prevSignature: entry.prev_hash,
      grid: display.grid,
      win: entry.result.total_win_mc,
      chainIntegrityOk,
      verificationTimestamp: now,
      verdictMessage,
    };
  }

  // ── getRange ─────────────────────────────────────────────────────────

  getRange(from: number, to: number): SpinDisplay[] {
    if (from > to) return [];
    const result: SpinDisplay[] = [];
    for (let i = from; i <= to; i++) {
      const d = this.getSpin(i);
      if (d !== undefined) result.push(d);
    }
    return result;
  }

  // ── formatSessionReport ──────────────────────────────────────────────

  formatSessionReport(): string {
    const report = this.verifyChain();
    const lines: string[] = [];

    lines.push('=== Session Report ===');
    lines.push(`Total Spins: ${report.totalSpins}`);
    lines.push(`Chain Integrity: ${report.integrityOk ? 'OK' : 'BROKEN'}`);

    if (!report.integrityOk) {
      lines.push(`First Break At: spin #${report.firstBrokenAt}`);
      lines.push(`Broken Entries: ${report.brokenSignatures.join(', ')}`);
    }

    if (report.totalSpins > 0) {
      const totalBetMc = this.journal.reduce((sum, e) => sum + e.bet_total_mc, 0);
      const totalWinMc = this.journal.reduce((sum, e) => sum + e.result.total_win_mc, 0);
      const rtp = totalBetMc > 0 ? (totalWinMc / totalBetMc).toFixed(4) : 'N/A';
      lines.push(`Total Bet: ${totalBetMc} mc`);
      lines.push(`Total Win: ${totalWinMc} mc`);
      lines.push(`Session RTP: ${rtp}`);

      const first = this.journal[0];
      const last = this.journal[this.journal.length - 1];
      lines.push(`Session: ${first.timestamp_utc} → ${last.timestamp_utc}`);
    }

    return lines.join('\n');
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private entryToDisplay(entry: SpinJournalEntry, index: number): SpinDisplay {
    // Chain validity check for this specific entry
    let chainValid = true;
    const prevEntry = index > 0 ? this.journal[index - 1] : null;
    const expectedPrev = prevEntry ? prevEntry.entry_hash : ZERO_HASH;
    if (entry.prev_hash !== expectedPrev) {
      chainValid = false;
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { entry_hash: _ignored, ...withoutHash } = entry;
      const recomputed = computeEntryHash(withoutHash);
      if (recomputed !== entry.entry_hash) chainValid = false;
    }

    // Grid: parse feature_trace if it has grid info, otherwise empty
    const grid = extractGrid(entry.result.feature_trace);

    return {
      spinIndex: index,
      grid,
      win: entry.result.total_win_mc,
      features: entry.result.triggered_features ?? [],
      chainValid,
      signature: entry.entry_hash,
    };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────

function extractGrid(trace: unknown): string[][] {
  if (!trace || typeof trace !== 'object') return [];
  const t = trace as Record<string, unknown>;
  if (Array.isArray(t['grid'])) {
    return t['grid'] as string[][];
  }
  return [];
}
