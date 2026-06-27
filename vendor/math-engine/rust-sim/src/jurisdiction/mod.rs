//! Faza 11.9 — Jurisdiction Adapter (Rust mirror).
pub mod adapter;
pub mod profiles;
pub mod types;

pub use adapter::{
    auto_fix, validate, validate_autoplay, validate_bonus_wagering, validate_spin,
    validate_spin_duration, validate_spin_full, validate_stake, validate_turbo, SpinContext,
};
pub use profiles::get_profile;
pub use types::{
    AgeTier, AutoFixResult, ComplianceError, ComplianceReport, ComplianceViolation,
    JurisdictionProfile,
};
