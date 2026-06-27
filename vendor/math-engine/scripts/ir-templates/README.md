# IR template skeletons

These `*.template.json` files are **reference skeletons** for hand-curating
new starter IRs. `scripts/generate-ir-library.mjs` does NOT read them at
runtime — it carries the canonical template-builder functions inline so
the generated output stays deterministic and idempotent.

Use these files as a copy-paste starting point when you need to extend
the Vendor B M-gap library beyond M16, add a new industry classic, or seed a
brand-new mechanic. The flow is:

1. Copy the closest-shape template (e.g. `lw-mgap.template.json` for an
   Vendor B M-gap, `classic-lines.template.json` for a Vegas-style classic).
2. Fill in the placeholder values (`{{...}}`).
3. Either drop the result into `web/studio/ir-library/{lw-mgaps,classics}/`
   directly, or — preferred — add a builder function to the generator
   script so future regens stay deterministic.

All produced IRs must pass `parseGameIR()` (`src/ir/index.ts`) — the
generator enforces this on every run.
