//! W244 wave 34 — kernel parity CLI tool.
//!
//! Reads JSON kernel input from stdin, computes the result via the
//! Rust port, emits JSON result on stdout. Used by
//! `tools/parity/w244_rust_python_parity.py` to assert byte-equivalence
//! between Python and Rust math kernel implementations.
//!
//! Usage:
//!   $ echo '{"kernel": "charge_meter", "params": {...}}' | \
//!         target/release/kernel_parity
//!   {"rtp_contribution": 0.10, ...}

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};

use slot_sim::kernels::{
    asymmetric_paytable, both_ways, buy_feature, cascade, charge_meter,
    cluster_pays, expanding_symbol, hold_and_win, money_collect, must_hit_by,
    pay_anywhere, persistent_multiplier, pick_chain, stacked_wilds,
    state_machine, sticky_wilds, ways_evaluator, wheel,
};

#[derive(Debug, Deserialize)]
struct Request {
    kernel: String,
    params: serde_json::Value,
}

#[derive(Debug, Serialize)]
struct ErrResponse {
    error: String,
}

fn run(req: Request) -> Result<serde_json::Value, String> {
    match req.kernel.as_str() {
        "charge_meter" => {
            let p: charge_meter::ChargeMeterParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(charge_meter::charge_meter_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "must_hit_by" => {
            let p: must_hit_by::MustHitByParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(must_hit_by::must_hit_by_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "stacked_wilds" => {
            let p: stacked_wilds::StackedWildsParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(stacked_wilds::stacked_wilds_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "both_ways" => {
            let p: both_ways::BothWaysParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(both_ways::both_ways_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "pay_anywhere" => {
            let p: pay_anywhere::PayAnywhereParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(pay_anywhere::pay_anywhere_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "cluster_pays" => {
            let p: cluster_pays::ClusterPaysParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(cluster_pays::cluster_pays_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "cascade" => {
            let p: cascade::CascadeParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(cascade::cascade_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "money_collect" => {
            let p: money_collect::MoneyCollectParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(money_collect::money_collect_rtp_contribution(&p))
                .map_err(|e| e.to_string())?)
        }
        "expanding_symbol" => {
            let p: expanding_symbol::ExpandingSymbolParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(expanding_symbol::expanding_symbol_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "wheel" => {
            let p: wheel::WheelParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(wheel::wheel_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "state_machine" => {
            let p: state_machine::StateMachineParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(state_machine::state_machine_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "persistent_multiplier" => {
            let p: persistent_multiplier::PersistentMultiplierParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(persistent_multiplier::persistent_multiplier_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "asymmetric_paytable" => {
            let p: asymmetric_paytable::AsymmetricPaytableParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(asymmetric_paytable::asymmetric_paytable_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "ways_evaluator" => {
            let p: ways_evaluator::WaysEvaluatorParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(ways_evaluator::ways_evaluator_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "sticky_wilds" => {
            let p: sticky_wilds::StickyWildsParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(sticky_wilds::sticky_wilds_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "pick_chain" => {
            let p: pick_chain::PickChainParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(pick_chain::pick_chain_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        "buy_feature" => {
            let p: buy_feature::BuyFeatureParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(buy_feature::buy_feature_audit(&p))
                .map_err(|e| e.to_string())?)
        }
        "hold_and_win" => {
            let p: hold_and_win::HoldAndWinParams =
                serde_json::from_value(req.params)
                    .map_err(|e| format!("parse: {}", e))?;
            p.validate()?;
            Ok(serde_json::to_value(hold_and_win::hold_and_win_rtp(&p))
                .map_err(|e| e.to_string())?)
        }
        other => Err(format!("unknown kernel: {}", other)),
    }
}

fn main() {
    let mut input = String::new();
    if io::stdin().read_to_string(&mut input).is_err() {
        eprintln!("failed to read stdin");
        std::process::exit(2);
    }
    let req: Request = match serde_json::from_str(&input) {
        Ok(r) => r,
        Err(e) => {
            let err = ErrResponse { error: format!("parse request: {}", e) };
            println!("{}", serde_json::to_string(&err).unwrap());
            std::process::exit(1);
        }
    };
    match run(req) {
        Ok(result) => {
            let stdout = io::stdout();
            let mut handle = stdout.lock();
            writeln!(handle, "{}", serde_json::to_string(&result).unwrap())
                .ok();
        }
        Err(e) => {
            let err = ErrResponse { error: e };
            println!("{}", serde_json::to_string(&err).unwrap());
            std::process::exit(1);
        }
    }
}
