//! Faza 11.9 — Static jurisdiction profiles.

use super::types::{AgeTier, JurisdictionProfile};

// ─── UKGC age-tiered stake bands (SI 2025/215) ──────────────────────────────
static UKGC_AGE_TIERS: &[AgeTier] = &[
    AgeTier {
        min_age: 18,
        max_age: 24,
        max_stake: 2.0,
    },
    AgeTier {
        min_age: 25,
        max_age: 99,
        max_stake: 5.0,
    },
];

pub static UKGC: JurisdictionProfile = JurisdictionProfile {
    id: "UKGC",
    name: "UK Gambling Commission",
    rtp_range: [0.94, 0.99],
    max_win_x: None,
    prohibited_features: &["gamble", "buy_feature"],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "Stake limit per game cycle: \u{a3}5 (25+) / \u{a3}2 (18-24). Effective 2025-04-09 / 2025-05-21.",
        "Minimum 2.5s between game cycles (RTS 14D). Auto-play and turbo/quick-spin prohibited.",
        "Bonus wagering requirement cap: 10x (effective 2025-12-19).",
        "Mandatory RTP disclosure to players on game load screen.",
        "RNG must hold a certificate from an approved test house.",
        "No statutory max-win cap online \u{2014} business decision, not regulatory.",
    ],
    max_stake_default: Some(5.0),
    age_tiered_stakes: UKGC_AGE_TIERS,
    min_spin_duration_ms: Some(2500),
    prohibit_autoplay: true,
    prohibit_turbo: true,
    bonus_wagering_cap_x: Some(10),
    effective_from: Some("2025-04-09"),
    regulator_url: "https://www.gamblingcommission.gov.uk/licensees-and-businesses/guide/online-slots-stake-limits",
};

// MGA — Malta Gaming Authority.
// Source: Player Protection Directive (Directive 2 of 2018, v2 May 2021).
// Key facts (Kimi web research, May 2026):
//   • Online RNG games: minimum 85% RTP (lowered 28 May 2021 from 92%).
//   • Online slots: NO statutory stake cap, NO max-win cap, NO autoplay ban,
//     NO turbo ban, NO near-miss prohibition, NO bonus wagering cap.
//     (Land-based premises only: €5 stake / €2,000 prize via Directive 2/2018.)
//   • Mandatory: reality checks (suspend play), real-time clock, deposit limits,
//     24h cooling-off for increases, age verification.
//   • RNG must be certified by EU/EEA-based lab (eCOGRA, GLI, iTech Labs).
// We honour upstream non-MGA confusion (UKGC/DE/NL rules often misattributed)
// by NOT importing those into the MGA profile.
pub static MGA: JurisdictionProfile = JurisdictionProfile {
    id: "MGA",
    name: "Malta Gaming Authority",
    rtp_range: [0.85, 0.99],
    max_win_x: None,
    prohibited_features: &[],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: None,
    informational_notes: &[
        "Online RNG games: minimum 85% RTP (Article 22, Player Protection Directive, eff. 2021-05-28).",
        "Reality checks must suspend play with elapsed time / wagers / wins / losses on screen.",
        "Real-time clock must display continuously in full-screen games (Article 18(5)).",
        "Mandatory deposit or wagering limits; increases require 24h cooling-off period.",
        "Age affirmation pre-play; full KYC/AML verification required; minor wagers must be returned.",
        "RNG must be certified by an EU/EEA accredited lab (eCOGRA, GLI, iTech Labs).",
        "No statutory stake cap, max-win cap, autoplay ban, or near-miss prohibition for online slots.",
        "Bonus terms must be transparent and fair (S.L. 583.09); no statutory wagering-multiplier cap.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: Some("2021-05-28"),
    regulator_url: "https://www.mga.org.mt/licensee-hub/compliance/player-protection/",
};

// ADM — Agenzia delle Dogane e dei Monopoli (Italy).
// Sources (Kimi web research, May 2026):
//   • ADM Decree 10 Jan 2011 n.4991/RU — online RNG slots ≥ 90% RTP (eff. 2011-07-18).
//   • Legislative Decree 41/2024 — new licensing regime (eff. 2025-11-13).
//   • Law 96/2018 (Decreto Dignità) — total advertising ban, eff. 2018-07-14.
//   • 2025 ADM Technical Guidelines — RNG 99% confidence, autoplay with consent,
//     20min inactivity logout, RTP visible in-game, ODV validation.
// Key facts:
//   • Online slots: ≥90% RTP. NO per-spin statutory stake cap (commercial only).
//     NO per-spin max-win cap (land-based newslot has €100 cap; online does NOT).
//   • Player-level limits: €100/day spend, €200/day deposit top-up, 3h/day session.
//   • Cash account funding ≤ €100/week.
//   • Autoplay: PERMITTED but requires explicit prior player consent and 20-min
//     inactivity auto-logout. Not categorically banned.
//   • Gamble (red/black) features: prohibited under historic AAMS technical rules.
//   • Advertising / sponsorship: total ban (Decreto Dignità).
pub static ADM: JurisdictionProfile = JurisdictionProfile {
    id: "ADM",
    name: "Agenzia delle Dogane e dei Monopoli (Italy)",
    rtp_range: [0.90, 0.99],
    max_win_x: None,
    prohibited_features: &["gamble"],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "Online RNG slots: minimum 90% RTP (ADM Decree 10 Jan 2011, art. 4 — eff. 2011-07-18).",
        "Player budgets: \u{20ac}100/day spend cap, \u{20ac}200/day top-up, 3h/day session, \u{20ac}100/week cash funding.",
        "Auto-play requires explicit prior player consent; 20-minute inactivity logout mandatory.",
        "Total advertising and sponsorship ban (Law 96/2018 Decreto Dignit\u{e0}); fines from \u{20ac}50,000.",
        "RNG: 99% statistical confidence required (2025 ADM Technical Guidelines); ODV pre-go-live validation.",
        "EUR-only currency.",
        "Land-based AWP/VLT (NOT online) carry separate caps: \u{20ac}1 stake / \u{20ac}100 win for Newslot.",
        "RTP must be visible in-game; responsible-gambling warnings (Law 158/2012 Balduzzi) required.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    // Per 2025 Technical Guidelines, autoplay is *permitted with consent* — not a
    // blanket ban. Compliance is consent-flow level, surfaced via UI/runtime.
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: Some("2011-07-18"),
    regulator_url: "https://www.adm.gov.it/portale/monopoli/giochi",
};

pub static BMM: JurisdictionProfile = JurisdictionProfile {
    id: "BMM",
    name: "BMM Testlabs / GLI-16",
    rtp_range: [0.80, 0.99],
    max_win_x: None,
    prohibited_features: &[],
    require_ldw_disclosure: false,
    require_session_time_display: false,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "GLI-16 v3 requires RTP verification within \u{b1}0.05% of declared value.",
        "PAR sheet must be available and match IR declarations.",
        "Recall capability (hash-chained audit trail) required for GLI-16 \u{a7}4.5.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: None,
    regulator_url: "https://bmm.com/",
};

pub static GLI19: JurisdictionProfile = JurisdictionProfile {
    id: "GLI19",
    name: "Gaming Laboratories International Standard 19",
    rtp_range: [0.80, 0.99],
    max_win_x: None,
    prohibited_features: &[],
    require_ldw_disclosure: false,
    require_session_time_display: false,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "Hash-chained spin audit trail required (Faza 8.5 recall journal satisfies this).",
        "Minimum 5-year audit log retention.",
        "Replay capability from any stored spin required.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: None,
    regulator_url: "https://gaminglabs.com/",
};

pub static AGCO: JurisdictionProfile = JurisdictionProfile {
    id: "AGCO",
    name: "Alcohol and Gaming Commission of Ontario",
    rtp_range: [0.85, 0.99],
    max_win_x: None,
    prohibited_features: &["gamble"],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "Mandatory pre-commitment tools \u{2014} not modelled in IR.",
        "Auto-play restricted (manual stop required).",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: true,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: None,
    regulator_url: "https://www.agco.ca/",
};

pub static DGA: JurisdictionProfile = JurisdictionProfile {
    id: "DGA",
    name: "Spillemyndigheden (Denmark)",
    rtp_range: [0.92, 0.99],
    max_win_x: None,
    prohibited_features: &[],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "Self-exclusion integration with ROFUS required.",
        "RNG must be tested by accredited test house.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: None,
    regulator_url: "https://www.spillemyndigheden.dk/",
};

pub static NJDGE: JurisdictionProfile = JurisdictionProfile {
    id: "NJDGE",
    name: "New Jersey Division of Gaming Enforcement",
    rtp_range: [0.83, 0.99],
    max_win_x: None,
    prohibited_features: &[],
    require_ldw_disclosure: true,
    require_session_time_display: true,
    required_near_miss_rule: Some("must_be_random"),
    informational_notes: &[
        "RNG must be approved by NJDGE or a DGE-approved testing lab.",
        "PAR sheet submission required for each game variant.",
    ],
    max_stake_default: None,
    age_tiered_stakes: &[],
    min_spin_duration_ms: None,
    prohibit_autoplay: false,
    prohibit_turbo: false,
    bonus_wagering_cap_x: None,
    effective_from: None,
    regulator_url: "https://www.nj.gov/oag/ge/",
};

pub static ALL_PROFILES: &[&JurisdictionProfile] =
    &[&UKGC, &MGA, &ADM, &BMM, &GLI19, &AGCO, &DGA, &NJDGE];

pub fn get_profile(id: &str) -> Option<&'static JurisdictionProfile> {
    ALL_PROFILES.iter().copied().find(|p| p.id == id)
}
