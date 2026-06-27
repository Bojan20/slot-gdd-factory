//! Faza 3 — BehaviorRegistry mutation-kill tests (W238 hardening).
//!
//! Targets the 7 missed mutants from the W238 baseline run on
//! `rust-sim/src/behavior/registry.rs`:
//!
//! | # | Line | Mutation                                                       |
//! |---|------|----------------------------------------------------------------|
//! | 1 | L50  | `len() -> usize with 0`                                        |
//! | 2 | L50  | `len() -> usize with 1`                                        |
//! | 3 | L54  | `is_empty() -> bool with true`                                 |
//! | 4 | L54  | `is_empty() -> bool with false`                                |
//! | 5 | L58  | `symbol_ids() -> impl Iterator with ::std::iter::empty()`      |
//! | 6 | L58  | `symbol_ids() -> impl Iterator with ::std::iter::once("")`     |
//! | 7 | L58  | `symbol_ids() -> impl Iterator with ::std::iter::once("xyzzy")`|

use slot_sim::behavior::impls::WildBehavior;
use slot_sim::behavior::registry::BehaviorRegistry;

#[test]
fn w238_len_returns_actual_count_zero() {
    // Kills L50 `len() -> 1` (constant mutant).
    let reg = BehaviorRegistry::new();
    assert_eq!(reg.len(), 0, "empty registry must have len 0");
}

#[test]
fn w238_len_returns_actual_count_one() {
    // Kills L50 `len() -> 0` (constant mutant).
    let mut reg = BehaviorRegistry::new();
    reg.register("S_WILD", Box::new(WildBehavior { id: "S_WILD".into() }));
    assert_eq!(reg.len(), 1, "registry with one entry must have len 1");
}

#[test]
fn w238_len_returns_actual_count_three() {
    // Strengthens kill of L50 `len() -> 0 / 1` for non-trivial counts.
    let mut reg = BehaviorRegistry::new();
    reg.register("S_A", Box::new(WildBehavior { id: "S_A".into() }));
    reg.register("S_B", Box::new(WildBehavior { id: "S_B".into() }));
    reg.register("S_C", Box::new(WildBehavior { id: "S_C".into() }));
    assert_eq!(reg.len(), 3, "registry with three entries must have len 3");
}

#[test]
fn w238_is_empty_true_for_new_registry() {
    // Kills L54 `is_empty() -> false` (constant mutant).
    let reg = BehaviorRegistry::new();
    assert!(reg.is_empty(), "new registry must be empty");
    assert!(BehaviorRegistry::default().is_empty(), "default() must be empty");
}

#[test]
fn w238_is_empty_false_after_register() {
    // Kills L54 `is_empty() -> true` (constant mutant).
    let mut reg = BehaviorRegistry::new();
    reg.register("S_WILD", Box::new(WildBehavior { id: "S_WILD".into() }));
    assert!(!reg.is_empty(), "registry with one entry must NOT be empty");
}

#[test]
fn w238_symbol_ids_returns_actual_keys() {
    // Kills L58:
    //   * `::std::iter::empty()` → would yield 0 IDs (but registry has 3)
    //   * `::std::iter::once("")` → would yield 1 ID equal to ""
    //   * `::std::iter::once("xyzzy")` → would yield 1 ID equal to "xyzzy"
    let mut reg = BehaviorRegistry::new();
    reg.register("S_WILD", Box::new(WildBehavior { id: "S_WILD".into() }));
    reg.register("S_SCAT", Box::new(WildBehavior { id: "S_SCAT".into() }));
    reg.register("S_LP1", Box::new(WildBehavior { id: "S_LP1".into() }));

    let mut ids: Vec<&str> = reg.symbol_ids().collect();
    ids.sort();
    assert_eq!(
        ids,
        vec!["S_LP1", "S_SCAT", "S_WILD"],
        "symbol_ids() must yield the registered keys (mutant signatures: [], [\"\"], [\"xyzzy\"])"
    );
}

#[test]
fn w238_symbol_ids_empty_for_new_registry() {
    // Belt-and-suspenders: kills `::std::iter::once("")` and `::std::iter::once("xyzzy")`
    // even on empty registry where mutant would yield 1 item.
    let reg = BehaviorRegistry::new();
    let ids: Vec<&str> = reg.symbol_ids().collect();
    assert!(
        ids.is_empty(),
        "symbol_ids() must yield no items for empty registry (mutant signature: 1 item)"
    );
}

#[test]
fn w238_symbol_ids_no_phantom_xyzzy_or_empty_string() {
    // Direct kill for the `once("xyzzy")` and `once("")` mutants: assert
    // the iter NEVER contains these magic mutant strings.
    let mut reg = BehaviorRegistry::new();
    reg.register("S_REAL", Box::new(WildBehavior { id: "S_REAL".into() }));
    let ids: Vec<&str> = reg.symbol_ids().collect();
    assert!(!ids.contains(&"xyzzy"), "registry must not contain mutant phantom 'xyzzy'");
    assert!(!ids.contains(&""), "registry must not contain mutant phantom ''");
    assert!(ids.contains(&"S_REAL"), "registry must contain the real key 'S_REAL'");
}
