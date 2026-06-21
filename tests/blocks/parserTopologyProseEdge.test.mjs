/**
 * tests/blocks/parserTopologyProseEdge.test.mjs
 *
 * UQ-CASH (2026-06-21) — regression for the three topology extractor
 * misfires uncovered by ingesting a portfolio PDF that wrote the
 * topology spec in prose with the unicode `×` and table-less paylines.
 *
 * Reproductions (all originally returned wrong values):
 *   1. "5 reels × 3 rows, 20 fixed paylines" → reels was 1, paylines was 15
 *      The "1" came from "5.1 Reel Topology" section heading;
 *      the "15" came from "Visible positions 15" several lines above
 *      "Paylines 20" header.
 *   2. "5×3, 20-fixed-line" → reels was 1 (same heading trap)
 *   3. "5 reels x 3 rows (rectangular)" → rows was 0 before tightening
 *
 * After UQ-CASH fix:
 *   1. extractor prefers dimensional N×M before the loose "N reel"
 *   2. plural "reels" required for the bare prose fallback
 *   3. paylines pattern restricted to inline whitespace ([ \t]) so it
 *      cannot span newlines into a stray "15" earlier on the page
 *   4. high-specificity phrasings ("N-fixed-payline", "N fixed paylines",
 *      "N-payline") prioritized; bare "N paylines" must be plural and
 *      not preceded by a sub-section number like "5.2 Payline".
 */
import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { parseGDD } from '../../src/parser.mjs';

const CASES = [
  {
    label: 'unicode × + fixed paylines, with section heading that has lone "1 Reel"',
    text:
`5.1 Reel Topology

Format: 5 reels × 3 rows, 20 fixed paylines, pay left-to-right from reel 1.

Visible positions: 15

Paylines: 20 fixed (non-configurable)
`,
    expect: { reels: 5, rows: 3, paylines: 20 },
  },
  {
    label: 'compact 5×3, 20-fixed-payline form',
    text: `Game is a high-volatility 5×3, 20-fixed-payline slot.`,
    expect: { reels: 5, rows: 3, paylines: 20 },
  },
  {
    label: 'ASCII "5 reels x 3 rows (rectangular)"',
    text: `Layout: 5 reels x 3 rows (rectangular)\nPaylines: 25 fixed paylines`,
    expect: { reels: 5, rows: 3, paylines: 25 },
  },
  {
    label: 'section heading "5.2 Payline Map" must NOT contaminate paylines',
    text:
`Format: 6 reels × 4 rows, 40 fixed paylines.

5.2 Payline Map (L01-L40)
This subsection lists every payline trajectory.
`,
    expect: { reels: 6, rows: 4, paylines: 40 },
  },
  {
    label: 'sub-section "5.1 Reel Topology" must NOT yield reels=1',
    text:
`5.1 Reel Topology

The game uses a 7 reels × 5 rows hexagonal layout.
`,
    expect: { reels: 7, rows: 5 },
  },
];

for (const c of CASES) {
  test('UQ-CASH topology: ' + c.label, () => {
    const m = parseGDD(c.text, 'pdf');
    for (const k of Object.keys(c.expect)) {
      assert.equal(m.topology[k], c.expect[k],
        `${k} expected ${c.expect[k]}, got ${m.topology[k]}`);
    }
  });
}

test('UQ-CASH topology: existing markdown table still wins', () => {
  /* Confirm the original table-cell extractors still rank above prose,
     so legacy GDDs with explicit `| Reels | 5 |` rows are unaffected. */
  const md = `
| Attribute | Value |
|-----------|-------|
| Reels     | 5     |
| Rows      | 3     |
| Paylines  | 20    |
`;
  const m = parseGDD(md, 'md');
  assert.equal(m.topology.reels, 5);
  assert.equal(m.topology.rows, 3);
  assert.equal(m.topology.paylines, 20);
});
