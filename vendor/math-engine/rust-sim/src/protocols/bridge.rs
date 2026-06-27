//! Faza 8.6 — Protocol Bridge.
//!
//! Bridges the engine's native types (SlotGameIR) to casino protocol
//! adapters (G2S, SAS, GAT-IV).

use super::g2s::G2SAdapter;
use super::types::{GameIdentity, MeterSnapshot, SpinEvent};
use crate::ir::SlotGameIR;

pub struct ProtocolBridge {
    identity: GameIdentity,
    session_id: String,
}

impl ProtocolBridge {
    /// Create a new bridge from a SlotGameIR and a session ID.
    pub fn new(ir: &SlotGameIR, session_id: String) -> Self {
        let jurisdiction = ir
            .compliance
            .jurisdictions
            .first()
            .cloned()
            .unwrap_or_else(|| "UNKNOWN".to_string());

        let identity = GameIdentity {
            game_id: ir.meta.id.clone(),
            game_name: ir.meta.name.clone(),
            version: ir.meta.version.clone(),
            target_rtp: ir.limits.target_rtp,
            jurisdiction,
            certification_id: None,
        };

        Self {
            identity,
            session_id,
        }
    }

    /// The GameIdentity derived from the SlotGameIR.
    pub fn identity(&self) -> &GameIdentity {
        &self.identity
    }

    /// Build a MeterSnapshot from accumulated session stats.
    pub fn meter_snapshot(&self, spins: u64, total_wagered: f64, total_won: f64) -> MeterSnapshot {
        MeterSnapshot {
            games_played: spins,
            total_wagered,
            total_won,
            net_revenue: total_wagered - total_won,
            jackpot_total: 0.0,
        }
    }

    /// Build a SpinEvent from raw spin data.
    pub fn spin_event(
        &self,
        spin_index: u64,
        wagered: f64,
        won: f64,
        features: Vec<String>,
    ) -> SpinEvent {
        SpinEvent {
            session_id: self.session_id.clone(),
            spin_index,
            timestamp: "1970-01-01T00:00:00.000Z".to_string(),
            wagered,
            won,
            features,
            grid: None,
        }
    }

    /// Convert a spin event → G2S spinHistory XML.
    pub fn spin_event_to_g2s(&self, event: &SpinEvent) -> String {
        G2SAdapter::spin_history(event, &self.identity)
    }
}
