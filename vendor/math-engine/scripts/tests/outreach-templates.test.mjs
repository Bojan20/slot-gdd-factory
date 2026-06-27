/**
 * W213 Faza 900.0 — outreach template markdown structure validators.
 *
 * Ensures all 13 email templates + ancillary outreach markdown files
 * exist, contain the expected sections (3-line summary header, subject
 * lines, body, placeholders), and have no broken cross-refs.
 */
import { describe, it, expect } from 'vitest';
import { promises as fs } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');
const OUTREACH = resolve(REPO_ROOT, 'docs', 'outreach');
const TEMPLATES = resolve(OUTREACH, 'email-templates');

const TEMPLATE_FILES = [
  'cold-cto-linkedin.md',
  'cold-cto-email.md',
  'cold-cmo-linkedin.md',
  'cold-cmo-email.md',
  'cold-cfo-linkedin.md',
  'cold-cfo-email.md',
  'cold-ceo-email.md',
  'warm-cto-intro.md',
  'warm-cmo-intro.md',
  'warm-cfo-intro.md',
  'followup-no-response.md',
  'followup-after-meeting.md',
  'followup-after-demo.md',
];

const ANCILLARY = [
  'ONE_PAGER.md',
  'CADENCE_PLAYBOOK.md',
  'L_W_CONTACTS.md',
  'PRE_PITCH_CHECKLIST.md',
  'OBJECTION_RESPONSES.md',
];

const DEMO_SCRIPTS = [
  'demo-scripts/30sec-elevator-recording.md',
  'demo-scripts/3min-screen-recording.md',
  'demo-scripts/5min-loom-walkthrough.md',
];

describe('outreach templates · file existence', () => {
  it('all 13 email template files exist', async () => {
    for (const f of TEMPLATE_FILES) {
      const p = resolve(TEMPLATES, f);
      const stat = await fs.stat(p);
      expect(stat.isFile()).toBe(true);
    }
  });

  it('all 5 ancillary outreach markdown files exist', async () => {
    for (const f of ANCILLARY) {
      const p = resolve(OUTREACH, f);
      const stat = await fs.stat(p);
      expect(stat.isFile()).toBe(true);
    }
  });

  it('all 3 demo script files exist', async () => {
    for (const f of DEMO_SCRIPTS) {
      const p = resolve(OUTREACH, f);
      const stat = await fs.stat(p);
      expect(stat.isFile()).toBe(true);
    }
  });

  it('one-pager HTML exists and is non-trivial', async () => {
    const p = resolve(OUTREACH, 'one-pager.html');
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBeGreaterThan(2000);
  });
});

describe('outreach templates · 3-line summary header', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} starts with a 3-line summary block`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      const lines = content.split('\n');
      const summaryLines = lines
        .filter((l) => l.startsWith('> Summary line'))
        .slice(0, 3);
      expect(summaryLines.length).toBe(3);
      for (const sl of summaryLines) {
        expect(sl.length).toBeGreaterThan(20);
      }
    });
  }
});

describe('outreach templates · subject line variants', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} declares Subject line variants section`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      expect(content).toMatch(/## Subject line variants?/);
    });

    it(`${f} provides at least 2 subject variants (A: / B:)`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      expect(content).toMatch(/(?:^|\n)\s*[-*]\s*A:\s/);
      expect(content).toMatch(/(?:^|\n)\s*[-*]\s*B:\s/);
    });
  }
});

describe('outreach templates · placeholder syntax', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} uses {{placeholder}} syntax in body`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      const placeholderCount = (content.match(/\{\{[a-z_]+\}\}/g) ?? []).length;
      expect(placeholderCount).toBeGreaterThanOrEqual(3);
    });

    it(`${f} declares a Placeholder reference section`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      expect(content).toMatch(/## Placeholder reference/);
    });
  }
});

describe('outreach templates · body section', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} has a ## Body section`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      expect(content).toMatch(/## Body/);
    });

    it(`${f} accumulates at least 80 words across all body sections`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      const bodyRegex = /## Body[^\n]*\n([\s\S]*?)(?=\n## )/g;
      let totalWords = 0;
      let match;
      while ((match = bodyRegex.exec(content)) !== null) {
        const body = match[1];
        totalWords += body.split(/\s+/).filter((w) => w.length > 1).length;
      }
      expect(totalWords).toBeGreaterThan(80);
    });
  }
});

describe('outreach templates · send checklist', () => {
  for (const f of TEMPLATE_FILES) {
    it(`${f} has a Send checklist section`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      expect(content).toMatch(/## Send checklist/);
    });

    it(`${f} has at least 3 checklist items`, async () => {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      const checklistStart = content.indexOf('## Send checklist');
      const after = content.slice(checklistStart);
      const items = after.match(/^- \[ \]/gm) ?? [];
      expect(items.length).toBeGreaterThanOrEqual(3);
    });
  }
});

describe('outreach templates · cross-references', () => {
  it('templates referencing other templates use existing file names', async () => {
    const allTemplateBasenames = new Set(TEMPLATE_FILES);
    for (const f of TEMPLATE_FILES) {
      const content = await fs.readFile(resolve(TEMPLATES, f), 'utf8');
      const refs = content.match(/[a-z]+-[a-z]+-[a-z]+\.md|[a-z]+-[a-z]+\.md/g) ?? [];
      for (const ref of refs) {
        if (ref.startsWith('cold-') || ref.startsWith('warm-') || ref.startsWith('followup-')) {
          expect(allTemplateBasenames.has(ref)).toBe(true);
        }
      }
    }
  });

  it('CADENCE_PLAYBOOK references existing template files', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'CADENCE_PLAYBOOK.md'), 'utf8');
    const allTemplateBasenames = new Set(TEMPLATE_FILES);
    const refs = content.match(/[a-z]+-[a-z]+-[a-z]+\.md|[a-z]+-[a-z]+\.md/g) ?? [];
    for (const ref of refs) {
      if (ref.startsWith('cold-') || ref.startsWith('warm-') || ref.startsWith('followup-')) {
        expect(allTemplateBasenames.has(ref)).toBe(true);
      }
    }
  });
});

describe('outreach templates · ancillary docs structure', () => {
  it('CADENCE_PLAYBOOK contains the decision tree section', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'CADENCE_PLAYBOOK.md'), 'utf8');
    expect(content).toMatch(/Decision tree/);
    expect(content).toMatch(/Week 1/);
    expect(content).toMatch(/Week 4/);
  });

  it('L_W_CONTACTS defines all 9 status enum values', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'L_W_CONTACTS.md'), 'utf8');
    for (const status of ['cold', 'contacted_no_response', 'replied_interested', 'meeting_scheduled', 'demo_done', 'in_negotiation', 'won', 'lost', 'shelved']) {
      expect(content).toContain(status);
    }
  });

  it('OBJECTION_RESPONSES has at least 20 numbered objections', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'OBJECTION_RESPONSES.md'), 'utf8');
    const numbered = content.match(/^## \d+\./gm) ?? [];
    expect(numbered.length).toBeGreaterThanOrEqual(20);
  });

  it('PRE_PITCH_CHECKLIST has multiple checklist sections', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'PRE_PITCH_CHECKLIST.md'), 'utf8');
    expect(content).toMatch(/T-72 hours/);
    expect(content).toMatch(/T-24 hours/);
    expect(content).toMatch(/Post-meeting/);
    const items = content.match(/^- \[ \]/gm) ?? [];
    expect(items.length).toBeGreaterThan(30);
  });

  it('ONE_PAGER lists 4 quadrants of content', async () => {
    const content = await fs.readFile(resolve(OUTREACH, 'ONE_PAGER.md'), 'utf8');
    expect(content).toMatch(/Q1/);
    expect(content).toMatch(/Q2/);
    expect(content).toMatch(/Q3/);
    expect(content).toMatch(/Q4/);
  });
});
