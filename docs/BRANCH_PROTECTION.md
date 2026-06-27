# Branch protection — `main`

F5-a (Boki 2026-06-27) — operator-facing instructions for enabling
branch protection rules on `main` so the CI gate becomes mandatory.

The CI workflow (`.github/workflows/ci.yml`) is already wired and runs
on every PR + push. Branch protection turns it into a HARD gate that
GitHub enforces before merge.

---

## What this gives you

```
┌──────────────────────────────────────────────┬────────────────────┐
│ Without branch protection                     │ With it             │
├──────────────────────────────────────────────┼────────────────────┤
│ Anyone with write access can force-push main  │ Force-push blocked  │
│ PRs can merge with red CI                     │ Red CI blocks merge │
│ History rewrites silently land                │ History rewrites    │
│                                                │ blocked (linear)    │
│ No required reviewer                          │ ≥1 review required  │
│ Stale approvals merge after new commits       │ Approvals invalidate│
│                                                │ on new commits      │
└──────────────────────────────────────────────┴────────────────────┘
```

---

## One-time setup (GitHub UI)

1. Open the repo settings:
   `https://github.com/Bojan20/slot-gdd-factory/settings/branches`

2. Click **Add branch protection rule**.

3. **Branch name pattern:** `main`

4. Check the following options:

   ```
   ✅ Require a pull request before merging
       ✅ Require approvals (minimum 1)
       ✅ Dismiss stale pull request approvals when new commits are pushed

   ✅ Require status checks to pass before merging
       ✅ Require branches to be up to date before merging
       Status checks required:
         ✅ install + test:runtime   ← from .github/workflows/ci.yml job name
       (Type the name; GitHub finds the matching workflow job.)

   ✅ Require conversation resolution before merging
   ✅ Require linear history       ← blocks merge commits + force-push rewrites
   ✅ Do not allow bypassing the above settings
   ```

5. Click **Create** (or **Save changes** if editing an existing rule).

---

## Verification

After enabling:

```
# A PR with red CI should now show:
This branch must pass required checks before merging.
Required statuses: install + test:runtime ← red

# Force-push to main should refuse:
$ git push --force-with-lease origin main
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: error: Cannot force-push to this protected branch.
```

---

## Bypass policy

If a hotfix needs to skip the gate (rare — sister-repo outage, runner
infra incident, etc.), the operator with admin rights can:

1. Temporarily uncheck "Do not allow bypassing the above settings".
2. Merge the hotfix PR.
3. Re-check the bypass guard immediately after.

Document any bypass in the merging commit message with a one-line
rationale so the audit trail is preserved.

---

## CI workflow coverage (what gates the merge)

The `install + test:runtime` job runs:

```
1. Checkout (fetch-depth: 1 for PRs, 0 for main pushes)
2. Setup Node 22 (LTS)
3. npm ci
4. Lint workflows (actionlint, SHA-pinned)
5. Runtime probes (npm run test:runtime)
6. All contract suites (npm run test:contracts)
7. IXF deep coverage walker (npm run audit:ixf)
8. Verify gate CI-safe profile (npm run verify:ci)  ← F5-a
9. On failure: emit GITHUB_STEP_SUMMARY + upload reports/ artifact
```

`verify:ci` runs ~60 of the ~70 verify steps. Skipped (8 steps): sister-
repo Python kernel bridges (B / B+ / B++ / B+++ / B+++++), V9 INGEST
WIRE, STRESS-TEST-INGEST, UQ-MASTERY block liveness, UQ-11 render smoke
(those need ~/Desktop/GDD/ corpus, sister checkout, baked walker
baseline at absolute paths, or Chromium — none available on a stateless
GitHub-hosted Ubuntu runner). Local pre-commit still runs the full
33-step verify (`npm run verify`), so the strict gate is preserved
at the developer workstation.

---

## Roadmap

- **F5-b (future):** add weekly self-hosted runner with sister-repo
  checkout so the 8 skipped steps run nightly against a fresh sister
  HEAD. Currently those steps run only on Boki's local workstation
  before each commit.
- **F5-c (future):** require successful PAR convergence sweep (5M × 4,
  ~5 min wall) on PRs that touch `tools/_par-sheet-*.mjs`. Today the
  weekly 100M cron (`.github/workflows/par-convergence-100M.yml`) is the
  only automated convergence run.
