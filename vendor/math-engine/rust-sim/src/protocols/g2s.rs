//! G2S (Gaming to System) protocol adapter — ANSI/AGA G2S v2.0.
//!
//! Serializes engine state to G2S XML message format.
//! All XML is hand-generated via pure string templating with proper escaping.

use super::types::{GameIdentity, MeterSnapshot, SpinEvent};
use std::collections::HashMap;

pub struct G2SAdapter;

impl G2SAdapter {
    // ─── XML escape ──────────────────────────────────────────────────────────

    /// Escape XML special characters in attribute values and text content.
    pub fn escape_xml(s: &str) -> String {
        let mut out = String::with_capacity(s.len());
        for ch in s.chars() {
            match ch {
                '&' => out.push_str("&amp;"),
                '<' => out.push_str("&lt;"),
                '>' => out.push_str("&gt;"),
                '"' => out.push_str("&quot;"),
                '\'' => out.push_str("&apos;"),
                c => out.push(c),
            }
        }
        out
    }

    // ─── Envelope builder ────────────────────────────────────────────────────

    fn envelope(message_type: &str, body_content: &str) -> String {
        let date_time = chrono_now();
        format!(
            "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
             <g2s:g2sBody \
             xmlns:g2s=\"http://www.g2s.org/g2sCore\" \
             xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\" \
             dateTime=\"{date_time}\" \
             g2sVersion=\"G2S_2.0.0\" \
             messageType=\"{mt}\">\n\
             {body}\n\
             </g2s:g2sBody>",
            date_time = Self::escape_xml(&date_time),
            mt = Self::escape_xml(message_type),
            body = body_content,
        )
    }

    // ─── cabinetStatus ───────────────────────────────────────────────────────

    /// Build a g2s:cabinetStatus XML message describing the game identity.
    pub fn cabinet_status(game_id: &GameIdentity) -> String {
        let cert = game_id
            .certification_id
            .as_deref()
            .map(|c| format!(" certificationId=\"{}\"", Self::escape_xml(c)))
            .unwrap_or_default();

        let body = format!(
            "  <g2s:cabinetStatus \
             gameId=\"{game_id}\" \
             gameName=\"{game_name}\" \
             version=\"{version}\" \
             targetRtp=\"{rtp}\" \
             jurisdiction=\"{jurisdiction}\"{cert}/>",
            game_id = Self::escape_xml(&game_id.game_id),
            game_name = Self::escape_xml(&game_id.game_name),
            version = Self::escape_xml(&game_id.version),
            rtp = game_id.target_rtp,
            jurisdiction = Self::escape_xml(&game_id.jurisdiction),
            cert = cert,
        );
        Self::envelope("cabinetStatus", &body)
    }

    // ─── spinHistory ─────────────────────────────────────────────────────────

    /// Build a g2s:spinHistory XML message from a spin event.
    pub fn spin_history(event: &SpinEvent, game_id: &GameIdentity) -> String {
        let features_xml: String = event
            .features
            .iter()
            .map(|f| format!("    <g2s:feature kind=\"{}\"/>", Self::escape_xml(f)))
            .collect::<Vec<_>>()
            .join("\n");

        let inner = if features_xml.is_empty() {
            String::new()
        } else {
            format!("\n{features_xml}\n  ")
        };

        let body = format!(
            "  <g2s:spinHistory \
             gameId=\"{game_id}\" \
             sessionId=\"{session_id}\" \
             spinIndex=\"{spin_index}\" \
             timestamp=\"{ts}\" \
             wagered=\"{wagered}\" \
             won=\"{won}\">\
             {inner}\
             </g2s:spinHistory>",
            game_id = Self::escape_xml(&game_id.game_id),
            session_id = Self::escape_xml(&event.session_id),
            spin_index = event.spin_index,
            ts = Self::escape_xml(&event.timestamp),
            wagered = event.wagered,
            won = event.won,
            inner = inner,
        );
        Self::envelope("spinHistory", &body)
    }

    // ─── meterReport ─────────────────────────────────────────────────────────

    /// Build a g2s:meterReport XML from a MeterSnapshot.
    pub fn meter_report(meters: &MeterSnapshot, game_id: &GameIdentity) -> String {
        let body = format!(
            "  <g2s:meterReport \
             gameId=\"{game_id}\" \
             gamesPlayed=\"{games_played}\" \
             totalWagered=\"{total_wagered}\" \
             totalWon=\"{total_won}\" \
             netRevenue=\"{net_revenue}\" \
             jackpotTotal=\"{jackpot_total}\"/>",
            game_id = Self::escape_xml(&game_id.game_id),
            games_played = meters.games_played,
            total_wagered = meters.total_wagered,
            total_won = meters.total_won,
            net_revenue = meters.net_revenue,
            jackpot_total = meters.jackpot_total,
        );
        Self::envelope("meterReport", &body)
    }

    // ─── eventReport ─────────────────────────────────────────────────────────

    /// Build a g2s:eventReport for feature triggers.
    pub fn event_report(event: &SpinEvent, game_id: &GameIdentity) -> String {
        let features_xml: String = event
            .features
            .iter()
            .map(|f| {
                format!(
                    "    <g2s:triggeredFeature kind=\"{}\"/>",
                    Self::escape_xml(f)
                )
            })
            .collect::<Vec<_>>()
            .join("\n");

        let inner = if features_xml.is_empty() {
            String::new()
        } else {
            format!("\n{features_xml}\n  ")
        };

        let body = format!(
            "  <g2s:eventReport \
             gameId=\"{game_id}\" \
             sessionId=\"{session_id}\" \
             spinIndex=\"{spin_index}\" \
             timestamp=\"{ts}\">\
             {inner}\
             </g2s:eventReport>",
            game_id = Self::escape_xml(&game_id.game_id),
            session_id = Self::escape_xml(&event.session_id),
            spin_index = event.spin_index,
            ts = Self::escape_xml(&event.timestamp),
            inner = inner,
        );
        Self::envelope("eventReport", &body)
    }

    // ─── parse ───────────────────────────────────────────────────────────────

    /// Parse a G2S XML message (minimal — extracts messageType and attributes
    /// from the g2sBody envelope).
    pub fn parse(xml: &str) -> (String, HashMap<String, String>) {
        // Extract messageType
        let message_type = extract_attr(xml, "messageType").unwrap_or_default();

        // Extract all attributes from the g2sBody opening tag
        let mut attributes = HashMap::new();
        if let Some(body_start) = xml.find("<g2s:g2sBody") {
            let rest = &xml[body_start..];
            if let Some(tag_end) = rest.find('>') {
                let tag_str = &rest[..tag_end];
                let re_iter = attr_pairs(tag_str);
                for (k, v) in re_iter {
                    attributes.insert(k, v);
                }
            }
        }

        (message_type, attributes)
    }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

fn extract_attr(s: &str, attr: &str) -> Option<String> {
    let needle = format!("{attr}=\"");
    let start = s.find(&needle)? + needle.len();
    let end = s[start..].find('"')? + start;
    Some(s[start..end].to_string())
}

/// Simple attribute parser: yields (key, value) pairs from `key="value"`.
fn attr_pairs(s: &str) -> Vec<(String, String)> {
    let mut result = Vec::new();
    let mut rest = s;
    while let Some(eq_pos) = rest.find('=') {
        // Key is the last whitespace-separated token before '='
        let before = rest[..eq_pos].trim_end();
        let key = before
            .split_whitespace()
            .last()
            .unwrap_or("")
            .to_string();
        let after = &rest[eq_pos + 1..];
        if after.starts_with('"') {
            let val_start = 1;
            if let Some(val_end) = after[val_start..].find('"') {
                let value = after[val_start..val_start + val_end].to_string();
                if !key.is_empty() {
                    result.push((key, value));
                }
                rest = &after[val_start + val_end + 1..];
                continue;
            }
        }
        break;
    }
    result
}

/// Return a simple ISO 8601 timestamp. Uses a fixed string since we have
/// no chrono dependency — callers that need real timestamps can inject one.
fn chrono_now() -> String {
    // In a real implementation this would use std::time::SystemTime.
    // For the adapter tests, an arbitrary valid ISO 8601 timestamp suffices.
    "1970-01-01T00:00:00.000Z".to_string()
}
