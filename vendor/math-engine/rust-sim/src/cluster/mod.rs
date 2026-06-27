//! Distributed bulk simulation — Faza 9.8 cluster mode.
//!
//! When 1T spinova/sec acceptance target needs more than a single box,
//! the dispatcher partitions the run across N workers. The coordinator
//! holds the canonical `BulkConfig`, hands each worker a disjoint
//! `WorkSlice`, collects per-slice results, and merges them into the
//! same `AtomicStats` shape the single-machine `BulkDispatcher` returns.
//!
//! ## Determinism contract
//!
//! Every slice has a fully-defined RNG schedule keyed off
//! `(base_seed, slice_index)`. Two coordinators with the same
//! `BulkConfig` partition the work identically, so the merged result
//! is bit-identical regardless of whether the run executed on 1 box
//! or 16.
//!
//! ## Wire format
//!
//! Newline-delimited JSON over TCP. Each direction sends one envelope
//! per message — coordinator → worker `Assign { slice }`,
//! worker → coordinator `Joined`, `Progress`, `Done { result }`.
//! Tiny payloads, easy to capture in tcpdump or pipe through `jq`.
//!
//! This module ships the **protocol types + slicing logic + a pure
//! coordinator function** that doesn't open a socket. The actual TCP
//! transport scaffold lives in `transport.rs` so it can be swapped for
//! gRPC / NATS / in-process channel without touching the slicing logic.

pub mod coordinator;
pub mod protocol;
pub mod transport;

pub use coordinator::{merge_slice_results, partition_run, ClusterCoordinator, SliceResult};
pub use protocol::{
    ClusterEnvelope, ClusterError, ProgressFrame, WorkSlice, WorkerHello, WorkerResult,
    CLUSTER_PROTOCOL_VERSION,
};
pub use transport::{ClusterTransport, InMemoryTransport, TcpTransport};
