//! Faza 3 — Symbol Behavior Plugin Layer: Registry (Rust)
//!
//! Mirrors `src/behaviors/registry.ts`.

use super::types::SymbolBehavior;
use std::collections::HashMap;

/// Registry: symbol-id → Box<dyn SymbolBehavior>.
pub struct BehaviorRegistry {
    map: HashMap<String, Box<dyn SymbolBehavior>>,
}

impl BehaviorRegistry {
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    /// Register a behavior. Panics on duplicate.
    pub fn register(&mut self, symbol_id: impl Into<String>, behavior: Box<dyn SymbolBehavior>) {
        let id = symbol_id.into();
        if self.map.contains_key(&id) {
            panic!(
                "BehaviorRegistry: duplicate registration for symbol id \"{}\"",
                id
            );
        }
        self.map.insert(id, behavior);
    }

    /// Override (or add) a behavior.
    pub fn override_behavior(
        &mut self,
        symbol_id: impl Into<String>,
        behavior: Box<dyn SymbolBehavior>,
    ) {
        self.map.insert(symbol_id.into(), behavior);
    }

    pub fn get(&self, symbol_id: &str) -> Option<&dyn SymbolBehavior> {
        self.map.get(symbol_id).map(|b| b.as_ref())
    }

    pub fn has(&self, symbol_id: &str) -> bool {
        self.map.contains_key(symbol_id)
    }

    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn symbol_ids(&self) -> impl Iterator<Item = &str> {
        self.map.keys().map(|s| s.as_str())
    }
}

impl Default for BehaviorRegistry {
    fn default() -> Self {
        Self::new()
    }
}
