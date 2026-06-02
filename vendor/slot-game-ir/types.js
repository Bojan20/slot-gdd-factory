/**
 * Slot Game IR — TypeScript types.
 *
 * One canonical type tree the entire TS pipeline (preview engine, MC
 * simulator, analytical solver, PAR generator, parity comparator)
 * consumes. The Rust side keeps a mirror in `rust-sim/src/ir/types.rs`
 * — every field name here must match the Rust serde name exactly, or
 * the Faza 10.3 parity gate fails.
 *
 * No runtime logic in this file — runtime validation lives in
 * `schema.ts`, defaults / coercions live in `index.ts`. Keeping them
 * separate means a consumer can `import type { ... }` without pulling
 * Zod into the bundle.
 *
 * Spec: see `docs/IR_SPEC.md` for the formal definition.
 */
export {};
//# sourceMappingURL=types.js.map