/**
 * W152 P0-6 — Jurisdictional reporting adapter registry.
 *
 * Single import surface for consumers:
 *
 * ```ts
 * import { adapterFor, REPORT_ADAPTERS } from './report/adapters/index.js';
 *
 * const adapter = adapterFor('ADM');
 * const wire = adapter.emit(report);
 * fs.writeFileSync('upload.txt', wire, { encoding: 'utf-8' });
 * ```
 *
 * The registry is keyed by jurisdiction code (uppercase). When a market
 * is added, register the adapter here and add a row to the test matrix.
 */

import { ReportAdapter, JurisdictionalReport } from './types.js';
import { PGADAdapter } from './pgadAdapter.js';
import { DKXmlAdapter } from './dkXmlAdapter.js';
import { MGAJsonAdapter } from './mgaJsonAdapter.js';
import { NJCsvAdapter } from './njCsvAdapter.js';

// Re-export types for downstream consumers.
export type { JurisdictionalReport, ReportAdapter };
export {
  computeRtp,
  rtpToPercentString,
  mcToCurrencyString,
  isoToPgadDate,
  xmlEscape,
  csvQuote,
} from './types.js';
export { PGADAdapter, PGAD_RECORD_WIDTH } from './pgadAdapter.js';
export { DKXmlAdapter } from './dkXmlAdapter.js';
export { MGAJsonAdapter } from './mgaJsonAdapter.js';
export { NJCsvAdapter } from './njCsvAdapter.js';

/**
 * Registry keyed by **jurisdiction code** (uppercase). Aliases supported
 * via the lookup function — e.g. `'IT'` and `'ITALY'` both resolve to
 * `PGADAdapter` because the operator may use either in their config.
 */
export const REPORT_ADAPTERS: Readonly<Record<string, ReportAdapter>> = Object.freeze({
  ADM: PGADAdapter,
  IT: PGADAdapter,
  ITALY: PGADAdapter,

  SP: DKXmlAdapter,
  DK: DKXmlAdapter,
  DENMARK: DKXmlAdapter,

  MGA: MGAJsonAdapter,
  MT: MGAJsonAdapter,
  MALTA: MGAJsonAdapter,

  DGE: NJCsvAdapter,
  NJ: NJCsvAdapter,
  'NJ-DGE': NJCsvAdapter,
});

/**
 * Resolve an adapter by jurisdiction code (case-insensitive).
 * Throws if the jurisdiction has no registered adapter.
 */
export function adapterFor(jurisdiction: string): ReportAdapter {
  const key = jurisdiction.trim().toUpperCase();
  const found = REPORT_ADAPTERS[key];
  if (!found) {
    const supported = Array.from(new Set(Object.values(REPORT_ADAPTERS).map((a) => a.name)))
      .sort()
      .join(', ');
    throw new Error(
      `No reporting adapter for jurisdiction '${jurisdiction}'. Supported adapters: ${supported}.`,
    );
  }
  return found;
}

/**
 * One-shot helper: build the wire bytes for the report's jurisdiction
 * field. Throws on unknown jurisdiction.
 */
export function emitForJurisdiction(report: JurisdictionalReport): string {
  return adapterFor(report.jurisdiction).emit(report);
}
