#!/usr/bin/env python3
"""tools/_kernel-cluster-pays-runner.py

Wrapper for sister-repo `cluster_pays` kernel.

Schema coercion notes
  cluster_count_distribution : dict[str, dict[int, float]]
  pay_table                  : dict[str, dict[int, float]]

  JSON only supports string keys. We coerce inner dict keys "5", "6" -> int 5, 6.
  Outer keys (symbol ids) stay strings as expected.

USAGE
  PYTHONPATH=<sister-repo>/packages/slot-math-kernels/src \\
    python3 tools/_kernel-cluster-pays-runner.py <config.json>

EXIT
  0 — success, JSON on stdout
  1 — import / config error
  2 — kernel validation failed
"""
import json
import sys
from pathlib import Path

if len(sys.argv) < 2:
    print(json.dumps({"error": "usage: <config.json>"}))
    sys.exit(1)

cfg_path = Path(sys.argv[1])
if not cfg_path.exists():
    print(json.dumps({"error": f"config not found: {cfg_path}"}))
    sys.exit(1)

try:
    from slot_math_kernels.cluster_pays import (
        cluster_pays_rtp,
        ClusterPaysParams,
    )
except ImportError as e:
    print(json.dumps({"error": f"sister-repo import failed: {e}"}))
    sys.exit(1)

cfg = json.loads(cfg_path.read_text())

def _coerce_inner(d):
    """Coerce inner dict {str_key: number} -> {int_key: float}."""
    return {int(k): float(v) for k, v in d.items()}

try:
    ccd_raw = cfg.get("cluster_count_distribution", {})
    pt_raw  = cfg.get("pay_table", {})
    if not ccd_raw:
        print(json.dumps({"error": "cluster_count_distribution required"}))
        sys.exit(2)
    if not pt_raw:
        print(json.dumps({"error": "pay_table required"}))
        sys.exit(2)
    cluster_count_distribution = {sym: _coerce_inner(inner) for sym, inner in ccd_raw.items()}
    pay_table                   = {sym: _coerce_inner(inner) for sym, inner in pt_raw.items()}
    params = ClusterPaysParams(
        cluster_count_distribution=cluster_count_distribution,
        pay_table=pay_table,
        min_cluster_size=int(cfg.get("min_cluster_size", 5)),
    )
except (TypeError, ValueError, KeyError) as e:
    print(json.dumps({"error": f"param validation failed: {e}"}))
    sys.exit(2)

result = cluster_pays_rtp(params)
# Result already JSON-safe (numbers + dicts + lists).
print(json.dumps(result))
sys.exit(0)
