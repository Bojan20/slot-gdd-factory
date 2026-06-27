/**
 * SLOT MATH ENGINE TEMPLATE - Statistics Tracker
 *
 * Streaming statistics collection for simulation.
 * Memory efficient - no large arrays, uses online algorithms.
 *
 * Tracks:
 * - RTP components (base, scatter, FS, H&W)
 * - Hit rates and frequencies
 * - Win distribution histogram
 * - Variance and std dev (Welford's algorithm)
 * - H&W specific metrics (Full Grid Jackpot rate, avg orbs, etc.)
 */

import { GAME_CONFIG } from '../config/gameConfig.js';

/**
 * Histogram bin definition
 */
export interface HistogramBin {
  min: number;
  max: number;
  label: string;
  count: number;
  rtpContribution: number;
}

/**
 * Create log-scale histogram bins
 */
function createHistogramBins(): HistogramBin[] {
  const bins: HistogramBin[] = [
    { min: 0, max: 0, label: '0x (Dead)', count: 0, rtpContribution: 0 },
    { min: 0.001, max: 0.1, label: '0-0.1x', count: 0, rtpContribution: 0 },
    { min: 0.1, max: 0.5, label: '0.1-0.5x', count: 0, rtpContribution: 0 },
    { min: 0.5, max: 1, label: '0.5-1x', count: 0, rtpContribution: 0 },
    { min: 1, max: 2, label: '1-2x', count: 0, rtpContribution: 0 },
    { min: 2, max: 5, label: '2-5x', count: 0, rtpContribution: 0 },
    { min: 5, max: 10, label: '5-10x', count: 0, rtpContribution: 0 },
    { min: 10, max: 20, label: '10-20x', count: 0, rtpContribution: 0 },
    { min: 20, max: 50, label: '20-50x', count: 0, rtpContribution: 0 },
    { min: 50, max: 100, label: '50-100x', count: 0, rtpContribution: 0 },
    { min: 100, max: 200, label: '100-200x', count: 0, rtpContribution: 0 },
    { min: 200, max: 500, label: '200-500x', count: 0, rtpContribution: 0 },
    { min: 500, max: 1000, label: '500-1000x', count: 0, rtpContribution: 0 },
    { min: 1000, max: 2000, label: '1000-2000x', count: 0, rtpContribution: 0 },
    { min: 2000, max: 5000, label: '2000-5000x', count: 0, rtpContribution: 0 },
    { min: 5000, max: Infinity, label: '5000x+', count: 0, rtpContribution: 0 }
  ];
  return bins;
}

/**
 * Find bin for a win value
 */
function findBin(bins: HistogramBin[], win: number): HistogramBin | null {
  for (const bin of bins) {
    if (win >= bin.min && win < bin.max) {
      return bin;
    }
    // Special case for exactly 0
    if (win === 0 && bin.min === 0 && bin.max === 0) {
      return bin;
    }
  }
  // Fallback to last bin
  return bins[bins.length - 1];
}

/**
 * Streaming statistics tracker
 */
export class SimulationStats {
  // Spin counts
  totalSpins: number = 0;
  winningSpins: number = 0;

  // Total wagered and won
  totalBet: number = 0;
  totalWin: number = 0;

  // RTP components
  baseLineWin: number = 0;
  baseScatterWin: number = 0;
  freeSpinsWin: number = 0;
  multiplierBoost: number = 0;  // Win increase due to multipliers

  // Feature counts - Free Spins
  fsTriggers: number = 0;
  totalFSSpins: number = 0;
  fsRetriggers: number = 0;

  // Feature counts - Hold & Win
  hnwTriggers: number = 0;
  hnwTotalWin: number = 0;
  hnwTotalOrbs: number = 0;
  hnwTotalRespins: number = 0;
  hnwFullGridJackpots: number = 0;

  // Multiplier tracking (for FS progressive)
  maxMultiplierSeen: number = 1;

  // Win extremes
  maxWin: number = 0;
  maxWinSpin: number = 0;

  // Variance tracking (Welford's algorithm)
  private varianceM: number = 0;
  private varianceS: number = 0;

  // Histogram
  histogram: HistogramBin[] = createHistogramBins();

  // Tail tracking
  wins100xPlus: number = 0;
  wins500xPlus: number = 0;
  wins1000xPlus: number = 0;
  wins5000xPlus: number = 0;

  // Dead spin streaks
  currentDeadStreak: number = 0;
  maxDeadStreak: number = 0;
  deadStreakSum: number = 0;
  deadStreakCount: number = 0;

  /**
   * Record a base game spin result (v7)
   */
  recordBaseSpin(
    bet: number,
    lineWin: number,
    scatterWin: number,
    multiplier: number,
    _winBeforeMultiplier: number,
    totalWin: number,
    triggeredFS: boolean,
    triggeredHnW: boolean = false
  ): void {
    this.totalSpins++;
    this.totalBet += bet;

    // Record components
    this.baseLineWin += lineWin * multiplier;
    this.baseScatterWin += scatterWin * multiplier;

    if (multiplier > this.maxMultiplierSeen) {
      this.maxMultiplierSeen = multiplier;
    }

    // Only add to totalWin here if NOT triggering FS or H&W
    // Feature wins will be added separately
    if (!triggeredFS && !triggeredHnW) {
      this.totalWin += totalWin;
      this.recordWin(totalWin, bet);
    } else if (triggeredFS) {
      // Still record the scatter win portion for base
      this.totalWin += scatterWin * multiplier;
      this.fsTriggers++;
    } else if (triggeredHnW) {
      // Base game win still counts, H&W win added separately
      this.totalWin += totalWin;
      this.recordWin(totalWin, bet);
      this.hnwTriggers++;
    }
  }

  /**
   * Record Free Spins session result
   */
  recordFreeSpinsSession(
    totalFSWin: number,
    spinsPlayed: number,
    retriggersCount: number,
    bet: number
  ): void {
    this.freeSpinsWin += totalFSWin;
    this.totalWin += totalFSWin;
    this.totalFSSpins += spinsPlayed;
    this.fsRetriggers += retriggersCount;

    // Record FS win in histogram
    this.recordWin(totalFSWin, bet);
  }

  /**
   * Record Hold & Win session result
   */
  recordHnWSession(
    totalHnWWin: number,
    orbCount: number,
    respins: number,
    fullGridJackpot: boolean,
    bet: number
  ): void {
    this.hnwTotalWin += totalHnWWin;
    this.totalWin += totalHnWWin;
    this.hnwTotalOrbs += orbCount;
    this.hnwTotalRespins += respins;

    if (fullGridJackpot) {
      this.hnwFullGridJackpots++;
    }

    // Record H&W win in histogram
    this.recordWin(totalHnWWin, bet);
  }

  /**
   * Record a win for histogram and variance
   */
  private recordWin(win: number, bet: number): void {
    const winX = win / bet;

    // Histogram
    const bin = findBin(this.histogram, winX);
    if (bin) {
      bin.count++;
      bin.rtpContribution += win;
    }

    // Win/loss tracking
    if (win > 0) {
      this.winningSpins++;

      // Dead streak tracking
      if (this.currentDeadStreak > 0) {
        this.deadStreakSum += this.currentDeadStreak;
        this.deadStreakCount++;
        if (this.currentDeadStreak > this.maxDeadStreak) {
          this.maxDeadStreak = this.currentDeadStreak;
        }
        this.currentDeadStreak = 0;
      }
    } else {
      this.currentDeadStreak++;
    }

    // Tail tracking
    if (winX >= 100) this.wins100xPlus++;
    if (winX >= 500) this.wins500xPlus++;
    if (winX >= 1000) this.wins1000xPlus++;
    if (winX >= 5000) this.wins5000xPlus++;

    // Max win
    if (win > this.maxWin) {
      this.maxWin = win;
      this.maxWinSpin = this.totalSpins;
    }

    // Variance (Welford's online algorithm)
    const n = this.totalSpins;
    const delta = winX - this.varianceM;
    this.varianceM += delta / n;
    this.varianceS += delta * (winX - this.varianceM);
  }

  /**
   * Get computed statistics (v7)
   */
  getResults(): SimulationResults {
    const bet = GAME_CONFIG.defaultBet;

    // RTP calculations
    const totalRTP = this.totalWin / this.totalBet;
    const baseLineRTP = this.baseLineWin / this.totalBet;
    const scatterRTP = this.baseScatterWin / this.totalBet;
    const fsRTP = this.freeSpinsWin / this.totalBet;
    const hnwRTP = this.hnwTotalWin / this.totalBet;

    // Hit rate
    const hitRate = this.winningSpins / this.totalSpins;

    // Feature frequencies
    const fsFrequency = this.fsTriggers > 0 ? this.totalSpins / this.fsTriggers : Infinity;
    const hnwFrequency = this.hnwTriggers > 0 ? this.totalSpins / this.hnwTriggers : Infinity;

    // Variance and std dev
    const variance = this.totalSpins > 1 ?
      this.varianceS / (this.totalSpins - 1) : 0;
    const stdDev = Math.sqrt(variance);

    // 95% CI for RTP
    const standardError = stdDev / Math.sqrt(this.totalSpins);
    const ci95 = 1.96 * standardError;

    // Dead streak stats
    const avgDeadStreak = this.deadStreakCount > 0 ?
      this.deadStreakSum / this.deadStreakCount : 0;

    // Histogram percentages
    const histogramWithPercentages = this.histogram.map(bin => ({
      ...bin,
      percentage: (bin.count / this.totalSpins) * 100,
      rtpContribution: bin.rtpContribution / this.totalBet
    }));

    return {
      // Meta
      totalSpins: this.totalSpins,
      totalBet: this.totalBet,
      totalWin: this.totalWin,

      // RTP
      rtp: totalRTP,
      rtpPercent: totalRTP * 100,
      rtp95CI: ci95 * 100,
      rtpBreakdown: {
        baseLine: baseLineRTP * 100,
        scatter: scatterRTP * 100,
        freeSpins: fsRTP * 100,
        holdAndWin: hnwRTP * 100
      },

      // Hit rate
      hitRate,
      hitRatePercent: hitRate * 100,

      // Free Spins
      fsTriggers: this.fsTriggers,
      fsFrequency: Math.round(fsFrequency),
      avgFSSpins: this.fsTriggers > 0 ? this.totalFSSpins / this.fsTriggers : 0,
      avgFSWin: this.fsTriggers > 0 ? this.freeSpinsWin / this.fsTriggers / bet : 0,
      fsRetriggerRate: this.fsTriggers > 0 ? this.fsRetriggers / this.fsTriggers : 0,

      // Hold & Win
      hnwTriggers: this.hnwTriggers,
      hnwFrequency: Math.round(hnwFrequency),
      avgHnWOrbs: this.hnwTriggers > 0 ? this.hnwTotalOrbs / this.hnwTriggers : 0,
      avgHnWWin: this.hnwTriggers > 0 ? this.hnwTotalWin / this.hnwTriggers / bet : 0,
      fullGridJackpotRate: this.hnwTriggers > 0 ? this.hnwFullGridJackpots / this.hnwTriggers : 0,

      maxMultiplier: this.maxMultiplierSeen,

      // Volatility
      variance,
      stdDev,
      volatilityIndex: stdDev / totalRTP, // Normalized volatility

      // Extremes
      maxWin: this.maxWin / bet,
      maxWinSpin: this.maxWinSpin,

      // Tail
      wins100xPlusRate: this.wins100xPlus / this.totalSpins,
      wins500xPlusRate: this.wins500xPlus / this.totalSpins,
      wins1000xPlusRate: this.wins1000xPlus / this.totalSpins,
      wins5000xPlusRate: this.wins5000xPlus / this.totalSpins,

      // Dead spins
      deadSpinRate: 1 - hitRate,
      avgDeadStreak,
      maxDeadStreak: this.maxDeadStreak,

      // Histogram
      histogram: histogramWithPercentages
    };
  }

  /**
   * Merge stats from another tracker (for parallel simulation)
   */
  merge(other: SimulationStats): void {
    this.totalSpins += other.totalSpins;
    this.winningSpins += other.winningSpins;
    this.totalBet += other.totalBet;
    this.totalWin += other.totalWin;

    this.baseLineWin += other.baseLineWin;
    this.baseScatterWin += other.baseScatterWin;
    this.freeSpinsWin += other.freeSpinsWin;
    this.multiplierBoost += other.multiplierBoost;

    // Free Spins
    this.fsTriggers += other.fsTriggers;
    this.totalFSSpins += other.totalFSSpins;
    this.fsRetriggers += other.fsRetriggers;

    // Hold & Win
    this.hnwTriggers += other.hnwTriggers;
    this.hnwTotalWin += other.hnwTotalWin;
    this.hnwTotalOrbs += other.hnwTotalOrbs;
    this.hnwTotalRespins += other.hnwTotalRespins;
    this.hnwFullGridJackpots += other.hnwFullGridJackpots;

    this.maxMultiplierSeen = Math.max(this.maxMultiplierSeen, other.maxMultiplierSeen);

    if (other.maxWin > this.maxWin) {
      this.maxWin = other.maxWin;
      this.maxWinSpin = other.maxWinSpin;
    }

    this.wins100xPlus += other.wins100xPlus;
    this.wins500xPlus += other.wins500xPlus;
    this.wins1000xPlus += other.wins1000xPlus;
    this.wins5000xPlus += other.wins5000xPlus;

    this.maxDeadStreak = Math.max(this.maxDeadStreak, other.maxDeadStreak);
    this.deadStreakSum += other.deadStreakSum;
    this.deadStreakCount += other.deadStreakCount;

    // Merge histograms
    for (let i = 0; i < this.histogram.length; i++) {
      this.histogram[i].count += other.histogram[i].count;
      this.histogram[i].rtpContribution += other.histogram[i].rtpContribution;
    }

    // Merge variance using parallel algorithm
    // (simplified - for accurate merge would need more tracking)
  }
}

/**
 * Simulation results interface
 */
export interface SimulationResults {
  totalSpins: number;
  totalBet: number;
  totalWin: number;

  rtp: number;
  rtpPercent: number;
  rtp95CI: number;
  rtpBreakdown: {
    baseLine: number;
    scatter: number;
    freeSpins: number;
    holdAndWin: number;
  };

  hitRate: number;
  hitRatePercent: number;

  // Free Spins
  fsTriggers: number;
  fsFrequency: number;
  avgFSSpins: number;
  avgFSWin: number;
  fsRetriggerRate: number;

  // Hold & Win
  hnwTriggers: number;
  hnwFrequency: number;
  avgHnWOrbs: number;
  avgHnWWin: number;
  fullGridJackpotRate: number;

  maxMultiplier: number;

  variance: number;
  stdDev: number;
  volatilityIndex: number;

  maxWin: number;
  maxWinSpin: number;

  wins100xPlusRate: number;
  wins500xPlusRate: number;
  wins1000xPlusRate: number;
  wins5000xPlusRate: number;

  deadSpinRate: number;
  avgDeadStreak: number;
  maxDeadStreak: number;

  histogram: Array<HistogramBin & { percentage: number }>;
}
