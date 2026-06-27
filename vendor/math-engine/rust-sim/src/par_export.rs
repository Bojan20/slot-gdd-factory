//! PAR-007 + PAR-008 — USIF v1.0 JSON exporter + CSV (regulator-flat) exporter.
//!
//! USIF (Universal Slot Information Format) v1.0 lives in
//! `dist/par-sample-kit/schema/USIF_PAR_SCHEMA_v1.md` on the TS side and is
//! validated by `scripts/usif-par-validate.mjs`. This module maps our native
//! [`PARSheet`] onto the USIF field tree so the same sheet can be submitted
//! to any USIF-compliant regulator pipeline without bespoke conversion code.
//!
//! CSV exporter follows RFC 4180 (CRLF endings, quoted-field escaping) so the
//! output drops straight into Excel / regulator spreadsheets.

use crate::par::PARSheet;
use serde_json::json;

// ─── PAR-007 — USIF v1.0 JSON exporter ─────────────────────────────────────

/// Convert a native PAR sheet into USIF v1.0 shape.
///
/// Field paths mirror the schema doc (camelCase, nested) so the TS
/// validator accepts the output unchanged.
pub fn to_usif_v1(par: &PARSheet) -> serde_json::Value {
    json!({
        "schemaVersion": "1.0.0",
        "generatedAt": par.meta.generated_at_utc,
        "configHash": par.meta.config_hash,
        "game": {
            "id": par.meta.game_id,
            "version": par.meta.game_version,
            "engineVersion": par.meta.engine_version,
        },
        "rng": par.rng_attestation.as_ref().map(|r| json!({
            "kind": r.kind,
            "period": r.period,
            "seedHex": r.seed_hex,
            "tests": {
                "diehard": format!("{:?}", r.tests.diehard).to_lowercase(),
                "nistSp80022": format!("{:?}", r.tests.nist_sp_800_22).to_lowercase(),
                "chiSquare": format!("{:?}", r.tests.chi_square).to_lowercase(),
            },
        })),
        "results": {
            "observedRtp": par.rtp.total_rtp_pct,
            "targetRtp": par.rtp.target_rtp_pct,
            "baseRtp": par.rtp.base_rtp_pct,
            "freeSpinsRtp": par.rtp.free_spins_rtp_pct,
            "holdAndWinRtp": par.rtp.hold_and_win_rtp_pct,
            "cascadeRtp": par.rtp.cascade_rtp_pct,
            "jackpotRtp": par.rtp.jackpot_rtp_pct,
            "withinTolerance": par.rtp.within_tolerance,
        },
        "volatility": {
            "category": par.volatility.category,
            "cv": par.volatility.cv,
            "variance": par.volatility.variance,
            "stdDev": par.volatility.std_dev,
            "maxWinX": par.volatility.max_win_x,
            "p50": par.quantiles.p50,
            "p90": par.quantiles.p90,
            "p99": par.quantiles.p99,
            "p999": par.quantiles.p999,
            "paretoTail": {
                "kind": format!("{:?}", par.pareto_tail.kind).to_lowercase(),
                "alpha": par.pareto_tail.alpha,
                "threshold": par.pareto_tail.threshold,
                "samplesAboveThreshold": par.pareto_tail.samples_above_threshold,
                "ksPValue": par.pareto_tail.ks_p_value,
                "evtP99999": par.pareto_tail.evt_p99999,
                "capPressurePct": par.pareto_tail.cap_pressure_pct,
            },
        },
        "hitFrequency": {
            "overall": par.hit_frequency.overall_hit_rate_pct,
            "base": par.hit_frequency.base_hit_rate_pct,
            "perFeature": par.hit_frequency.feature_freq,
        },
        "moments": {
            "mean": par.moments.mean_win_x,
            "variance": par.moments.variance,
            "stdDev": par.moments.std_dev,
            "skewness": par.moments.skewness,
            "excessKurtosis": par.moments.excess_kurtosis,
            "sampleCount": par.moments.sample_count,
        },
        "features": {
            "timeToTrigger": par.time_to_trigger.features.iter().map(|c| json!({
                "featureId": c.feature_id,
                "nSamples": c.n_samples,
                "meanDistance": c.mean_distance,
                "maxDistance": c.max_distance,
                "cdf": c.points.iter().map(|p| json!({
                    "spinIndex": p.spin_index,
                    "probability": p.probability,
                })).collect::<Vec<_>>(),
            })).collect::<Vec<_>>(),
        },
        "markov": {
            "states": par.markov.states,
            "transitionMatrix": par.markov.transition_matrix,
            "stationaryPi": par.markov.stationary_pi,
            "expectedDwell": par.markov.expected_dwell,
        },
        "jurisdictionGated": par.jurisdiction_gated.variants.iter().map(|v| json!({
            "code": v.code,
            "name": v.name,
            "theoreticalRtp": v.theoretical_rtp,
            "simulatedRtp": v.simulated_rtp,
            "deltaPp": v.delta_pp,
            "regulatoryMin": v.regulatory_min,
            "regulatoryMax": v.regulatory_max,
            "pass": v.pass,
            "withinCi95": v.within_ci_95,
        })).collect::<Vec<_>>(),
        "varianceDecomposition": {
            "totalVariance": par.variance_decomp.total_variance,
            "baseGame": par.variance_decomp.base_game_variance,
            "freeSpins": par.variance_decomp.free_spins_variance,
            "holdAndWin": par.variance_decomp.hold_and_win_variance,
            "cascade": par.variance_decomp.cascade_variance,
            "jackpot": par.variance_decomp.jackpot_variance,
            "interactionResidual": par.variance_decomp.interaction_residual,
            "sharePct": par.variance_decomp.share_pct,
        },
        "ciBands": {
            "ci95": [par.statistics.ci_95_low, par.statistics.ci_95_high],
            "ci99": [par.statistics.ci_99_low, par.statistics.ci_99_high],
            "ci999": [par.statistics.ci_999_low, par.statistics.ci_999_high],
            "stdError": par.statistics.std_error,
            "confidenceAdequate": par.statistics.confidence_adequate,
        },
        "bonusBuy": par.bonus_buy.offers.iter().map(|b| json!({
            "id": b.id,
            "guaranteed": b.guaranteed,
            "costX": b.cost_x,
            "featureEvX": b.feature_ev_x,
            "premiumPct": b.premium_pct,
            "effectiveRtpPct": b.effective_rtp_pct,
            "regulatoryWarn": b.regulatory_warn,
        })).collect::<Vec<_>>(),
    })
}

// ─── PAR-008 — CSV (RFC 4180) exporter ─────────────────────────────────────

/// One row per metric. Columns: Section, Metric, Value, Unit, Notes.
pub fn to_csv(par: &PARSheet) -> String {
    let mut out = String::new();
    out.push_str("Section,Metric,Value,Unit,Notes\r\n");
    let row = |s: &mut String, sec: &str, metric: &str, value: &str, unit: &str, notes: &str| {
        s.push_str(&csv_field(sec));
        s.push(',');
        s.push_str(&csv_field(metric));
        s.push(',');
        s.push_str(&csv_field(value));
        s.push(',');
        s.push_str(&csv_field(unit));
        s.push(',');
        s.push_str(&csv_field(notes));
        s.push_str("\r\n");
    };

    row(&mut out, "Meta", "game_id", &par.meta.game_id, "", "");
    row(&mut out, "Meta", "game_version", &par.meta.game_version, "", "");
    row(&mut out, "Meta", "engine_version", &par.meta.engine_version, "", "");
    row(&mut out, "Meta", "total_spins", &par.meta.total_spins.to_string(), "", "");
    row(&mut out, "Meta", "rng_kind", &par.meta.rng_kind, "", "");
    row(&mut out, "Meta", "config_hash", &par.meta.config_hash, "sha256-hex", "");

    row(&mut out, "RTP", "total", &fmt4(par.rtp.total_rtp_pct), "%", "");
    row(&mut out, "RTP", "base_game", &fmt4(par.rtp.base_rtp_pct), "%", "");
    row(&mut out, "RTP", "free_spins", &fmt4(par.rtp.free_spins_rtp_pct), "%", "");
    row(&mut out, "RTP", "hold_and_win", &fmt4(par.rtp.hold_and_win_rtp_pct), "%", "");
    row(&mut out, "RTP", "jackpot", &fmt4(par.rtp.jackpot_rtp_pct), "%", "");
    row(&mut out, "RTP", "target", &fmt4(par.rtp.target_rtp_pct), "%", "");

    row(&mut out, "HitFreq", "overall", &fmt4(par.hit_frequency.overall_hit_rate_pct), "%", "");
    row(&mut out, "HitFreq", "base", &fmt4(par.hit_frequency.base_hit_rate_pct), "%", "");

    row(&mut out, "Volatility", "category", &par.volatility.category, "", "");
    row(&mut out, "Volatility", "cv", &fmt4(par.volatility.cv), "", "");
    row(&mut out, "Volatility", "std_dev", &fmt4(par.volatility.std_dev), "bet_x", "");
    row(&mut out, "Volatility", "max_win_x", &fmt4(par.volatility.max_win_x), "bet_x", "");

    row(&mut out, "Quantiles", "p50", &fmt4(par.quantiles.p50), "bet_x", "");
    row(&mut out, "Quantiles", "p90", &fmt4(par.quantiles.p90), "bet_x", "");
    row(&mut out, "Quantiles", "p99", &fmt4(par.quantiles.p99), "bet_x", "");
    row(&mut out, "Quantiles", "p999", &fmt4(par.quantiles.p999), "bet_x", "");

    row(&mut out, "EvtPareto", "alpha", &fmt4(par.pareto_tail.alpha), "", &format!("{:?}", par.pareto_tail.kind));
    row(&mut out, "EvtPareto", "evt_p99999", &fmt4(par.pareto_tail.evt_p99999), "bet_x", "");
    row(&mut out, "EvtPareto", "cap_pressure_pct", &fmt4(par.pareto_tail.cap_pressure_pct), "%", "");

    for v in &par.jurisdiction_gated.variants {
        row(
            &mut out,
            "Jurisdiction",
            &format!("{}_pass", v.code),
            &v.pass.to_string(),
            "",
            &format!("band [{:.2}%, {:.2}%]", v.regulatory_min, v.regulatory_max),
        );
        row(
            &mut out,
            "Jurisdiction",
            &format!("{}_within_ci95", v.code),
            &v.within_ci_95.to_string(),
            "",
            &format!("delta={:+.4}pp", v.delta_pp),
        );
    }

    for b in &par.bonus_buy.offers {
        row(
            &mut out,
            "BonusBuy",
            &format!("{}_premium_pct", b.id),
            &fmt4(b.premium_pct),
            "%",
            &format!("cost {}x, warn={}", b.cost_x, b.regulatory_warn),
        );
    }

    row(&mut out, "Statistics", "ci95_low", &fmt4(par.statistics.ci_95_low), "%", "");
    row(&mut out, "Statistics", "ci95_high", &fmt4(par.statistics.ci_95_high), "%", "");
    row(&mut out, "Statistics", "std_error", &fmt4(par.statistics.std_error), "pp", "");

    out
}

// ─── PAR-009 — Markdown report (pandoc-ready for PDF render) ───────────────

/// Emit a PDF-ready Markdown report. Convert downstream with
/// `pandoc out.md -o par.pdf` (any LaTeX engine or `wkhtmltopdf`).
///
/// We deliberately avoid bundling `printpdf` (requires Rust 1.88) — Markdown
/// is more portable, regulator-friendly, and the LaTeX template fixes layout
/// once for every game built.
pub fn to_markdown_report(par: &PARSheet) -> String {
    let mut out = String::new();
    out.push_str(&format!(
        "# PAR Sheet — {} v{}\n\n",
        par.meta.game_id, par.meta.game_version
    ));
    out.push_str(&format!("- **Engine:** {}\n", par.meta.engine_version));
    out.push_str(&format!("- **Generated:** {}\n", par.meta.generated_at_utc));
    out.push_str(&format!(
        "- **Total spins:** {}  ·  **Seeds:** {}\n",
        par.meta.total_spins, par.meta.seeds_used
    ));
    if !par.meta.config_hash.is_empty() {
        out.push_str(&format!(
            "- **Config hash (SHA-256):** `{}`\n",
            par.meta.config_hash
        ));
    }
    out.push_str(&format!("- **RNG family:** `{}`\n\n", par.meta.rng_kind));

    if let Some(so) = &par.sign_off {
        out.push_str("## Sign-off\n\n");
        if let Some(m) = &so.mathematician {
            out.push_str(&format!("- Mathematician: **{m}**\n"));
        }
        if let Some(a) = &so.approved_by {
            out.push_str(&format!("- Approved by: **{a}**\n"));
        }
        out.push('\n');
    }

    out.push_str("## RTP\n\n");
    out.push_str("| Component | Value |\n|---|---:|\n");
    out.push_str(&format!("| Total | {:.4}% |\n", par.rtp.total_rtp_pct));
    out.push_str(&format!("| Base game | {:.4}% |\n", par.rtp.base_rtp_pct));
    out.push_str(&format!("| Free spins | {:.4}% |\n", par.rtp.free_spins_rtp_pct));
    out.push_str(&format!("| Hold & Win | {:.4}% |\n", par.rtp.hold_and_win_rtp_pct));
    out.push_str(&format!(
        "| Target | {:.4}% (±{:.4}%) |\n",
        par.rtp.target_rtp_pct, par.rtp.rtp_tolerance_pct
    ));
    out.push_str(&format!(
        "| Within tolerance? | {} |\n\n",
        if par.rtp.within_tolerance { "✅" } else { "❌" }
    ));

    out.push_str("## Volatility & Tails\n\n");
    out.push_str(&format!(
        "- Category: **{}**  ·  CV: {:.4}  ·  σ: {:.4}\n",
        par.volatility.category, par.volatility.cv, par.volatility.std_dev
    ));
    out.push_str(&format!(
        "- Quantiles — P50: {:.2}x · P90: {:.2}x · P99: {:.2}x · P99.9: {:.2}x\n",
        par.quantiles.p50, par.quantiles.p90, par.quantiles.p99, par.quantiles.p999
    ));
    out.push_str(&format!(
        "- EVT Pareto — α̂: {:.4}  ·  P99.999: {:.2}x  ·  cap pressure: {:.4}%\n\n",
        par.pareto_tail.alpha, par.pareto_tail.evt_p99999, par.pareto_tail.cap_pressure_pct
    ));

    if !par.jurisdiction_gated.variants.is_empty() {
        out.push_str("## Jurisdiction gating\n\n");
        out.push_str("| Code | Sim RTP | Theo RTP | Δpp | Band | CI95 |\n|---|---:|---:|---:|:---:|:---:|\n");
        for v in &par.jurisdiction_gated.variants {
            out.push_str(&format!(
                "| {} | {:.4}% | {:.4}% | {:+.4} | {} | {} |\n",
                v.code,
                v.simulated_rtp,
                v.theoretical_rtp,
                v.delta_pp,
                if v.pass { "✅" } else { "❌" },
                if v.within_ci_95 { "✅" } else { "❌" }
            ));
        }
        out.push('\n');
    }

    if !par.markov.states.is_empty() {
        out.push_str("## Markov state model\n\n");
        out.push_str("| State | π | Expected dwell |\n|---|---:|---:|\n");
        for (i, s) in par.markov.states.iter().enumerate() {
            out.push_str(&format!(
                "| {} | {:.4} | {:.2} |\n",
                s, par.markov.stationary_pi[i], par.markov.expected_dwell[i]
            ));
        }
        out.push('\n');
    }

    out.push_str("## Statistical confidence\n\n");
    out.push_str(&format!(
        "- CI95: [{:.4}%, {:.4}%]\n- CI99: [{:.4}%, {:.4}%]\n- CI99.9: [{:.4}%, {:.4}%]\n",
        par.statistics.ci_95_low,
        par.statistics.ci_95_high,
        par.statistics.ci_99_low,
        par.statistics.ci_99_high,
        par.statistics.ci_999_low,
        par.statistics.ci_999_high
    ));
    out.push_str(&format!(
        "- Std error: {:.4}pp ({})\n",
        par.statistics.std_error,
        if par.statistics.confidence_adequate {
            "adequate"
        } else {
            "INSUFFICIENT"
        }
    ));

    out
}

/// RFC 4180 — quote if field contains comma, quote, or CRLF; double-up internal quotes.
fn csv_field(s: &str) -> String {
    if s.contains(',') || s.contains('"') || s.contains('\r') || s.contains('\n') {
        let escaped = s.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        s.to_string()
    }
}

fn fmt4(v: f64) -> String {
    format!("{v:.4}")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn csv_quotes_fields_with_commas() {
        assert_eq!(csv_field("hello, world"), "\"hello, world\"");
        assert_eq!(csv_field("normal"), "normal");
        assert_eq!(csv_field("with\"quote"), "\"with\"\"quote\"");
    }
}
