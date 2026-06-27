/**
 * SLOT MATH EXACT - Top-N Wins
 *
 * Bounded heap of the largest N wins seen so far, each with its seed and
 * spin index for deterministic replay.
 */

// ============================================================================
// TYPES
// ============================================================================

export interface WinRecord {
  winX:      number;
  seed:      number;
  spinIndex: number;
}

// ============================================================================
// TOP-N WINS CLASS
// ============================================================================

export class TopNWins {
  private readonly _capacity: number;
  /** Maintained sorted ascending: index 0 is the smallest win. */
  private _arr: WinRecord[] = [];

  constructor(capacity: number = 25) {
    this._capacity = capacity;
  }

  /**
   * Try to record a win.  Ignored if winX <= 0.
   * Replaces the current minimum when the buffer is full and winX is larger.
   */
  tryRecord(winX: number, seed: number, spinIndex: number): void {
    if (winX <= 0) return;

    if (this._arr.length < this._capacity) {
      this._arr.push({ winX, seed, spinIndex });
      this._sortAscending();
      return;
    }

    // Buffer full — only replace if new win beats the current minimum
    if (winX > this._arr[0].winX) {
      this._arr[0] = { winX, seed, spinIndex };
      this._sortAscending();
    }
  }

  /** Returns a deep copy sorted descending by winX. */
  snapshot(): WinRecord[] {
    return this._arr
      .map(r => ({ ...r }))
      .sort((a, b) => b.winX - a.winX);
  }

  get size(): number {
    return this._arr.length;
  }

  /** Absorb all records from another TopNWins, keeping the overall top-N. */
  mergeFrom(other: TopNWins): void {
    for (const r of other._arr) {
      this.tryRecord(r.winX, r.seed, r.spinIndex);
    }
  }

  reset(): void {
    this._arr = [];
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private _sortAscending(): void {
    this._arr.sort((a, b) => a.winX - b.winX);
  }
}
