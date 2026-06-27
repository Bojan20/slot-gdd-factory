"""W7.x optional sample-report generator — closes Industry-First Dossier
55/58 → 58/58 by materializing the 3 ⚠️ optional reports the dossier
runner looks for:

  • reports/symbolic_slot_math/SAMPLE_DERIVATIVE_MANIFEST.json  (W7.6)
  • reports/provenance_mesh/SAMPLE_SESSION.json                  (W7.5)
  • reports/rl_player_emulator/SAMPLE_KPI.json                   (W7.3)

Each sample is deterministic (fixed seeds) so two consecutive runs
produce byte-identical files — the dossier runner can pin the
SHA-256 in any cert bundle without churn.

Run:  python3 -m scripts.generate_dossier_samples
or:   python3 scripts/generate_dossier_samples.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# ─── Repo paths ─────────────────────────────────────────────────────────────

REPO_ROOT = Path(__file__).resolve().parents[1]
REPORTS_ROOT = REPO_ROOT / "reports"

# Allow `python3 scripts/generate_dossier_samples.py` (no -m) by pinning
# the repo root on sys.path so `tools.*` imports resolve.
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))


def _write_json(rel_path: str, payload: dict) -> Path:
    out = REPORTS_ROOT / rel_path
    out.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, indent=2, sort_keys=True) + "\n"
    out.write_text(text, encoding="utf-8")
    return out


# ─── W7.6 — SAMPLE_DERIVATIVE_MANIFEST.json ─────────────────────────────────


def generate_symbolic_slot_math_sample() -> Path:
    """Classic 5×2 model from tools.symbolic_slot_math tests."""
    from tools.symbolic_slot_math.model import RtpModel, build_derivative_manifest

    model = RtpModel(
        n_reels=5,
        n_symbols=2,
        paytable=[[1.0, 4.0, 10.0], []],
        min_match=3,
        paylines=20,
        anchor=0,
        weights=[[4.0, 6.0] for _ in range(5)],
    )
    model.validate()
    manifest = build_derivative_manifest(model)
    payload = manifest.to_dict()
    # Augment with the input shape so the auditor sees the source
    # parameters without having to chase the test fixture.
    payload["source_model"] = {
        "n_reels": model.n_reels,
        "n_symbols": model.n_symbols,
        "min_match": model.min_match,
        "paylines": model.paylines,
        "anchor": model.anchor,
        "paytable": model.paytable,
        "weights": model.weights,
    }
    return _write_json("symbolic_slot_math/SAMPLE_DERIVATIVE_MANIFEST.json", payload)


# ─── W7.5 — SAMPLE_SESSION.json ─────────────────────────────────────────────


def generate_provenance_mesh_sample() -> Path:
    """8-spin synthetic session, fixed server_seed_hex per spin."""
    from tools.provenance_mesh.mesh import build_session_mesh

    spins = []
    for i in range(8):
        # Deterministic 64-hex string per spin.
        server_seed = f"{i:064x}"
        spins.append(
            {
                "server_seed_hex": server_seed,
                "client_seed": f"client-{i:03d}",
                "nonce": i,
                "outcome": {
                    "reels": [[i % 5, (i + 1) % 5, (i + 2) % 5]] * 5,
                    "win_x": float(i % 4),
                    "lines_paid": (i % 3) + 1,
                },
            }
        )
    mesh = build_session_mesh("w244-dossier-sample-001", spins)
    payload = mesh.to_dict()
    # Dossier runner expects `n_receipts` at top level — add it explicitly
    # since SessionMesh.to_dict() emits just session_id + merkle_root + receipts.
    payload["n_receipts"] = mesh.receipt_count()
    return _write_json("provenance_mesh/SAMPLE_SESSION.json", payload)


# ─── W7.3 — SAMPLE_KPI.json ─────────────────────────────────────────────────


def generate_rl_player_emulator_sample() -> Path:
    """Small casual-archetype cohort over the classic RtpModel — eval-only."""
    from tools.symbolic_slot_math.model import RtpModel
    from tools.rl_player_emulator.player import casual_archetype, run_cohort

    model = RtpModel(
        n_reels=5,
        n_symbols=2,
        paytable=[[1.0, 4.0, 10.0], []],
        min_match=3,
        paylines=20,
        anchor=0,
        weights=[[4.0, 6.0] for _ in range(5)],
    )
    model.validate()
    kpi, _traces = run_cohort(
        casual_archetype(),
        model,
        n_players=8,
        sessions_per_player=4,
        train=False,
        base_seed=20260530,
    )
    payload = kpi.to_dict()
    return _write_json("rl_player_emulator/SAMPLE_KPI.json", payload)


# ─── CLI entry ──────────────────────────────────────────────────────────────


def main() -> None:
    generated = []
    generated.append(generate_symbolic_slot_math_sample())
    generated.append(generate_provenance_mesh_sample())
    generated.append(generate_rl_player_emulator_sample())
    print("Generated dossier optional samples:")
    for p in generated:
        print(f"  • {p.relative_to(REPO_ROOT)}")


if __name__ == "__main__":
    main()
