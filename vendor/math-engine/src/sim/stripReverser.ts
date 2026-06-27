/**
 * W152 Wave 18 — Strip Reverse-Engineering Helper (Faza 15.A.13).
 *
 * Diagnostic tool. Given:
 *   * A list of OBSERVED stop indices (stops that landed on a reel
 *     during real spins),
 *   * A set of CANDIDATE strips (different lengths possible),
 *
 * the tool ranks each candidate by likelihood that those observed stops
 * came from THAT strip, exposing the most-likely match as a debug aid.
 *
 * Use case: a tester reports "spin reproduces wrong outcome" — engineer
 * has 5 candidate strip configurations and 100 observed (seed, stop)
 * pairs. This tool tells you "candidate B is the best match (97 / 100
 * stops valid + maximum-likelihood symbol distribution)" so the engineer
 * can pin the bug to the strip-load layer.
 *
 * The tool is intentionally heuristic — it does NOT guarantee uniqueness
 * (two strips of the same length with overlapping symbol distributions
 * can be equally likely). It returns ranked scores + a diagnostic
 * breakdown so the engineer can adjudicate ambiguous cases by eye.
 *
 * Acceptance: on a synthetic fixture with 5 candidates the correct
 * strip is top-1 in ≥ 95 % of 100 random seeds.
 */

export type Symbol = string;
export type ReelStrip = ReadonlyArray<Symbol>;

export interface ReverseEngineerInput {
  /** Indices observed during real spins. */
  observedStops: number[];
  /** Symbols observed at those stops (1:1 with observedStops). */
  observedSymbols: Symbol[];
  /** Named candidate strips to rank. */
  candidates: Record<string, ReelStrip>;
}

export interface CandidateScore {
  candidateName: string;
  stripLength: number;
  /** Number of observed stops that produced the expected symbol. */
  matches: number;
  /** Total observations evaluated. */
  total: number;
  /** Match ratio in [0, 1]. */
  matchRatio: number;
  /**
   * Log-likelihood under a uniform-stop assumption:
   * `Σ log(1 / stripLength)` — independent of matches; useful for
   * comparing strips of different lengths only when matchRatio is tied.
   */
  logLikelihoodUniform: number;
}

export interface ReverseEngineerReport {
  ranked: CandidateScore[];
  /** Top candidate (if non-empty). */
  topMatch: CandidateScore | null;
  /** Set to `true` if the top score is strictly > the runner-up. */
  unambiguous: boolean;
}

/**
 * Rank candidate strips against observed stop/symbol data. Returns a
 * report with all candidates scored + the top match called out.
 *
 * Throws on:
 *   * mismatched `observedStops.length` vs `observedSymbols.length`
 *   * empty `candidates` map
 */
export function reverseEngineerStrip(input: ReverseEngineerInput): ReverseEngineerReport {
  if (input.observedStops.length !== input.observedSymbols.length) {
    throw new Error(
      `reverseEngineerStrip: observedStops.length (${input.observedStops.length}) != observedSymbols.length (${input.observedSymbols.length})`,
    );
  }
  const candidateNames = Object.keys(input.candidates);
  if (candidateNames.length === 0) {
    throw new Error('reverseEngineerStrip: candidates is empty');
  }
  const ranked: CandidateScore[] = [];
  for (const name of candidateNames) {
    const strip = input.candidates[name];
    if (strip.length === 0) {
      throw new Error(`reverseEngineerStrip: candidate '${name}' has empty strip`);
    }
    let matches = 0;
    let evaluated = 0;
    for (let i = 0; i < input.observedStops.length; i++) {
      const stop = input.observedStops[i];
      if (!Number.isInteger(stop) || stop < 0) continue; // skip noise
      evaluated += 1;
      const wrapped = stop % strip.length;
      if (strip[wrapped] === input.observedSymbols[i]) {
        matches += 1;
      }
    }
    const matchRatio = evaluated === 0 ? 0 : matches / evaluated;
    const logLikelihoodUniform = evaluated * Math.log(1 / strip.length);
    ranked.push({
      candidateName: name,
      stripLength: strip.length,
      matches,
      total: evaluated,
      matchRatio,
      logLikelihoodUniform,
    });
  }
  // Sort descending by matchRatio (primary), then by logLikelihood
  // (secondary — break ties in favour of the strip whose uniform-stop
  // probability best explains the observed counts).
  ranked.sort((a, b) => {
    if (b.matchRatio !== a.matchRatio) return b.matchRatio - a.matchRatio;
    return b.logLikelihoodUniform - a.logLikelihoodUniform;
  });
  const topMatch = ranked.length > 0 ? ranked[0] : null;
  const unambiguous =
    ranked.length === 1 ||
    (ranked.length >= 2 && ranked[0].matchRatio > ranked[1].matchRatio);
  return { ranked, topMatch, unambiguous };
}

/**
 * Convenience: render the report as a human-readable text block for
 * the CLI `slot-sim debug rev-strip --observed-stops ...` command.
 */
export function renderReport(report: ReverseEngineerReport): string {
  const lines: string[] = [];
  lines.push('=== Strip Reverse-Engineering Report ===');
  if (report.topMatch === null) {
    lines.push('(no candidates scored)');
    return lines.join('\n');
  }
  lines.push(
    `Top match: ${report.topMatch.candidateName} (length ${report.topMatch.stripLength}, ${report.topMatch.matches}/${report.topMatch.total} = ${(report.topMatch.matchRatio * 100).toFixed(1)} %)`,
  );
  lines.push(`Unambiguous: ${report.unambiguous ? 'YES' : 'NO — see runner-ups'}`);
  lines.push('');
  lines.push('Full ranking (descending matchRatio, then logLikelihood):');
  for (const r of report.ranked) {
    lines.push(
      `  ${r.candidateName.padEnd(20)} length=${String(r.stripLength).padStart(4)}  matches=${String(r.matches).padStart(4)}/${String(r.total).padStart(4)}  ratio=${(r.matchRatio * 100).toFixed(1).padStart(5)} %  logL=${r.logLikelihoodUniform.toFixed(2)}`,
    );
  }
  return lines.join('\n');
}
