/**
 * SLOT MATH EXACT - Jurisdiction-Specific Validators
 *
 * Validates game configurations against jurisdiction-specific requirements.
 *
 * Supported jurisdictions:
 * - GLI-11 (Gaming Labs International)
 * - UKGC (UK Gambling Commission)
 * - MGA (Malta Gaming Authority)
 * - AGCO (Ontario)
 * - Kahnawake
 * - Curacao
 * - Isle of Man
 * - Gibraltar
 * - New Jersey DGE
 * - Nevada Gaming
 */

import {
  Decimal,
  dec,
  ZERO,
  ONE,
  safeDivide
} from '../core/decimal.js';
import type { GameConfig, RTPResult } from '../types/config.js';

// ============================================================================
// TYPES
// ============================================================================

/**
 * Supported jurisdictions
 */
export type Jurisdiction =
  | 'GLI_11'
  | 'UKGC'
  | 'MGA'
  | 'AGCO'
  | 'KAHNAWAKE'
  | 'CURACAO'
  | 'ISLE_OF_MAN'
  | 'GIBRALTAR'
  | 'NEW_JERSEY'
  | 'NEVADA'
  | 'SWEDEN'
  | 'DENMARK'
  | 'ITALY'
  | 'SPAIN'
  | 'PORTUGAL';

/**
 * Jurisdiction requirements
 */
export interface JurisdictionRequirements {
  /** Jurisdiction code */
  jurisdiction: Jurisdiction;
  /** Display name */
  displayName: string;
  /** Minimum RTP allowed */
  minRTP: number;
  /** Maximum RTP allowed (optional) */
  maxRTP?: number;
  /** Maximum win cap (bet multiplier) */
  maxWinCap?: number;
  /** Minimum hit rate required */
  minHitRate?: number;
  /** Maximum spin duration (ms) */
  maxSpinDurationMs?: number;
  /** Autoplay restrictions */
  autoplayRestrictions?: {
    /** Max autoplay spins allowed */
    maxSpins?: number;
    /** Loss limit required */
    lossLimitRequired?: boolean;
    /** Win limit required */
    winLimitRequired?: boolean;
    /** Session time limit required */
    timeLimitRequired?: boolean;
  };
  /** Feature buy restrictions */
  featureBuyRestrictions?: {
    /** Feature buy allowed */
    allowed: boolean;
    /** Max cost multiplier */
    maxCost?: number;
    /** Must display odds */
    displayOddsRequired?: boolean;
  };
  /** Progressive requirements */
  progressiveRequirements?: {
    /** Must display current value */
    displayValueRequired: boolean;
    /** Must show hit frequency */
    showHitFrequency: boolean;
    /** Maximum reserve rate */
    maxReserveRate?: number;
  };
  /** Reality check requirements */
  realityCheckRequired?: boolean;
  /** Reality check interval (minutes) */
  realityCheckIntervalMinutes?: number;
  /** Game rules display required */
  rulesDisplayRequired: boolean;
  /** RNG certification required */
  rngCertificationRequired: boolean;
  /** RTP display required */
  rtpDisplayRequired: boolean;
  /** Additional requirements */
  additionalRequirements?: string[];
}

/**
 * Validation check result
 */
export interface JurisdictionCheck {
  /** Check name */
  name: string;
  /** Passed/failed */
  passed: boolean;
  /** Requirement */
  requirement: string;
  /** Actual value */
  actual: string;
  /** Severity */
  severity: 'ERROR' | 'WARNING' | 'INFO';
  /** Recommendation if failed */
  recommendation?: string;
}

/**
 * Jurisdiction validation result
 */
export interface JurisdictionValidationResult {
  /** Jurisdiction validated against */
  jurisdiction: Jurisdiction;
  /** Display name */
  jurisdictionName: string;
  /** Overall pass/fail */
  passed: boolean;
  /** Individual checks */
  checks: JurisdictionCheck[];
  /** Error count */
  errorCount: number;
  /** Warning count */
  warningCount: number;
  /** Compliance score (0-100) */
  complianceScore: number;
  /** Summary */
  summary: string;
  /** Required documentation */
  requiredDocumentation: string[];
}

/**
 * Multi-jurisdiction validation result
 */
export interface MultiJurisdictionResult {
  /** Game name */
  gameName: string;
  /** Game version */
  gameVersion: string;
  /** Jurisdictions that passed */
  passedJurisdictions: Jurisdiction[];
  /** Jurisdictions that failed */
  failedJurisdictions: Jurisdiction[];
  /** Per-jurisdiction results */
  results: Map<Jurisdiction, JurisdictionValidationResult>;
  /** Common issues across jurisdictions */
  commonIssues: string[];
  /** Recommendations */
  recommendations: string[];
}

// ============================================================================
// JURISDICTION REQUIREMENTS DATABASE
// ============================================================================

/**
 * Get requirements for a jurisdiction
 */
export function getJurisdictionRequirements(jurisdiction: Jurisdiction): JurisdictionRequirements {
  const requirements: Record<Jurisdiction, JurisdictionRequirements> = {
    GLI_11: {
      jurisdiction: 'GLI_11',
      displayName: 'GLI-11 (Gaming Labs International)',
      minRTP: 0.75,
      maxRTP: 1.00,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      progressiveRequirements: {
        displayValueRequired: true,
        showHitFrequency: false,
        maxReserveRate: 0.10
      },
      additionalRequirements: [
        'Game rules must be available in player language',
        'Paytable must be accessible during play',
        'RNG must meet FIPS 140-2 or equivalent'
      ]
    },

    UKGC: {
      jurisdiction: 'UKGC',
      displayName: 'UK Gambling Commission',
      minRTP: 0.70,
      maxRTP: undefined, // No upper limit
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      realityCheckIntervalMinutes: 60,
      autoplayRestrictions: {
        maxSpins: undefined, // Must have limits
        lossLimitRequired: true,
        winLimitRequired: true,
        timeLimitRequired: true
      },
      featureBuyRestrictions: {
        allowed: true,
        displayOddsRequired: true
      },
      additionalRequirements: [
        'Must display time played',
        'Must display net win/loss',
        'Reverse withdrawals prohibited',
        'Game history accessible for 6 months',
        'Self-exclusion integration required'
      ]
    },

    MGA: {
      jurisdiction: 'MGA',
      displayName: 'Malta Gaming Authority',
      minRTP: 0.85,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      realityCheckIntervalMinutes: 60,
      autoplayRestrictions: {
        lossLimitRequired: true
      },
      additionalRequirements: [
        'RNG certification by approved test house',
        'Game rules in English and Maltese',
        'Self-exclusion support required'
      ]
    },

    AGCO: {
      jurisdiction: 'AGCO',
      displayName: 'Ontario (AGCO)',
      minRTP: 0.85,
      maxWinCap: 100000, // $100,000 CAD equivalent
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      realityCheckIntervalMinutes: 60,
      featureBuyRestrictions: {
        allowed: false // Feature buy prohibited in Ontario
      },
      autoplayRestrictions: {
        maxSpins: 50,
        lossLimitRequired: true,
        winLimitRequired: true,
        timeLimitRequired: true
      },
      additionalRequirements: [
        'Feature buy/bonus buy NOT allowed',
        'Autoplay max 50 spins',
        'Must display responsible gambling messaging',
        'Connection to OLG responsible gambling tools'
      ]
    },

    KAHNAWAKE: {
      jurisdiction: 'KAHNAWAKE',
      displayName: 'Kahnawake Gaming Commission',
      minRTP: 0.80,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: false,
      additionalRequirements: [
        'RNG testing by approved laboratory',
        'Server location requirements'
      ]
    },

    CURACAO: {
      jurisdiction: 'CURACAO',
      displayName: 'Curaçao eGaming',
      minRTP: 0.75,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: false,
      additionalRequirements: [
        'Annual RNG audit',
        'Player funds segregation'
      ]
    },

    ISLE_OF_MAN: {
      jurisdiction: 'ISLE_OF_MAN',
      displayName: 'Isle of Man GSC',
      minRTP: 0.70,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      additionalRequirements: [
        'Must comply with FATF AML requirements',
        'Player protection measures required'
      ]
    },

    GIBRALTAR: {
      jurisdiction: 'GIBRALTAR',
      displayName: 'Gibraltar Gambling Commissioner',
      minRTP: 0.75,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      additionalRequirements: [
        'Technical compliance with GGC requirements',
        'Annual audit by approved test house'
      ]
    },

    NEW_JERSEY: {
      jurisdiction: 'NEW_JERSEY',
      displayName: 'New Jersey DGE',
      minRTP: 0.83,
      maxRTP: 1.00,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      autoplayRestrictions: {
        maxSpins: 1000,
        lossLimitRequired: true
      },
      progressiveRequirements: {
        displayValueRequired: true,
        showHitFrequency: true,
        maxReserveRate: 0.05
      },
      additionalRequirements: [
        'Geolocation required',
        'Age verification required',
        'Player exclusion list check required'
      ]
    },

    NEVADA: {
      jurisdiction: 'NEVADA',
      displayName: 'Nevada Gaming Control Board',
      minRTP: 0.75,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: false,
      maxSpinDurationMs: 5000,
      additionalRequirements: [
        'GLI-11 or equivalent certification',
        'RAM clear testing required',
        'EPROM verification'
      ]
    },

    SWEDEN: {
      jurisdiction: 'SWEDEN',
      displayName: 'Swedish Gambling Authority',
      minRTP: 0.85,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      realityCheckIntervalMinutes: 60,
      featureBuyRestrictions: {
        allowed: false // Banned in Sweden
      },
      autoplayRestrictions: {
        lossLimitRequired: true,
        timeLimitRequired: true
      },
      additionalRequirements: [
        'Feature buy/bonus buy NOT allowed',
        'Spelpaus integration required',
        'SEK 5000/week deposit limit for new players',
        'Mandatory 3-second spin time'
      ]
    },

    DENMARK: {
      jurisdiction: 'DENMARK',
      displayName: 'Danish Gambling Authority',
      minRTP: 0.85,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      featureBuyRestrictions: {
        allowed: true,
        displayOddsRequired: true
      },
      additionalRequirements: [
        'ROFUS exclusion system integration',
        'NemID verification required'
      ]
    },

    ITALY: {
      jurisdiction: 'ITALY',
      displayName: 'ADM Italy',
      minRTP: 0.90,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      autoplayRestrictions: {
        maxSpins: 50,
        lossLimitRequired: true
      },
      additionalRequirements: [
        'SOGEI server connection required',
        'Italian localization mandatory',
        'Strict advertising restrictions'
      ]
    },

    SPAIN: {
      jurisdiction: 'SPAIN',
      displayName: 'DGOJ Spain',
      minRTP: 0.85,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      realityCheckIntervalMinutes: 30,
      additionalRequirements: [
        'Spanish language required',
        'RGIAJ exclusion system integration',
        'Strict bonus restrictions'
      ]
    },

    PORTUGAL: {
      jurisdiction: 'PORTUGAL',
      displayName: 'SRIJ Portugal',
      minRTP: 0.85,
      rulesDisplayRequired: true,
      rngCertificationRequired: true,
      rtpDisplayRequired: true,
      realityCheckRequired: true,
      additionalRequirements: [
        'Portuguese language required',
        'Server location in EU',
        'Annual compliance audit'
      ]
    }
  };

  return requirements[jurisdiction];
}

// ============================================================================
// VALIDATOR
// ============================================================================

/**
 * Validate game against a specific jurisdiction
 */
export function validateJurisdiction(
  config: GameConfig,
  result: RTPResult,
  jurisdiction: Jurisdiction
): JurisdictionValidationResult {
  const requirements = getJurisdictionRequirements(jurisdiction);
  const checks: JurisdictionCheck[] = [];

  // RTP Check
  checks.push(checkRTP(result.totalRTP, requirements));

  // Max win check
  if (requirements.maxWinCap) {
    checks.push(checkMaxWin(result.maxWin, requirements.maxWinCap));
  }

  // Hit rate check
  if (requirements.minHitRate) {
    checks.push(checkHitRate(result.hitRate, requirements.minHitRate));
  }

  // Feature buy check
  if (requirements.featureBuyRestrictions) {
    checks.push(checkFeatureBuy(config, requirements.featureBuyRestrictions));
  }

  // Progressive check
  if (config.holdAndWin?.jackpots && requirements.progressiveRequirements) {
    checks.push(checkProgressive(config, requirements.progressiveRequirements));
  }

  // Autoplay check (informational - game must support)
  if (requirements.autoplayRestrictions) {
    checks.push(checkAutoplay(requirements.autoplayRestrictions));
  }

  // Reality check (informational)
  if (requirements.realityCheckRequired) {
    checks.push({
      name: 'Reality Check',
      passed: true, // Informational
      requirement: `Reality check every ${requirements.realityCheckIntervalMinutes} minutes`,
      actual: 'Game must implement reality check feature',
      severity: 'INFO',
      recommendation: 'Ensure game client implements reality check dialog'
    });
  }

  // Calculate results
  const errorCount = checks.filter(c => !c.passed && c.severity === 'ERROR').length;
  const warningCount = checks.filter(c => !c.passed && c.severity === 'WARNING').length;
  const passedChecks = checks.filter(c => c.passed).length;
  const complianceScore = Math.round((passedChecks / checks.length) * 100);
  const passed = errorCount === 0;

  // Required documentation
  const requiredDocs: string[] = [
    'Game rules document',
    'Paytable documentation',
    'RNG certification'
  ];
  if (requirements.rtpDisplayRequired) {
    requiredDocs.push('RTP disclosure document');
  }
  if (requirements.progressiveRequirements?.displayValueRequired) {
    requiredDocs.push('Progressive jackpot documentation');
  }

  return {
    jurisdiction,
    jurisdictionName: requirements.displayName,
    passed,
    checks,
    errorCount,
    warningCount,
    complianceScore,
    summary: generateSummary(requirements, passed, errorCount, warningCount),
    requiredDocumentation: requiredDocs
  };
}

/**
 * Validate against multiple jurisdictions
 */
export function validateMultipleJurisdictions(
  config: GameConfig,
  result: RTPResult,
  jurisdictions: Jurisdiction[]
): MultiJurisdictionResult {
  const results = new Map<Jurisdiction, JurisdictionValidationResult>();
  const passedJurisdictions: Jurisdiction[] = [];
  const failedJurisdictions: Jurisdiction[] = [];

  for (const jurisdiction of jurisdictions) {
    const validationResult = validateJurisdiction(config, result, jurisdiction);
    results.set(jurisdiction, validationResult);

    if (validationResult.passed) {
      passedJurisdictions.push(jurisdiction);
    } else {
      failedJurisdictions.push(jurisdiction);
    }
  }

  // Find common issues
  const issueCount = new Map<string, number>();
  for (const [, validation] of results) {
    for (const check of validation.checks) {
      if (!check.passed) {
        const key = check.name;
        issueCount.set(key, (issueCount.get(key) ?? 0) + 1);
      }
    }
  }

  const commonIssues = Array.from(issueCount.entries())
    .filter(([, count]) => count > 1)
    .map(([issue]) => issue);

  // Generate recommendations
  const recommendations: string[] = [];
  if (commonIssues.includes('RTP Check')) {
    recommendations.push('Consider adjusting RTP to meet minimum requirements across target jurisdictions');
  }
  if (commonIssues.includes('Feature Buy')) {
    recommendations.push('Feature buy must be disabled for AGCO and Sweden');
  }

  return {
    gameName: config.name,
    gameVersion: config.version,
    passedJurisdictions,
    failedJurisdictions,
    results,
    commonIssues,
    recommendations
  };
}

// ============================================================================
// CHECK FUNCTIONS
// ============================================================================

function checkRTP(actualRTP: number, requirements: JurisdictionRequirements): JurisdictionCheck {
  const { minRTP, maxRTP } = requirements;
  let passed = actualRTP >= minRTP;
  if (maxRTP !== undefined) {
    passed = passed && actualRTP <= maxRTP;
  }

  return {
    name: 'RTP Check',
    passed,
    requirement: maxRTP
      ? `RTP must be ${(minRTP * 100).toFixed(2)}% - ${(maxRTP * 100).toFixed(2)}%`
      : `RTP must be ≥ ${(minRTP * 100).toFixed(2)}%`,
    actual: `${(actualRTP * 100).toFixed(4)}%`,
    severity: 'ERROR',
    recommendation: passed ? undefined : `Adjust paytable or reel strips to achieve RTP ≥ ${(minRTP * 100).toFixed(2)}%`
  };
}

function checkMaxWin(actualMaxWin: number, maxWinCap: number): JurisdictionCheck {
  const passed = actualMaxWin <= maxWinCap;

  return {
    name: 'Max Win Check',
    passed,
    requirement: `Max win must be ≤ ${maxWinCap.toLocaleString()}x`,
    actual: `${actualMaxWin.toLocaleString()}x`,
    severity: 'ERROR',
    recommendation: passed ? undefined : `Implement max win cap of ${maxWinCap.toLocaleString()}x`
  };
}

function checkHitRate(actualHitRate: number, minHitRate: number): JurisdictionCheck {
  const passed = actualHitRate >= minHitRate;

  return {
    name: 'Hit Rate Check',
    passed,
    requirement: `Hit rate must be ≥ ${(minHitRate * 100).toFixed(2)}%`,
    actual: `${(actualHitRate * 100).toFixed(2)}%`,
    severity: 'WARNING',
    recommendation: passed ? undefined : 'Consider adding more low-value wins to increase hit rate'
  };
}

function checkFeatureBuy(
  config: GameConfig,
  restrictions: NonNullable<JurisdictionRequirements['featureBuyRestrictions']>
): JurisdictionCheck {
  const hasFeatureBuy = config.bonusBuy?.enabled ?? false;
  const passed = restrictions.allowed || !hasFeatureBuy;

  return {
    name: 'Feature Buy',
    passed,
    requirement: restrictions.allowed
      ? 'Feature buy allowed (with disclosure requirements)'
      : 'Feature buy NOT allowed',
    actual: hasFeatureBuy ? 'Feature buy enabled' : 'Feature buy disabled',
    severity: 'ERROR',
    recommendation: passed ? undefined : 'Disable feature buy for this jurisdiction'
  };
}

function checkProgressive(
  config: GameConfig,
  requirements: NonNullable<JurisdictionRequirements['progressiveRequirements']>
): JurisdictionCheck {
  // This is primarily informational - actual implementation in game client
  return {
    name: 'Progressive Requirements',
    passed: true,
    requirement: requirements.displayValueRequired
      ? 'Progressive value must be displayed'
      : 'Progressive display optional',
    actual: 'Game has progressive jackpot feature',
    severity: 'INFO',
    recommendation: 'Ensure game client displays progressive value as required'
  };
}

function checkAutoplay(
  restrictions: NonNullable<JurisdictionRequirements['autoplayRestrictions']>
): JurisdictionCheck {
  const reqParts: string[] = [];
  if (restrictions.maxSpins) reqParts.push(`max ${restrictions.maxSpins} spins`);
  if (restrictions.lossLimitRequired) reqParts.push('loss limit');
  if (restrictions.winLimitRequired) reqParts.push('win limit');
  if (restrictions.timeLimitRequired) reqParts.push('time limit');

  return {
    name: 'Autoplay Restrictions',
    passed: true, // Informational
    requirement: `Autoplay must have: ${reqParts.join(', ')}`,
    actual: 'Must be implemented in game client',
    severity: 'INFO',
    recommendation: 'Ensure game client implements all autoplay restrictions'
  };
}

function generateSummary(
  requirements: JurisdictionRequirements,
  passed: boolean,
  errors: number,
  warnings: number
): string {
  if (passed && warnings === 0) {
    return `✓ Fully compliant with ${requirements.displayName} requirements`;
  } else if (passed) {
    return `✓ Compliant with ${requirements.displayName} (${warnings} warning(s))`;
  } else {
    return `✗ Not compliant with ${requirements.displayName}: ${errors} error(s), ${warnings} warning(s)`;
  }
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

/**
 * Generate jurisdiction compliance report
 */
export function generateJurisdictionReport(result: JurisdictionValidationResult): string {
  const lines: string[] = [
    '═══════════════════════════════════════════════════════════════',
    `        JURISDICTION COMPLIANCE REPORT: ${result.jurisdictionName}`,
    '═══════════════════════════════════════════════════════════════',
    '',
    `Status: ${result.passed ? '✓ COMPLIANT' : '✗ NOT COMPLIANT'}`,
    `Compliance Score: ${result.complianceScore}/100`,
    `Errors: ${result.errorCount} | Warnings: ${result.warningCount}`,
    '',
    '───────────────────────────────────────────────────────────────',
    'COMPLIANCE CHECKS',
    '───────────────────────────────────────────────────────────────',
  ];

  for (const check of result.checks) {
    const icon = check.passed ? '✓' :
                 check.severity === 'ERROR' ? '✗' :
                 check.severity === 'WARNING' ? '⚠' : 'ℹ';

    lines.push(`${icon} ${check.name}`);
    lines.push(`   Requirement: ${check.requirement}`);
    lines.push(`   Actual: ${check.actual}`);

    if (check.recommendation) {
      lines.push(`   → ${check.recommendation}`);
    }
    lines.push('');
  }

  lines.push('───────────────────────────────────────────────────────────────');
  lines.push('REQUIRED DOCUMENTATION');
  lines.push('───────────────────────────────────────────────────────────────');

  for (const doc of result.requiredDocumentation) {
    lines.push(`• ${doc}`);
  }

  lines.push('');
  lines.push('═══════════════════════════════════════════════════════════════');

  return lines.join('\n');
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  validateJurisdiction as validate,
  validateMultipleJurisdictions as validateMultiple,
  getJurisdictionRequirements as getRequirements,
  generateJurisdictionReport as report
};
