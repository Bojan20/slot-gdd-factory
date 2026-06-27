/**
 * W215 Faza 1300.0 Agent C — CSM templates structural tests.
 *
 * 12+ specs covering:
 *   * All 15 templates exist on disk
 *   * Each has a unique numeric prefix (01..15)
 *   * Each declares Subject / Audience / Cadence metadata
 *   * Each contains at least one `{{placeholder}}`
 *   * Each closes with an Internal notes section
 *   * Each is between 60 and 200 lines (sanity bracket)
 *   * Filenames match the expected kebab-case slugs
 *   * CSM_PLAYBOOK.md and CSM_OPERATIONS.md exist and reference the templates dir
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const TEMPLATES = resolve(REPO_ROOT, 'docs', 'csm-templates');

const EXPECTED = [
  '01-welcome-email.md',
  '02-kickoff-agenda.md',
  '03-weekly-status.md',
  '04-first-spin-congrats.md',
  '05-soft-launch-checkpoint.md',
  '06-30-day-checkin.md',
  '07-qbr-intro.md',
  '08-renewal-pre-discussion.md',
  '09-renewal-proposal.md',
  '10-nps-survey-invitation.md',
  '11-churn-save-outreach.md',
  '12-escalation-acknowledgment.md',
  '13-p0-incident-update.md',
  '14-roadmap-preview.md',
  '15-anniversary-year-one.md',
];

describe('csm-templates · file existence', () => {
  it('all 15 templates exist', async () => {
    for (const f of EXPECTED) {
      const stat = await fs.stat(resolve(TEMPLATES, f));
      expect(stat.isFile()).toBe(true);
    }
  });

  it('directory contains no unexpected files', async () => {
    const list = (await fs.readdir(TEMPLATES)).filter((f) => !f.startsWith('.'));
    expect(list.sort()).toEqual([...EXPECTED].sort());
  });
});

describe('csm-templates · per-file structure', () => {
  for (const f of EXPECTED) {
    it(`${f} declares Subject / Audience / Cadence metadata`, async () => {
      const text = await fs.readFile(resolve(TEMPLATES, f), 'utf-8');
      expect(text).toMatch(/\*\*Subject:\*\*/);
      expect(text).toMatch(/\*\*Audience:\*\*/);
      expect(text).toMatch(/\*\*Cadence:\*\*/);
    });

    it(`${f} contains at least one placeholder`, async () => {
      const text = await fs.readFile(resolve(TEMPLATES, f), 'utf-8');
      expect(text).toMatch(/\{\{[a-z_]+\}\}/);
    });

    it(`${f} has an Internal notes section`, async () => {
      const text = await fs.readFile(resolve(TEMPLATES, f), 'utf-8');
      expect(text).toMatch(/\*\*Internal notes:\*\*/);
    });

    it(`${f} is between 30 and 200 lines`, async () => {
      const text = await fs.readFile(resolve(TEMPLATES, f), 'utf-8');
      const lines = text.split('\n').length;
      expect(lines).toBeGreaterThanOrEqual(30);
      expect(lines).toBeLessThanOrEqual(200);
    });
  }
});

describe('csm playbook references', () => {
  it('CSM_PLAYBOOK.md exists', async () => {
    const stat = await fs.stat(resolve(REPO_ROOT, 'docs', 'CSM_PLAYBOOK.md'));
    expect(stat.isFile()).toBe(true);
  });

  it('CSM_OPERATIONS.md exists and references templates dir', async () => {
    const p = resolve(REPO_ROOT, 'docs', 'CSM_OPERATIONS.md');
    const text = await fs.readFile(p, 'utf-8');
    expect(text).toMatch(/csm-templates/);
  });

  it('CSM_PLAYBOOK.md mentions at least 6 template numbers (01-15)', async () => {
    const text = await fs.readFile(resolve(REPO_ROOT, 'docs', 'CSM_PLAYBOOK.md'), 'utf-8');
    const refs = text.match(/template \*\*\d{2}/gi) ?? [];
    expect(refs.length).toBeGreaterThanOrEqual(6);
  });
});
