use slot_sim::{
    config::{GameConfig, PayEntry, ReelWeight},
    rng::SlotRng,
    speed::{AliasTable, PackedGridGenerator, ZeroAllocEvaluator},
};
use std::collections::HashMap;

fn make_config() -> GameConfig {
    let mut cfg = GameConfig::default();
    cfg.paylines = vec![
        vec![1u8, 1, 1, 1, 1],
        vec![0u8, 0, 0, 0, 0],
        vec![2u8, 2, 2, 2, 2],
        vec![0u8, 1, 2, 1, 0],
        vec![2u8, 1, 0, 1, 2],
    ];
    cfg.paytable = HashMap::from([
        (
            "W".to_string(),
            PayEntry {
                pay3: 10.0,
                pay4: 50.0,
                pay5: 200.0,
            },
        ),
        (
            "H1".to_string(),
            PayEntry {
                pay3: 5.0,
                pay4: 25.0,
                pay5: 100.0,
            },
        ),
        (
            "L1".to_string(),
            PayEntry {
                pay3: 2.0,
                pay4: 10.0,
                pay5: 40.0,
            },
        ),
    ]);
    let rw = vec![
        ReelWeight {
            symbol: "W".to_string(),
            weight: 2,
        },
        ReelWeight {
            symbol: "H1".to_string(),
            weight: 10,
        },
        ReelWeight {
            symbol: "L1".to_string(),
            weight: 30,
        },
        ReelWeight {
            symbol: "S".to_string(),
            weight: 3,
        },
        ReelWeight {
            symbol: "B".to_string(),
            weight: 5,
        },
    ];
    cfg.base_weights = vec![rw.clone(); 5];
    cfg.fs_weights = vec![rw; 5];
    cfg
}

fn main() {
    let cfg = make_config();
    let gen = PackedGridGenerator::from_config(&cfg);
    let eval = ZeroAllocEvaluator::from_config(&cfg);
    let bet_mc = 1_000i64;

    let mut rng = SlotRng::new(42);
    println!("=== Seed 42, first 10 spins ===");
    let mut total = 0i64;
    let mut wins: Vec<i64> = Vec::new();
    for i in 0..10 {
        let grid = gen.generate_base(&mut rng);
        let res = eval.eval_lines(grid, bet_mc);
        println!(
            "spin {:2}: base_win={:>8} scatter={} bonus={} fs={} hnw={}",
            i,
            res.base_win,
            res.scatter_count,
            res.bonus_count,
            res.fs_triggered,
            res.hnw_triggered
        );
        total += res.base_win;
        wins.push(res.base_win);
    }
    println!("total: {total}");
    println!("wins_array: {:?}", wins);

    let mut rng = SlotRng::new(999_999);
    let n = 100_000u64;
    let mut total_win = 0i64;
    let mut scatter_triggers = 0u64;
    let mut hnw_triggers = 0u64;
    let mut hit_count = 0u64;
    for _ in 0..n {
        let grid = gen.generate_base(&mut rng);
        let res = eval.eval_lines(grid, bet_mc);
        total_win += res.base_win;
        if res.base_win > 0 {
            hit_count += 1;
        }
        if res.fs_triggered {
            scatter_triggers += 1;
        }
        if res.hnw_triggered {
            hnw_triggers += 1;
        }
    }
    let total_bet = (n as i64) * bet_mc;
    let rtp = total_win as f64 / total_bet as f64 * 100.0;
    println!("\n=== 100k spins, seed 999999 ===");
    println!("total_win={total_win}");
    println!("total_bet={total_bet}");
    println!("rtp={rtp:.6}");
    println!("hit_count={hit_count}");
    println!("scatter_triggers={scatter_triggers}");
    println!("hnw_triggers={hnw_triggers}");

    let entries = [(0u8, 2), (1u8, 10), (2u8, 30), (3u8, 3), (4u8, 5)];
    let t = AliasTable::build(&entries);
    let total_w: u32 = entries.iter().map(|(_, w)| w).sum();
    println!("\n=== AliasTable marginals ===");
    for (i, (_, w)) in entries.iter().enumerate() {
        let mp = t.marginal_probability(i as u8);
        let expected = *w as f64 / total_w as f64;
        println!("sym_{i}_marginal={mp:.10}");
        println!("sym_{i}_expected={expected:.10}");
    }
}
