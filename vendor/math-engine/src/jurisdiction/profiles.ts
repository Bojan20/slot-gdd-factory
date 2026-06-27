/**
 * Faza 11.9 — Jurisdiction Profiles (Rust↔TS mirror).
 * Last updated: 2026-05-14 (Faza 11.10).
 *
 * Mirror of `rust-sim/src/jurisdiction/profiles.rs`. Keep field order and
 * data identical so the parity gate stays green.
 *
 * Sources (Kimi deep-research, May 2026):
 *  - UKGC: SI 2025/215, RTS 14D, LCCP SR 7.1.2.
 *  - MGA: Player Protection Directive 2/2018 v2 (May 2021).
 *  - ADM: Decree 10 Jan 2011 n.4991/RU; Legislative Decree 41/2024;
 *    Law 96/2018 (Decreto Dignità); 2025 Technical Guidelines.
 */

import type { AgeTier, JurisdictionProfile } from './types.js';

const UKGC_AGE_TIERS: ReadonlyArray<AgeTier> = [
  { minAge: 18, maxAge: 24, maxStake: 2.0 },
  { minAge: 25, maxAge: 99, maxStake: 5.0 },
];

const UKGC: JurisdictionProfile = {
  id: 'UKGC',
  name: 'UK Gambling Commission',
  rtpRange: [0.94, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['gamble', 'buy_feature'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Stake limit per game cycle: £5 (25+) / £2 (18-24). Effective 2025-04-09 / 2025-05-21.',
    'Minimum 2.5s between game cycles (RTS 14D). Auto-play and turbo/quick-spin prohibited.',
    'Bonus wagering requirement cap: 10x (effective 2025-12-19).',
    'Mandatory RTP disclosure to players on game load screen.',
    'RNG must hold a certificate from an approved test house.',
    'No statutory max-win cap online — business decision, not regulatory.',
  ],
  maxStakeDefault: 5.0,
  ageTieredStakes: UKGC_AGE_TIERS,
  minSpinDurationMs: 2500,
  prohibitAutoplay: true,
  prohibitTurbo: true,
  bonusWageringCapX: 10,
  effectiveFrom: '2025-04-09',
  regulatorUrl:
    'https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/online-slots-stake-limits',
};

// MGA — Malta Gaming Authority.
// Online slots: NO statutory stake cap, NO max-win cap, NO autoplay ban,
// NO turbo ban, NO near-miss prohibition, NO bonus wagering cap.
// Mandatory: reality checks, real-time clock, deposit limits, KYC/AML.
const MGA: JurisdictionProfile = {
  id: 'MGA',
  name: 'Malta Gaming Authority',
  rtpRange: [0.85, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: undefined,
  informationalNotes: [
    'Online RNG games: minimum 85% RTP (Article 22, Player Protection Directive, eff. 2021-05-28).',
    'Reality checks must suspend play with elapsed time / wagers / wins / losses on screen.',
    'Real-time clock must display continuously in full-screen games (Article 18(5)).',
    'Mandatory deposit or wagering limits; increases require 24h cooling-off period.',
    'Age affirmation pre-play; full KYC/AML verification required; minor wagers must be returned.',
    'RNG must be certified by an EU/EEA accredited lab (eCOGRA, GLI, iTech Labs).',
    'No statutory stake cap, max-win cap, autoplay ban, or near-miss prohibition for online slots.',
    'Bonus terms must be transparent and fair (S.L. 583.09); no statutory wagering-multiplier cap.',
  ],
  maxStakeDefault: undefined,
  ageTieredStakes: [],
  minSpinDurationMs: undefined,
  prohibitAutoplay: false,
  prohibitTurbo: false,
  bonusWageringCapX: undefined,
  effectiveFrom: '2021-05-28',
  regulatorUrl: 'https://www.mga.org.mt/licensee-hub/compliance/player-protection/',
};

// ADM — Agenzia delle Dogane e dei Monopoli (Italy).
// Online slots: ≥90% RTP. NO per-spin statutory stake/win cap.
// Autoplay PERMITTED with consent + 20min inactivity logout. Advertising banned.
const ADM: JurisdictionProfile = {
  id: 'ADM',
  name: 'Agenzia delle Dogane e dei Monopoli (Italy)',
  rtpRange: [0.90, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['gamble'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Online RNG slots: minimum 90% RTP (ADM Decree 10 Jan 2011, art. 4 — eff. 2011-07-18).',
    'Player budgets: €100/day spend cap, €200/day top-up, 3h/day session, €100/week cash funding.',
    'Auto-play requires explicit prior player consent; 20-minute inactivity logout mandatory.',
    'Total advertising and sponsorship ban (Law 96/2018 Decreto Dignità); fines from €50,000.',
    'RNG: 99% statistical confidence required (2025 ADM Technical Guidelines); ODV pre-go-live validation.',
    'EUR-only currency.',
    'Land-based AWP/VLT (NOT online) carry separate caps: €1 stake / €100 win for Newslot.',
    'RTP must be visible in-game; responsible-gambling warnings (Law 158/2012 Balduzzi) required.',
  ],
  maxStakeDefault: undefined,
  ageTieredStakes: [],
  minSpinDurationMs: undefined,
  // 2025 Technical Guidelines: autoplay permitted *with consent* — not a blanket ban.
  prohibitAutoplay: false,
  prohibitTurbo: false,
  bonusWageringCapX: undefined,
  effectiveFrom: '2011-07-18',
  regulatorUrl: 'https://www.adm.gov.it/portale/monopoli/giochi',
};

const BMM: JurisdictionProfile = {
  id: 'BMM',
  name: 'BMM Testlabs / GLI-16',
  rtpRange: [0.80, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: false,
  requireSessionTimeDisplay: false,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'GLI-16 v3 requires RTP verification within ±0.05% of declared value.',
    'PAR sheet must be available and match IR declarations.',
    'Recall capability (hash-chained audit trail) required for GLI-16 §4.5.',
  ],
  regulatorUrl: 'https://bmm.com/',
};

const GLI19: JurisdictionProfile = {
  id: 'GLI19',
  name: 'Gaming Laboratories International Standard 19',
  rtpRange: [0.80, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: false,
  requireSessionTimeDisplay: false,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Hash-chained spin audit trail required.',
    'Minimum 5-year audit log retention.',
    'Replay capability from any stored spin required.',
  ],
  regulatorUrl: 'https://gaminglabs.com/',
};

const AGCO: JurisdictionProfile = {
  id: 'AGCO',
  name: 'Alcohol and Gaming Commission of Ontario',
  rtpRange: [0.85, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['gamble'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Mandatory pre-commitment tools — not modelled in IR.',
    'Auto-play restricted (manual stop required).',
  ],
  prohibitAutoplay: true,
  regulatorUrl: 'https://www.agco.ca/',
};

const DGA: JurisdictionProfile = {
  id: 'DGA',
  name: 'Spillemyndigheden (Denmark)',
  rtpRange: [0.92, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Self-exclusion integration with ROFUS required.',
    'RNG must be tested by accredited test house.',
  ],
  regulatorUrl: 'https://www.spillemyndigheden.dk/',
};

const NJDGE: JurisdictionProfile = {
  id: 'NJDGE',
  name: 'New Jersey Division of Gaming Enforcement',
  rtpRange: [0.83, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'RNG must be approved by NJDGE or a DGE-approved testing lab.',
    'PAR sheet submission required for each game variant.',
  ],
  regulatorUrl: 'https://www.nj.gov/oag/ge/',
};

// ADM_VLT — Italy land-based VLT (separate from ADM online slots track).
// Decree 10 Jan 2011 + 2025 ADM Technical Guidelines. Land-based VLT has
// per-spin stake/win caps that DO NOT apply to online RNG slots; this
// profile tracks those land-based limits explicitly so Class III online
// slots don't accidentally inherit them.
const ADM_VLT: JurisdictionProfile = {
  id: 'ADM_VLT',
  name: 'ADM (Italy) — Land-based VLT',
  rtpRange: [0.85, 0.99],
  maxWinX: 5000,
  prohibitedFeatures: ['gamble', 'buy_feature'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Land-based VLT (Video Lottery Terminal): minimum 85% RTP, max single win €5000 (NOT applicable to online RNG slots — those are separate ADM jurisdiction).',
    'Max stake per spin €10 (Newslot / AWP). VLT pattern subject to ADM Decreto Direttoriale.',
    'Mandatory connection to ADM central system (server-side draw audit + WAP tracking).',
    'Land-based VLT slot pattern is RNG-driven on the ADM central server, not on the terminal itself.',
    'Players: ≥18, identity verified at first cash-in via SPID or anti-fraud sweep.',
    'Closing hours per municipality (sindaco discretion).',
  ],
  maxStakeDefault: 10.0,
  ageTieredStakes: [],
  minSpinDurationMs: 4000,
  prohibitAutoplay: true,
  prohibitTurbo: true,
  bonusWageringCapX: undefined,
  effectiveFrom: '2011-07-18',
  regulatorUrl: 'https://www.adm.gov.it/portale/monopoli/giochi/vlt',
};

// NIGC_C2 — US National Indian Gaming Commission Class II.
// Different track entirely: prizes drawn from a centrally-determined
// ticket pool (`ClassIIBingoCoordinator`), NOT generated independently
// per spin. Profile flags surfaced here so jurisdiction adapter can
// route to the bingo coordinator instead of the regular evaluator.
const NIGC_C2: JurisdictionProfile = {
  id: 'NIGC_C2',
  name: 'US National Indian Gaming Commission (Class II)',
  rtpRange: [0.80, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['cascade', 'respin'], // ticket-pool draws don't compose
  requireLdwDisclosure: false,
  requireSessionTimeDisplay: false,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Class II = bingo / pull-tab pool-draw mechanic. Per-spin RNG is COSMETIC — the underlying prize is drawn from a finite, centrally-determined pool.',
    'Implementation: route through `ClassIIBingoCoordinator` (Faza 14.3) rather than per-spin evaluator.',
    'Pool must be cryptographically random (GLI-11 §3 — HSM-grade RNG required).',
    'No two terminals on the same coordinator may receive the same ticket (atomic decrement).',
    'IGRA 1988 + 25 CFR Parts 542-547 — tribal-state compact required.',
  ],
  effectiveFrom: '1988-10-17',
  regulatorUrl: 'https://www.nigc.gov/regulations',
};

// NV_SKILL — Nevada Gaming Commission, skill-influenced slot game category
// (Senate Bill 9 / Reg 14, effective 2017-08-04). Player skill modifies
// outcome distribution within a bounded envelope; RTP_min must be honoured
// regardless of skill level.
const NV_SKILL: JurisdictionProfile = {
  id: 'NV_SKILL',
  name: 'Nevada — Skill-Influenced Slot (Reg 14)',
  rtpRange: [0.75, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['gamble'],
  requireLdwDisclosure: false,
  requireSessionTimeDisplay: false,
  requiredNearMissRule: 'allowed_within_distribution',
  informationalNotes: [
    'Skill component must contribute ≥1% RTP swing at the player-skill extremes (Reg 14 §14.040(11)).',
    'Min RTP must be achievable by an unskilled player; max RTP must be achievable by an expert.',
    'Skill input MUST be recorded for audit (replay-able skill session per spin).',
    'Reg 14 §14.040(15): NGCB pre-approval required before deployment.',
    'NJ DGE Internet Gaming Technical Standard 14.1 has a similar profile but is separately tracked.',
  ],
  effectiveFrom: '2017-08-04',
  regulatorUrl: 'https://gaming.nv.gov/about/contact-information/',
};

// ───────────────────────────────────────────────────────────────────────────
// W152 Wave 19 — Faza 15.B.5 — 4 nova jurisdikcijska profila
// ───────────────────────────────────────────────────────────────────────────

// DGOJ — Spain, Dirección General de Ordenación del Juego.
// Online slot regulation under Real Decreto 1614/2011 + AT-08 technical
// standard (Resolución 2014). Updated 2024 stake/bonus restrictions
// per Real Decreto-ley 22/2023 + Real Decreto 176/2023.
const DGOJ: JurisdictionProfile = {
  id: 'DGOJ',
  name: 'Spain — Dirección General de Ordenación del Juego (AT-08)',
  rtpRange: [0.9, 0.99],
  maxWinX: 50000,
  prohibitedFeatures: [],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  maxStakeDefault: 50,
  minSpinDurationMs: 2500,
  prohibitAutoplay: true,
  prohibitTurbo: true,
  bonusWageringCapX: 30,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'AT-08 §4.2 requires server-side spin pacing (≥ 2.5 s).',
    'Real Decreto 176/2023 caps online slot stake at €50 per game cycle from 2024.',
    'Bonus wagering must not exceed 30× principal per AT-08 §6.1.',
    'Self-exclusion register integration (Registro General de Interdicciones de Acceso al Juego) mandatory.',
    'Pre-commitment (deposit + loss limits) required per Real Decreto-ley 22/2023.',
  ],
  effectiveFrom: '2024-01-01',
  regulatorUrl: 'https://www.ordenacionjuego.es/',
};

// SE — Sweden Spelinspektionen, online slot B2B/B2C licensing.
// Spellagen (2018:1138) + amendments 2022/2025. Tighter measures
// from B2B reform 2025-07-01 (B2B suppliers must hold license).
const SPELINSPEKTIONEN: JurisdictionProfile = {
  id: 'SPELINSPEKTIONEN',
  name: 'Sweden — Spelinspektionen (Spellagen 2018:1138 + 2025 B2B reform)',
  rtpRange: [0.9, 0.99],
  maxWinX: undefined,
  prohibitedFeatures: ['buy_feature'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  maxStakeDefault: 50,
  minSpinDurationMs: 3000,
  prohibitAutoplay: true,
  prohibitTurbo: true,
  bonusWageringCapX: 1,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Spellagen §14.13b: bonus may only be offered to a NEW customer, capped at 1× wagering.',
    'Spelinspektionen LIFS 2019:2 §17 mandates ≥ 3 s spin minimum.',
    'Buy-feature prohibited under SOU 2024:23 anti-manipulation guidance.',
    'Spelpaus (national self-exclusion) integration mandatory.',
    'B2B licensing reform 2025-07-01: every B2B slot provider needs separate license.',
  ],
  effectiveFrom: '2025-07-01',
  regulatorUrl: 'https://www.spelinspektionen.se/',
};

// PA — Pennsylvania Gaming Control Board (PGCB).
// 58 Pa. Code §809a — Internet gaming technical standards.
const PGCB: JurisdictionProfile = {
  id: 'PGCB',
  name: 'Pennsylvania — Gaming Control Board (58 Pa. Code §809a)',
  rtpRange: [0.85, 1.0],
  maxWinX: undefined,
  prohibitedFeatures: [],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  maxStakeDefault: undefined,
  minSpinDurationMs: 2000,
  prohibitAutoplay: false,
  prohibitTurbo: false,
  bonusWageringCapX: 25,
  requiredNearMissRule: 'allowed_within_distribution',
  informationalNotes: [
    '58 Pa. Code §809a.6 minimum theoretical RTP 85 %.',
    '§809a.4 minimum game cycle 2 s (substantially shorter than UK).',
    '§809a.10 RNG must be tested by independent lab (BMM / GLI / iTechLabs).',
    'Responsible gaming opt-out via PA Self-Exclusion List (CASE).',
    'Promotional wagering capped at 25× — joint operator / regulator guidance 2024.',
  ],
  effectiveFrom: '2017-10-30',
  regulatorUrl: 'https://gamingcontrolboard.pa.gov/',
};

// SG — Singapore National Council on Problem Gambling (NCPG).
// Casino Control Act 2006 + 2022 NCPG online operator framework.
// Singapore's online slot environment is restricted (Singapore Pools / TOTE
// only) — relevant for B2B math engine deployments via licensed operators.
const NCPG: JurisdictionProfile = {
  id: 'NCPG',
  name: 'Singapore — NCPG / Casino Control Act 2006',
  rtpRange: [0.92, 0.985],
  maxWinX: 25000,
  prohibitedFeatures: ['buy_feature', 'gamble'],
  requireLdwDisclosure: true,
  requireSessionTimeDisplay: true,
  maxStakeDefault: 100,
  minSpinDurationMs: 4000,
  prohibitAutoplay: true,
  prohibitTurbo: true,
  bonusWageringCapX: 5,
  requiredNearMissRule: 'must_be_random',
  informationalNotes: [
    'Casino Control Act §172 mandates strict RTP envelope (92-98.5%).',
    'NCPG online framework 2022: 4 s min spin duration + mandatory cooling-off prompts.',
    '$100 max stake per game cycle (SGD); higher caps require pre-approved high-roller status.',
    'Buy-feature + gamble side bets prohibited under §117.',
    'NCPG Self-Exclusion Programme integration mandatory; Casino Exclusion Order overrides bypassed.',
  ],
  effectiveFrom: '2022-07-01',
  regulatorUrl: 'https://www.ncpg.org.sg/',
};

export const PROFILES: ReadonlyMap<string, JurisdictionProfile> = new Map([
  ['UKGC', UKGC],
  ['MGA', MGA],
  ['ADM', ADM],
  ['BMM', BMM],
  ['GLI19', GLI19],
  ['AGCO', AGCO],
  ['DGA', DGA],
  ['NJDGE', NJDGE],
  ['ADM_VLT', ADM_VLT],
  ['NIGC_C2', NIGC_C2],
  ['NV_SKILL', NV_SKILL],
  ['DGOJ', DGOJ],
  ['SPELINSPEKTIONEN', SPELINSPEKTIONEN],
  ['PGCB', PGCB],
  ['NCPG', NCPG],
]);
