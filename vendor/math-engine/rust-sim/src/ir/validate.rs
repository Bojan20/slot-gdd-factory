//! Cross-validation for `SlotGameIR`.
//!
//! Serde catches shape errors at parse time. Once we have a valid shape
//! there's still a layer of semantic checks before the engine can trust
//! the config: referential integrity (every symbol id used by paytable /
//! reels / features must exist in `symbols[]`), topology↔evaluation
//! coherence, paytable shape vs. evaluation kind, RTP-allocation sum,
//! feature-symbol dependencies.
//!
//! Mirrors `src/ir/index.ts::crossValidate` line-for-line — the
//! integration test in `tests/ir_roundtrip.rs` asserts both implementations
//! produce the same issue list for the same input.

use super::*;

/// A validation finding. `path` is a JSON-Pointer-ish string starting
/// with `/`. The TS side emits the same shape so issues are comparable
/// across engines in the parity gate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IRValidationIssue {
    pub path: String,
    pub message: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ValidationReport {
    pub errors: Vec<IRValidationIssue>,
    pub warnings: Vec<IRValidationIssue>,
}

pub fn cross_validate(ir: &SlotGameIR) -> ValidationReport {
    let mut errors = Vec::<IRValidationIssue>::new();
    let mut warnings = Vec::<IRValidationIssue>::new();

    use std::collections::HashSet;
    let sym_ids: HashSet<&str> = ir.symbols.iter().map(|s| s.id.as_str()).collect();

    // ── Symbol uniqueness ──────────────────────────────────────────────
    // Mirrors `src/ir/index.ts::crossValidate` — duplicate ids silently
    // collapse in the symbol map and cause shadowed-symbol RTP drift.
    if sym_ids.len() != ir.symbols.len() {
        let mut seen = HashSet::<&str>::new();
        for (i, sym) in ir.symbols.iter().enumerate() {
            if seen.contains(sym.id.as_str()) {
                errors.push(issue(
                    &format!("/symbols/{i}/id"),
                    &format!(
                        "duplicate symbol id '{}' — symbol ids must be unique",
                        sym.id
                    ),
                ));
            }
            seen.insert(sym.id.as_str());
        }
    }

    // ── Symbol referential integrity ────────────────────────────────────
    for sym in ir.paytable.keys() {
        if !sym_ids.contains(sym.as_str()) {
            errors.push(issue(
                &format!("/paytable/{sym}"),
                &format!("unknown symbol id '{sym}'"),
            ));
        }
    }
    match &ir.reels {
        ReelSet::Weighted { base, free_spins } => {
            for (reel, map) in base.iter().enumerate() {
                for k in map.keys() {
                    if !sym_ids.contains(k.as_str()) {
                        errors.push(issue(
                            &format!("/reels/base/{reel}/{k}"),
                            &format!("unknown symbol id '{k}' on reel {reel}"),
                        ));
                    }
                }
            }
            if let Some(fs) = free_spins {
                for (reel, map) in fs.iter().enumerate() {
                    for k in map.keys() {
                        if !sym_ids.contains(k.as_str()) {
                            errors.push(issue(
                                &format!("/reels/free_spins/{reel}/{k}"),
                                &format!("unknown symbol id '{k}' on FS reel {reel}"),
                            ));
                        }
                    }
                }
            }
        }
        ReelSet::Strips {
            base,
            free_spins: _,
        } => {
            for (reel, strip) in base.iter().enumerate() {
                for (idx, s) in strip.iter().enumerate() {
                    if !sym_ids.contains(s.as_str()) {
                        errors.push(issue(
                            &format!("/reels/base/{reel}/{idx}"),
                            &format!("unknown symbol id '{s}' at reel {reel} stop {idx}"),
                        ));
                    }
                }
            }
        }
    }
    for sym in &ir.symbols {
        if let Some(Substitutes::List(list)) = &sym.substitutes {
            for t in list {
                if !sym_ids.contains(t.as_str()) {
                    errors.push(issue(
                        &format!("/symbols/{}/substitutes", sym.id),
                        &format!("unknown substitute '{t}'"),
                    ));
                }
            }
        }
    }

    // ── Topology ↔ evaluation coherence ────────────────────────────────
    eval_topology_coherence(&ir.topology, &ir.evaluation, &mut errors);

    // ── Paytable shape ↔ evaluation kind ──────────────────────────────
    paytable_shape_check(&ir.paytable, &ir.evaluation, &mut errors);

    // ── RTP allocation ≈ target_rtp ───────────────────────────────────
    let alloc = &ir.rtp_allocation;
    let sum = alloc.base_game + alloc.free_spins + alloc.hold_and_win + alloc.jackpot;
    if (sum - ir.limits.target_rtp).abs() > alloc.tolerance {
        errors.push(issue(
            "/rtp_allocation",
            &format!(
                "sum {sum:.4} differs from target_rtp {} by more than tolerance {}",
                ir.limits.target_rtp, alloc.tolerance
            ),
        ));
    }

    // ── Feature ↔ symbol dependency ──────────────────────────────────
    for (i, feat) in ir.features.iter().enumerate() {
        match feat {
            Feature::HoldAndWin { .. } => {
                if !ir.symbols.iter().any(|s| s.kind == SymbolKind::Bonus) {
                    errors.push(issue(
                        &format!("/features/{i}"),
                        "hold_and_win declared but no bonus symbol exists in /symbols",
                    ));
                }
            }
            Feature::FreeSpins { trigger, .. } => {
                if matches!(trigger.by, TriggerBy::ScatterCount)
                    && !ir.symbols.iter().any(|s| s.kind == SymbolKind::Scatter)
                {
                    errors.push(issue(
                        &format!("/features/{i}/trigger"),
                        "free_spins triggered by scatter_count but no scatter symbol exists",
                    ));
                }
            }
            Feature::MysterySymbol {
                symbol_id,
                reveal_distribution,
            } => {
                if !sym_ids.contains(symbol_id.as_str()) {
                    errors.push(issue(
                        &format!("/features/{i}/symbol_id"),
                        &format!("mystery_symbol references unknown symbol '{symbol_id}'"),
                    ));
                }
                for k in reveal_distribution.keys() {
                    if !sym_ids.contains(k.as_str()) {
                        errors.push(issue(
                            &format!("/features/{i}/reveal_distribution/{k}"),
                            &format!("unknown reveal target '{k}'"),
                        ));
                    }
                }
            }
            _ => {}
        }
    }

    // ── Compliance band sanity ────────────────────────────────────────
    let [rtp_lo, rtp_hi] = ir.compliance.rtp_range_required;
    if rtp_lo > rtp_hi {
        errors.push(issue(
            "/compliance/rtp_range_required",
            &format!("range lo ({rtp_lo}) > hi ({rtp_hi})"),
        ));
    }
    if ir.limits.target_rtp < rtp_lo || ir.limits.target_rtp > rtp_hi {
        warnings.push(issue(
            "/limits/target_rtp",
            &format!(
                "target_rtp {} outside compliance band [{rtp_lo}, {rtp_hi}]",
                ir.limits.target_rtp
            ),
        ));
    }
    if ir.limits.max_win_x > ir.compliance.max_win_cap_required {
        warnings.push(issue(
            "/limits/max_win_x",
            &format!(
                "max_win_x {} exceeds compliance cap {}",
                ir.limits.max_win_x, ir.compliance.max_win_cap_required
            ),
        ));
    }

    ValidationReport { errors, warnings }
}

fn issue(path: &str, message: &str) -> IRValidationIssue {
    IRValidationIssue {
        path: path.to_string(),
        message: message.to_string(),
    }
}

fn eval_topology_coherence(t: &Topology, e: &Evaluation, errors: &mut Vec<IRValidationIssue>) {
    match e {
        Evaluation::Lines { paylines, .. } => {
            let (reels, rows_opt) = match t {
                Topology::Rectangular { reels, rows } => (*reels, Some(*rows)),
                Topology::VariableRows { reels, .. } => (*reels, None),
                Topology::ClusterGrid { .. } => {
                    errors.push(issue(
                        "/evaluation",
                        "'lines' evaluation requires rectangular or variable_rows topology, got cluster_grid",
                    ));
                    return;
                }
            };
            for (i, pl) in paylines.iter().enumerate() {
                if pl.len() as u32 != reels {
                    errors.push(issue(
                        &format!("/evaluation/paylines/{i}"),
                        &format!("payline length {} ≠ reels {reels}", pl.len()),
                    ));
                }
                if let Some(rows) = rows_opt {
                    for (j, r) in pl.iter().enumerate() {
                        if *r >= rows {
                            errors.push(issue(
                                &format!("/evaluation/paylines/{i}/{j}"),
                                &format!("row index {r} out of range [0, {}]", rows - 1),
                            ));
                        }
                    }
                }
            }
        }
        Evaluation::Cluster { .. } => {
            if !matches!(t, Topology::ClusterGrid { .. }) {
                errors.push(issue(
                    "/evaluation",
                    "'cluster' evaluation requires cluster_grid topology",
                ));
            }
        }
        Evaluation::Ways { .. } => {
            if matches!(t, Topology::ClusterGrid { .. }) {
                errors.push(issue(
                    "/evaluation",
                    "'ways' evaluation incompatible with cluster_grid topology",
                ));
            }
        }
        _ => {}
    }
}

fn paytable_shape_check(p: &Paytable, e: &Evaluation, errors: &mut Vec<IRValidationIssue>) {
    if matches!(e, Evaluation::Lines { .. } | Evaluation::Ways { .. }) {
        for (sym, table) in p {
            for k in table.keys() {
                if !k.chars().all(|c| c.is_ascii_digit()) {
                    let kind = match e {
                        Evaluation::Lines { .. } => "lines",
                        Evaluation::Ways { .. } => "ways",
                        _ => unreachable!(),
                    };
                    errors.push(issue(
                        &format!("/paytable/{sym}/{k}"),
                        &format!(
                            "expected numeric OAK count key for '{kind}' evaluation, got '{k}'"
                        ),
                    ));
                }
            }
        }
    }
}
