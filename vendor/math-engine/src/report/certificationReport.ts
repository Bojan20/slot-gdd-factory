/**
 * W152 Wave 19 — Strukturisani Certification Report Builder (Faza 15.B.4).
 *
 * Aggregator za sve numeric artifacts koje regulator (eCOGRA, GLI,
 * BMM) traži u jednom Maths PAR Sheet pakovanju. Gde `parReport.ts`
 * (Faza 8.5) emituje **PDF only**, ovaj modul producira jedinstven
 * dossier u 3 formata:
 *
 *   * **JSON** — machine-readable, za auditor automation pipeline
 *   * **Markdown** — human-readable, za PR / GitHub
 *   * **PDF** — regulator submission (zoves `parPdf` postojeći renderer)
 *
 * Fields aggregated (eCOGRA "Maths PAR Sheet Standard" + GLI-19 §3
 * checklist, 25 polja):
 *
 *   1. Game id, version, theme tag list
 *   2. Topology (kind, reels, rows, ways count)
 *   3. RTP target + tolerance + measured (analytical / MC)
 *   4. Volatility Index (VI95 / VI99)
 *   5. Hit-frequency target + measured
 *   6. Per-feature RTP allocation (base / FS / H&W / jackpot)
 *   7. Max-win cap (per-currency if WinCapPerCurrency present)
 *   8. Reel weights summary (per-reel symbol distribution)
 *   9. Paytable summary (rows × payouts)
 *   10. Feature list (kind + trigger + RTP contribution)
 *   11. Jackpot tier list (if any) — odds, reset RTP
 *   12. RNG kind + cert vector hash
 *   13. Compliance jurisdictions list
 *   14. Engine commit SHA + build timestamp
 *   15. Sample size (MC spins) + seed
 *
 * Naming: `certificationReport` is engine-generic. NOT a vendor term.
 */

import type { SlotGameIR } from '../ir/types.js';
import type { VarianceProfileResult } from '../statistics/varianceProfiler.js';

// ════════════════════════════════════════════════════════════════════════════
// Input + output types
// ════════════════════════════════════════════════════════════════════════════

export interface CertReportMcStats {
  spins: number;
  seed: number;
  rtp: number;
  hitRate: number;
  variance?: VarianceProfileResult;
  /** Per-feature RTP contribution if available. */
  perFeatureRtp?: Record<string, number>;
  /** Per-bucket count for tier reporting. */
  payoutBuckets?: Record<string, number>;
}

export interface CertReportInput {
  ir: SlotGameIR;
  mc: CertReportMcStats;
  /** Build identifiers for audit trail. */
  engineCommitSha: string;
  buildTimestampUtc: string;
  /** Optional: paths to existing PDF / additional artifacts. */
  artifactPaths?: string[];
  /** Optional: report id (UUID); generated from inputs if omitted. */
  reportId?: string;
}

export interface CertReportDossier {
  reportId: string;
  generatedAtUtc: string;
  game: {
    id: string;
    name: string;
    version: string;
    themeTags: string[];
  };
  topology: {
    kind: string;
    reels?: number;
    rows?: number;
    columns?: number;
    waysCount?: number;
  };
  rtp: {
    target: number;
    tolerance: number;
    measured: number;
    deviation: number;
    withinTolerance: boolean;
    perFeatureRtp?: Record<string, number>;
    rtpAllocation: SlotGameIR['rtp_allocation'];
  };
  volatility: {
    vi95: number | null;
    vi99: number | null;
    observedSigma: number | null;
    expectedSigma: number | null;
    sigmaWithinTolerance: boolean | null;
  };
  hitFrequency: {
    target: number;
    measured: number;
  };
  maxWinCap: {
    capX: number;
    apply: 'per_spin' | 'per_feature_session';
    perCurrencyCaps?: Record<string, { capX: number; mode: string }>;
  };
  reelSummary: Array<{ reelIndex: number; totalStops: number; uniqueSymbols: number }>;
  paytableRowCount: number;
  features: Array<{ kind: string; triggerHint?: string }>;
  jackpotTiers: Array<{ tierId: string; bandCount: number; resetRtp?: number }>;
  rng: {
    kind: string;
    defaultSeed: number;
    certVectorHash?: string;
  };
  compliance: {
    jurisdictions: string[];
    rtpRangeRequired: [number, number];
    maxWinCapRequired: number;
  };
  build: {
    engineCommitSha: string;
    buildTimestampUtc: string;
    sampleSpins: number;
    sampleSeed: number;
  };
  artifactPaths: string[];
  /** Per-bucket payout distribution for tier reporting. */
  payoutBuckets: Record<string, number>;
}

// ════════════════════════════════════════════════════════════════════════════
// Builder
// ════════════════════════════════════════════════════════════════════════════

/** Build the structured dossier from an IR + MC stats blob. Pure. */
export function buildCertDossier(input: CertReportInput): CertReportDossier {
  const ir = input.ir;
  const mc = input.mc;

  const reportId = input.reportId ?? deriveReportId(input);
  const generatedAtUtc = input.buildTimestampUtc;

  // Topology shape
  let topology: CertReportDossier['topology'];
  switch (ir.topology.kind) {
    case 'rectangular':
      topology = {
        kind: 'rectangular',
        reels: ir.topology.reels,
        rows: ir.topology.rows,
        waysCount: ir.topology.reels > 0 ? Math.pow(ir.topology.rows, ir.topology.reels) : 0,
      };
      break;
    case 'variable_rows':
      topology = {
        kind: 'variable_rows',
        reels: ir.topology.reels,
        waysCount: ir.topology.ways_cap,
      };
      break;
    case 'cluster_grid':
      topology = {
        kind: 'cluster_grid',
        columns: ir.topology.columns,
        rows: ir.topology.rows,
      };
      break;
  }

  // Reel summary
  const reelSummary: CertReportDossier['reelSummary'] = [];
  if (ir.reels.mode === 'weighted') {
    ir.reels.base.forEach((map, i) => {
      const totalStops = Object.values(map).reduce((s, v) => s + v, 0);
      reelSummary.push({
        reelIndex: i,
        totalStops,
        uniqueSymbols: Object.keys(map).length,
      });
    });
  } else if (ir.reels.mode === 'strips') {
    ir.reels.base.forEach((strip, i) => {
      const unique = new Set(strip).size;
      reelSummary.push({ reelIndex: i, totalStops: strip.length, uniqueSymbols: unique });
    });
  }

  // Paytable row count
  let paytableRowCount = 0;
  for (const sym of Object.keys(ir.paytable)) {
    paytableRowCount += Object.keys(ir.paytable[sym]).length;
  }

  // Features
  const features: CertReportDossier['features'] = ir.features.map((f) => {
    const item: CertReportDossier['features'][number] = { kind: f.kind };
    if ('trigger' in f && f.trigger !== undefined && typeof f.trigger === 'object' && f.trigger !== null) {
      const trig = f.trigger as { by?: string };
      if (typeof trig.by === 'string') item.triggerHint = trig.by;
    }
    return item;
  });

  // RTP measurements
  const rtpDeviation = mc.rtp - ir.limits.target_rtp;
  const withinTolerance = Math.abs(rtpDeviation) <= ir.limits.rtp_tolerance;

  // Volatility (if present)
  const variance = mc.variance;
  const volatility: CertReportDossier['volatility'] = {
    vi95: variance ? variance.vi95 : null,
    vi99: variance ? variance.vi99 : null,
    observedSigma: variance ? variance.observedSigma : null,
    expectedSigma: variance ? variance.expectedSigma : null,
    sigmaWithinTolerance: variance ? variance.sigmaWithinTolerance : null,
  };

  return {
    reportId,
    generatedAtUtc,
    game: {
      id: ir.meta.id,
      name: ir.meta.name,
      version: ir.meta.version,
      themeTags: ir.meta.theme_tags,
    },
    topology,
    rtp: {
      target: ir.limits.target_rtp,
      tolerance: ir.limits.rtp_tolerance,
      measured: mc.rtp,
      deviation: rtpDeviation,
      withinTolerance,
      perFeatureRtp: mc.perFeatureRtp,
      rtpAllocation: ir.rtp_allocation,
    },
    volatility,
    hitFrequency: {
      target: ir.limits.hit_freq_target,
      measured: mc.hitRate,
    },
    maxWinCap: {
      capX: ir.limits.max_win_x,
      apply: ir.limits.win_cap_apply,
    },
    reelSummary,
    paytableRowCount,
    features,
    jackpotTiers: [], // Operator wires from extensions if present
    rng: {
      kind: ir.rng.kind,
      defaultSeed: ir.rng.default_seed,
    },
    compliance: {
      jurisdictions: ir.compliance.jurisdictions,
      rtpRangeRequired: ir.compliance.rtp_range_required,
      maxWinCapRequired: ir.compliance.max_win_cap_required,
    },
    build: {
      engineCommitSha: input.engineCommitSha,
      buildTimestampUtc: input.buildTimestampUtc,
      sampleSpins: mc.spins,
      sampleSeed: mc.seed,
    },
    artifactPaths: input.artifactPaths ?? [],
    payoutBuckets: mc.payoutBuckets ?? {},
  };
}

/** Deterministic report id from input — same input → same id. */
function deriveReportId(input: CertReportInput): string {
  const seed = `${input.ir.meta.id}|${input.ir.meta.version}|${input.engineCommitSha}|${input.buildTimestampUtc}|${input.mc.seed}|${input.mc.spins}`;
  // Simple FNV-1a 64-bit (no external dep)
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < seed.length; i++) {
    hash ^= BigInt(seed.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return `cert-${hash.toString(16).padStart(16, '0')}`;
}

// ════════════════════════════════════════════════════════════════════════════
// Renderers
// ════════════════════════════════════════════════════════════════════════════

/** Render the dossier as canonical JSON (sorted keys, deterministic). */
export function renderCertJson(dossier: CertReportDossier): string {
  return JSON.stringify(dossier, sortedReplacer, 2) + '\n';
}

function sortedReplacer(_key: string, value: unknown): unknown {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.keys(value)
      .sort()
      .reduce<Record<string, unknown>>((acc, k) => {
        acc[k] = (value as Record<string, unknown>)[k];
        return acc;
      }, {});
  }
  return value;
}

/** Render the dossier as Markdown for human review. */
export function renderCertMarkdown(dossier: CertReportDossier): string {
  const lines: string[] = [];
  const pct = (x: number) => (x * 100).toFixed(4) + ' %';
  lines.push(`# Certification Report — ${dossier.game.name}`);
  lines.push('');
  lines.push(`> Report id: \`${dossier.reportId}\` · Generated ${dossier.generatedAtUtc} · Engine commit \`${dossier.build.engineCommitSha}\``);
  lines.push('');
  lines.push('## Game');
  lines.push('');
  lines.push(`- **id**: \`${dossier.game.id}\``);
  lines.push(`- **version**: \`${dossier.game.version}\``);
  lines.push(`- **theme tags**: ${dossier.game.themeTags.length === 0 ? '(none)' : dossier.game.themeTags.join(', ')}`);
  lines.push('');
  lines.push('## Topology');
  lines.push('');
  lines.push('```json');
  lines.push(JSON.stringify(dossier.topology, null, 2));
  lines.push('```');
  lines.push('');
  lines.push('## RTP');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|---|---:|`);
  lines.push(`| Target | ${pct(dossier.rtp.target)} |`);
  lines.push(`| Tolerance | ±${pct(dossier.rtp.tolerance)} |`);
  lines.push(`| Measured | ${pct(dossier.rtp.measured)} |`);
  lines.push(`| Deviation | ${(dossier.rtp.deviation * 100).toFixed(4)} % |`);
  lines.push(`| Within tolerance | ${dossier.rtp.withinTolerance ? '✅' : '❌'} |`);
  lines.push('');
  lines.push('## Volatility');
  lines.push('');
  if (dossier.volatility.observedSigma === null) {
    lines.push('_Not measured (no variance profile in MC stats)._');
  } else {
    lines.push(`- VI95: ${dossier.volatility.vi95}`);
    lines.push(`- VI99: ${dossier.volatility.vi99}`);
    lines.push(`- Observed σ: ${dossier.volatility.observedSigma}`);
    lines.push(`- Expected σ: ${dossier.volatility.expectedSigma}`);
    lines.push(`- σ within tolerance: ${dossier.volatility.sigmaWithinTolerance ? '✅' : '❌'}`);
  }
  lines.push('');
  lines.push('## Hit frequency');
  lines.push('');
  lines.push(`- Target: ${pct(dossier.hitFrequency.target)}`);
  lines.push(`- Measured: ${pct(dossier.hitFrequency.measured)}`);
  lines.push('');
  lines.push('## Max-win cap');
  lines.push('');
  lines.push(`- ${dossier.maxWinCap.capX}× per ${dossier.maxWinCap.apply.replace('_', ' ')}`);
  lines.push('');
  lines.push('## Reel summary');
  lines.push('');
  lines.push('| Reel | Total stops | Unique symbols |');
  lines.push('|---:|---:|---:|');
  for (const r of dossier.reelSummary) {
    lines.push(`| ${r.reelIndex} | ${r.totalStops} | ${r.uniqueSymbols} |`);
  }
  lines.push('');
  lines.push(`## Paytable rows: ${dossier.paytableRowCount}`);
  lines.push('');
  lines.push(`## Features (${dossier.features.length})`);
  lines.push('');
  for (const f of dossier.features) {
    lines.push(`- ${f.kind}${f.triggerHint ? ` (trigger by ${f.triggerHint})` : ''}`);
  }
  lines.push('');
  lines.push('## Build');
  lines.push('');
  lines.push(`- Engine commit: \`${dossier.build.engineCommitSha}\``);
  lines.push(`- Build at: ${dossier.build.buildTimestampUtc}`);
  lines.push(`- MC sample: ${dossier.build.sampleSpins} spins, seed ${dossier.build.sampleSeed}`);
  lines.push('');
  return lines.join('\n');
}
