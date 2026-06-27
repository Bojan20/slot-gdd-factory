//! Faza 8.6 — Server-side Casino Protocols: shared types.
//!
//! Mirror of `src/protocols/types.ts`. Field names and JSON shapes must
//! stay aligned with the TS side.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MeterSnapshot {
    pub games_played: u64,
    pub total_wagered: f64,
    pub total_won: f64,
    pub net_revenue: f64,
    pub jackpot_total: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SpinEvent {
    pub session_id: String,
    pub spin_index: u64,
    pub timestamp: String,
    pub wagered: f64,
    pub won: f64,
    pub features: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub grid: Option<Vec<Vec<String>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameIdentity {
    pub game_id: String,
    pub game_name: String,
    pub version: String,
    pub target_rtp: f64,
    pub jurisdiction: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub certification_id: Option<String>,
}
