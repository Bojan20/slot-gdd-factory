/**
 * Analytical Engine — Faza 14.1.
 *
 * Performs exhaustive grid enumeration over all stop-position combinations
 * on strips-mode reel sets. For each unique grid state the payout is computed
 * exactly via `evaluateIR`, and the results are memoized for sub-millisecond
 * re-queries.
 *
 * Key guarantees:
 *   - Only works for `ir.reels.mode === 'strips'` (weighted mode throws).
 *   - Throws when `totalStates > maxStates` (default 1_000_000) to prevent
 *     accidental OOM on large strip configurations.
 *   - analyticalRtp is the exact expected-value RTP (not a simulation estimate).
 *   - query() returns InstantSpinResult in O(1) via Map lookup.
 */

import type { SlotGameIR } from '../ir/types.js';
import { evaluateIR } from '../engine/irEvaluator.js';
import type {
  AnalyticalBuildConfig,
  AnalyticalTable,
  AnalyticalTableEntry,
  InstantSpinResult,
} from './types.js';

const DEFAULT_MAX_STATES = 1_000_000;

export class AnalyticalEngine {
  private readonly tables = new Map<string, AnalyticalTable>();

  /**
   * Build (or rebuild) the memoization table for the given IR.
   *
   * All 5×5×… combinations of strip stop-positions are enumerated via an
   * odometer counter. Each unique grid hash is stored once; the payout and
   * uniform-draw probability are attached to the entry.
   */
  buildTable(ir: SlotGameIR, config: AnalyticalBuildConfig = {}): AnalyticalTable {
    if (ir.reels.mode !== 'strips') {
      throw new Error(
        `AnalyticalEngine.buildTable: only 'strips' reel mode is supported, got '${ir.reels.mode}'`,
      );
    }

    const maxStates = config.maxStates ?? DEFAULT_MAX_STATES;
    const strips = ir.reels.base as string[][];
    const numReels = strips.length;

    // Determine numRows from topology.
    let numRows: number;
    if (ir.topology.kind === 'rectangular') {
      numRows = ir.topology.rows;
    } else {
      numRows = 3; // conservative fallback for non-rectangular topologies
    }

    // totalStates = product of all strip lengths.
    const totalStates = strips.reduce((acc, strip) => acc * strip.length, 1);

    if (totalStates > maxStates) {
      throw new Error(
        `AnalyticalEngine.buildTable: totalStates ${totalStates} exceeds maxStates ${maxStates}. ` +
          `Pass a larger maxStates in AnalyticalBuildConfig to override.`,
      );
    }

    const uniformProb = 1 / totalStates;

    // Odometer counter: pos[r] is the current stop index for reel r.
    const pos = new Array<number>(numReels).fill(0);
    const stripLens = strips.map((s) => s.length);

    const entries = new Map<string, AnalyticalTableEntry>();

    let analyticalRtp = 0;
    let winStates = 0;

    for (let state = 0; state < totalStates; state++) {
      // Build grid: grid[row][reel] = strips[reel][(pos[reel] + row) % stripLen]
      const grid: string[][] = [];
      for (let row = 0; row < numRows; row++) {
        const gridRow: string[] = [];
        for (let reel = 0; reel < numReels; reel++) {
          const strip = strips[reel]!;
          const stopIdx = (pos[reel]! + row) % strip.length;
          gridRow.push(strip[stopIdx]!);
        }
        grid.push(gridRow);
      }

      // Compute grid hash: rows joined by '|', each row cells joined by ','.
      const gridHash = grid.map((row) => row.join(',')).join('|');

      // Evaluate payout (no behavior pipeline — analytical mode uses raw IR).
      const result = evaluateIR(ir, grid);
      const payout = result.totalPayout * result.spinMultiplier * result.lineMultiplier;

      // Store unique grids only (first occurrence wins; all are uniform).
      if (!entries.has(gridHash)) {
        entries.set(gridHash, {
          gridHash,
          grid,
          payout,
          probability: uniformProb,
        });
      }

      analyticalRtp += payout * uniformProb;
      if (payout > 0) winStates++;

      // Advance odometer (least-significant reel advances first).
      for (let r = numReels - 1; r >= 0; r--) {
        pos[r] = (pos[r]! + 1) % stripLens[r]!;
        if (pos[r] !== 0) break;
      }
    }

    const analyticalHitRate = winStates / totalStates;

    const table: AnalyticalTable = {
      gameId: ir.meta.id,
      totalStates,
      computedAt: Date.now(),
      analyticalRtp,
      analyticalHitRate,
      entries,
    };

    this.tables.set(ir.meta.id, table);
    return table;
  }

  /**
   * Query the memoized table for a specific grid configuration.
   *
   * Returns `undefined` if no table has been built for the given gameId, or
   * if the provided grid hash is not present in the table.
   */
  query(gameId: string, grid: string[][]): InstantSpinResult | undefined {
    const table = this.tables.get(gameId);
    if (!table) return undefined;

    const gridHash = grid.map((row) => row.join(',')).join('|');
    const entry = table.entries.get(gridHash);
    if (!entry) return undefined;

    return {
      payout: entry.payout,
      probability: entry.probability,
      fromCache: true,
    };
  }

  /** Return the exact analytical RTP for a previously built table. */
  getAnalyticalRtp(gameId: string): number | undefined {
    return this.tables.get(gameId)?.analyticalRtp;
  }

  /** Return all tables currently held in memory. */
  getTables(): ReadonlyMap<string, AnalyticalTable> {
    return this.tables;
  }

  /** Remove the table for `gameId`, freeing its memory. */
  clearTable(gameId: string): boolean {
    return this.tables.delete(gameId);
  }
}
