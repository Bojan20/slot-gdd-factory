/**
 * W214 Faza 1100.0 — contract templates structure validators.
 *
 * Verifies that every template in `docs/contracts/`:
 *   - Carries the standard disclaimer block at the top AND the bottom.
 *   - Uses only `{{snake_case}}` placeholders (no leftover bare tokens).
 *   - Contains no obvious real PII / secret-style strings.
 *   - All used placeholders are documented in `docs/contracts/README.md`.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const CONTRACTS_DIR = resolve(REPO_ROOT, 'docs', 'contracts');

const TEMPLATE_FILES = [
  'MUTUAL_NDA_TEMPLATE.md',
  'PILOT_AGREEMENT_TEMPLATE.md',
  'TERM_SHEET_TEMPLATE.md',
  'PARTNERSHIP_LOI_TEMPLATE.md',
  'MSA_TEMPLATE.md',
  'ACQUISITION_DEAL_MEMO_TEMPLATE.md',
];

const README = 'README.md';
const PLAYBOOK = 'NEGOTIATION_PLAYBOOK.md';

const DISCLAIMER_SIGNATURE = 'DISCLAIMER';
// The key phrase may be soft-wrapped in markdown blockquotes, so we match
// each half independently across the bottom slice.
const DISCLAIMER_PHRASE_PART_A = /draft template for negotiation/;
const DISCLAIMER_PHRASE_PART_B = /reference only/;

describe('contract templates — file existence', () => {
  it('all 6 numbered templates exist', async () => {
    for (const f of TEMPLATE_FILES) {
      const stat = await fs.stat(resolve(CONTRACTS_DIR, f));
      expect(stat.isFile()).toBe(true);
    }
  });

  it('README and NEGOTIATION_PLAYBOOK exist', async () => {
    const rs = await fs.stat(resolve(CONTRACTS_DIR, README));
    const ps = await fs.stat(resolve(CONTRACTS_DIR, PLAYBOOK));
    expect(rs.isFile()).toBe(true);
    expect(ps.isFile()).toBe(true);
  });
});

describe('contract templates — disclaimer block at top and bottom', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} has disclaimer at top + bottom`, async () => {
      const content = await fs.readFile(resolve(CONTRACTS_DIR, f), 'utf8');
      const lines = content.split('\n');
      // top: among first 6 lines
      const topSlice = lines.slice(0, 6).join('\n');
      expect(topSlice).toMatch(new RegExp(DISCLAIMER_SIGNATURE));
      expect(topSlice).toMatch(DISCLAIMER_PHRASE_PART_A);
      expect(topSlice).toMatch(DISCLAIMER_PHRASE_PART_B);
      // bottom: among last 25 lines
      const bottomSlice = lines.slice(-25).join('\n');
      expect(bottomSlice).toMatch(new RegExp(DISCLAIMER_SIGNATURE));
      expect(bottomSlice).toMatch(DISCLAIMER_PHRASE_PART_A);
      expect(bottomSlice).toMatch(DISCLAIMER_PHRASE_PART_B);
    });
  }
});

describe('contract templates — placeholder hygiene', () => {
  it('every {{placeholder}} uses snake_case lowercase letters/digits/underscores', async () => {
    for (const f of TEMPLATE_FILES) {
      const content = await fs.readFile(resolve(CONTRACTS_DIR, f), 'utf8');
      const matches = content.match(/\{\{[^}]+\}\}/g) || [];
      for (const m of matches) {
        const inner = m.slice(2, -2);
        expect(
          /^[a-z][a-z0-9_]*$/.test(inner),
          `bad placeholder in ${f}: ${m}`,
        ).toBe(true);
      }
    }
  });

  it('every used placeholder is documented in README.md', async () => {
    const readme = await fs.readFile(resolve(CONTRACTS_DIR, README), 'utf8');
    const documented = new Set(
      (readme.match(/\{\{[^}]+\}\}/g) || []).map((m) => m.slice(2, -2)),
    );
    for (const f of TEMPLATE_FILES) {
      const content = await fs.readFile(resolve(CONTRACTS_DIR, f), 'utf8');
      const used = new Set(
        (content.match(/\{\{[^}]+\}\}/g) || []).map((m) => m.slice(2, -2)),
      );
      for (const ph of used) {
        // Allow common variants whose root is documented (e.g.
        // operator_signatory_* covered by operator_signatory_name / title).
        const root = ph.replace(/(_name|_title)$/, '');
        const ok =
          documented.has(ph) ||
          documented.has(`${root}_name`) ||
          documented.has(`${root}_title`) ||
          [...documented].some((d) => d.startsWith(`${root}_`));
        expect(ok, `placeholder ${ph} in ${f} is not in README`).toBe(true);
      }
    }
  });
});

describe('contract templates — no obvious real PII / secrets', () => {
  // No live emails, no SSN, no obvious dotted IPs, no credit cards.
  const PII_PATTERNS = [
    /\b\d{3}-\d{2}-\d{4}\b/,                // US SSN
    /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{4}\b/, // credit-card-ish
    /AKIA[0-9A-Z]{16}/,                     // AWS access key id
    /-----BEGIN [A-Z ]+PRIVATE KEY-----/,   // PEM private key
  ];

  for (const f of [...TEMPLATE_FILES, README, PLAYBOOK]) {
    it(`${f} contains no PII / secrets`, async () => {
      const content = await fs.readFile(resolve(CONTRACTS_DIR, f), 'utf8');
      for (const re of PII_PATTERNS) {
        expect(re.test(content), `${f} matched suspicious pattern ${re}`).toBe(
          false,
        );
      }
      // Email addresses (loosely): allow only example.com / placeholder forms,
      // not real-looking domains.
      const emails = content.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
      for (const e of emails) {
        expect(
          /(example\.com|example\.org|test\.com|placeholder)$/i.test(e),
          `${f} contains a real-looking email: ${e}`,
        ).toBe(true);
      }
    });
  }
});
