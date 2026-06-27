//! Faza 8.6 — Server-side Casino Protocols.
//!
//! Protocol adapter layer bridging the engine's IR types to industry-standard
//! casino backend protocols (G2S, SAS, GAT-IV).

pub mod bridge;
pub mod g2s;
pub mod gat4;
pub mod sas;
pub mod types;

pub use bridge::ProtocolBridge;
pub use g2s::G2SAdapter;
pub use gat4::GAT4Adapter;
pub use sas::SASAdapter;
pub use types::{GameIdentity, MeterSnapshot, SpinEvent};
