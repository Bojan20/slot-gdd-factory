"""W244 wave 21 — closed-form analytical model for `cluster_pays`.

Industry pattern (NetEnt Aloha Cluster Pays, Pragmatic Sweet Bonanza,
Pragmatic Gates of Olympus, BTG Money Cart, ELK Mystery Mish-Mash):

  Cluster-pays grid game
  ----------------------
    Grid (e.g. 5×3, 6×4, 7×7) with N symbols. After drop, BFS flood-fill
    finds CONNECTED REGIONS of same symbol (4-way orthogonal adjacency,
    or 8-way diagonal in some variants).

    A cluster of size ≥ `min_cluster_size` (typical 5) PAYS according to
    a per-symbol pay ladder indexed by cluster size:

      pay[symbol][cluster_size] = value × bet

    Multiple clusters per spin sum independently.

  Closed-form RTP contribution
  ----------------------------
    Closed-form for cluster size distribution from first principles
    (site percolation on a finite grid) is intractable in general. The
    industry-standard auditable approach is:

      1. Operator supplies an EMPIRICAL `cluster_size_distribution`
         per symbol, derived from PAR / MC ground truth.
      2. Kernel aggregates: RTP = sum_{sym, size}(
             p[sym][size] × pay[sym][size]
         )

    This shifts the "math complexity" boundary into the validated PAR
    data (where it belongs for regulator audit) and keeps the kernel
    a deterministic, auditable transformation.

  Output expectation per spin
  ---------------------------
    E[pay × bet | one spin] = sum over (symbol, cluster_size) of
        cluster_count_distribution[sym][size] × pay[sym][size]

    where `cluster_count_distribution[sym][size]` is the EXPECTED NUMBER
    of clusters of size `size` of symbol `sym` per spin (NOT probability;
    multiple clusters per spin can exist).

Pure-stdlib. Used by:
  * `tools.math_dsl.compile` for IR emission
  * `tools/build_cluster_pays_kernel.py` for acceptance artefact
  * `tools/tests/test_w244_cluster_pays_kernel.py` for closed-form pin
"""
from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class ClusterPaysParams:
    """Closed-form model inputs.

    Cluster distributions and pay tables are indexed by symbol id (str)
    then by cluster size (int).
    """
    # E[cluster_count_per_spin]: {symbol_id: {cluster_size: expected_count}}
    # Sourced from PAR or empirical MC; kernel does NOT compute these.
    cluster_count_distribution: dict[str, dict[int, float]]
    # Pay ladder: {symbol_id: {cluster_size: pay_x_bet}}
    pay_table: dict[str, dict[int, float]]
    # Minimum cluster size to qualify for pay (typical 5)
    min_cluster_size: int = 5
    # Grid topology for audit display
    grid_rows: int = 7
    grid_cols: int = 7
    # Adjacency rule for audit display ("4-way" / "8-way")
    adjacency: str = "4-way"

    def __post_init__(self):
        if self.min_cluster_size < 1:
            raise ValueError("min_cluster_size must be ≥ 1")
        if self.grid_rows < 1 or self.grid_cols < 1:
            raise ValueError("grid dimensions must be ≥ 1")
        if self.adjacency not in {"4-way", "8-way"}:
            raise ValueError(
                f"adjacency must be '4-way' or '8-way', got {self.adjacency!r}"
            )
        if not self.cluster_count_distribution:
            raise ValueError("cluster_count_distribution must be non-empty")
        if not self.pay_table:
            raise ValueError("pay_table must be non-empty")
        # Validate non-negative counts + pays
        for sym, dist in self.cluster_count_distribution.items():
            for size, cnt in dist.items():
                if size < 1:
                    raise ValueError(
                        f"cluster_count[{sym!r}] size {size} must be ≥ 1"
                    )
                if cnt < 0:
                    raise ValueError(
                        f"cluster_count[{sym!r}][{size}] must be ≥ 0"
                    )
        for sym, table in self.pay_table.items():
            for size, pay in table.items():
                if size < 1:
                    raise ValueError(
                        f"pay_table[{sym!r}] size {size} must be ≥ 1"
                    )
                if pay < 0:
                    raise ValueError(
                        f"pay_table[{sym!r}][{size}] must be ≥ 0"
                    )


def expected_pay_per_spin(params: ClusterPaysParams) -> float:
    """E[pay × bet | one spin].

    Sum over (symbol, cluster_size ≥ min_cluster_size) of
        cluster_count_distribution[sym][size] × pay_table[sym][size]

    Missing combinations contribute 0. Cluster sizes below threshold
    are zeroed out (industry-standard "no-pay below min" rule).
    """
    total = 0.0
    for sym, dist in params.cluster_count_distribution.items():
        sym_pay = params.pay_table.get(sym, {})
        for size, cnt in dist.items():
            if size < params.min_cluster_size:
                continue
            pay = sym_pay.get(size, 0.0)
            total += cnt * pay
    return total


def cluster_pays_rtp(params: ClusterPaysParams) -> dict:
    """Per-base-spin RTP + per-symbol audit breakdown.

    Per-spin RTP equals `expected_pay_per_spin` (cluster pays trigger
    every spin, no separate trigger probability layer — clusters are
    THE pay mechanic).
    """
    e_pay = expected_pay_per_spin(params)
    per_symbol = []
    for sym, dist in sorted(params.cluster_count_distribution.items()):
        sym_pay = params.pay_table.get(sym, {})
        sym_total = 0.0
        sizes_with_pay = []
        for size, cnt in sorted(dist.items()):
            if size < params.min_cluster_size:
                continue
            pay = sym_pay.get(size, 0.0)
            contrib = cnt * pay
            sym_total += contrib
            sizes_with_pay.append({
                "cluster_size": size,
                "expected_count_per_spin": cnt,
                "pay_x_bet": pay,
                "contribution_x_bet": contrib,
            })
        per_symbol.append({
            "symbol": sym,
            "total_contribution_x_bet": sym_total,
            "sizes": sizes_with_pay,
        })
    return {
        "rtp_contribution": e_pay,
        "grid": f"{params.grid_rows}×{params.grid_cols}",
        "adjacency": params.adjacency,
        "min_cluster_size": params.min_cluster_size,
        "per_symbol": per_symbol,
    }
