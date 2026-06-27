//! GAT-IV (Gaming Application Toolkit v4) — SG proprietary protocol.
//!
//! JSON-based session/spin result serialization for Bally/WMS/Scientific
//! Games cabinets.

use super::types::{GameIdentity, MeterSnapshot, SpinEvent};
use serde_json::{json, Value};

pub struct GAT4Adapter;

impl GAT4Adapter {
    // ─── Envelope builder ────────────────────────────────────────────────────

    fn envelope(message_type: &str, session_id: &str, payload: Value) -> Value {
        json!({
            "gatVersion": "4.0",
            "messageType": message_type,
            "timestamp": "1970-01-01T00:00:00.000Z",
            "sessionId": session_id,
            "payload": payload,
        })
    }

    // ─── sessionStart ────────────────────────────────────────────────────────

    /// Build a session.start message for game session initialization.
    pub fn session_start(game_id: &GameIdentity, session_id: &str) -> Value {
        let mut payload = json!({
            "gameId": game_id.game_id,
            "gameName": game_id.game_name,
            "version": game_id.version,
            "targetRtp": game_id.target_rtp,
            "jurisdiction": game_id.jurisdiction,
        });
        if let Some(cert) = &game_id.certification_id {
            payload["certificationId"] = json!(cert);
        }
        Self::envelope("session.start", session_id, payload)
    }

    // ─── spinResult ──────────────────────────────────────────────────────────

    /// Build a session.spin message for a single spin result.
    pub fn spin_result(event: &SpinEvent, game_id: &GameIdentity) -> Value {
        let mut payload = json!({
            "spinIndex": event.spin_index,
            "wagered": event.wagered,
            "won": event.won,
            "features": event.features,
            "gameId": game_id.game_id,
        });
        if let Some(grid) = &event.grid {
            payload["grid"] = json!(grid);
        }
        Self::envelope("session.spin", &event.session_id, payload)
    }

    // ─── sessionEnd ──────────────────────────────────────────────────────────

    /// Build a session.end message with session summary and RTP stats.
    pub fn session_end(meters: &MeterSnapshot, game_id: &GameIdentity, session_id: &str) -> Value {
        let rtp = if meters.total_wagered > 0.0 {
            meters.total_won / meters.total_wagered
        } else {
            0.0
        };
        let payload = json!({
            "gameId": game_id.game_id,
            "gamesPlayed": meters.games_played,
            "totalWagered": meters.total_wagered,
            "totalWon": meters.total_won,
            "netRevenue": meters.net_revenue,
            "jackpotTotal": meters.jackpot_total,
            "rtp": rtp,
        });
        Self::envelope("session.end", session_id, payload)
    }

    // ─── parse ───────────────────────────────────────────────────────────────

    /// Parse a GAT-IV message envelope. Returns (messageType, payload).
    pub fn parse(obj: &Value) -> (String, Value) {
        let message_type = obj
            .get("messageType")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let payload = obj.get("payload").cloned().unwrap_or(Value::Null);
        (message_type, payload)
    }
}
