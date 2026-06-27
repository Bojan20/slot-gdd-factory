//! Faza 3 — Symbol Behavior Plugin Layer (Rust)
//!
//! Mirrors `src/behaviors/` in TypeScript.
//!
//! ## Modules
//!
//! - `types`    — Effect enum, SpinState, BehaviorContext, SymbolBehavior trait
//! - `pipeline` — apply_effect, apply_effects, tick_locked_positions
//! - `impls`    — 11 behavior implementations (Wild, Expanding, Sticky, ...)
//! - `registry` — BehaviorRegistry

pub mod impls;
pub mod pipeline;
pub mod registry;
pub mod types;

// Convenient re-exports
pub use pipeline::{apply_effect, apply_effects, restore_locked_positions, tick_locked_positions};
pub use registry::BehaviorRegistry;
pub use types::{
    BehaviorContext, CollectedCoin, Effect, EffectScope, LockedPosition, SpinState, SymbolBehavior,
};
