/**
 * W213 Faza 900.0 — outreach CRM export tests.
 */
import { describe, it, expect } from 'vitest';
import {
  parseArgs,
  validateArgs,
  parseCsv,
  parseCsvLine,
  csvQuote,
  rowsToCsv,
  normalizeContactRow,
  toHubspotCsv,
  toSalesforceCsv,
  toPipedriveJson,
  toVcard,
  mapStatusToHubspotLifecycle,
  mapStatusToSalesforce,
  mergeTemplate,
} from '../outreach/crm-export.mjs';

describe('outreach export · parseArgs', () => {
  it('parses --format / --input / --output', () => {
    const a = parseArgs([
      'node', 'x',
      '--format=hubspot',
      '--input=in.csv',
      '--output=out.csv',
    ]);
    expect(a.format).toBe('hubspot');
    expect(a.input).toBe('in.csv');
    expect(a.output).toBe('out.csv');
    expect(a.merge).toBe(false);
    expect(a.dryRun).toBe(false);
  });

  it('parses --merge --template --dry-run', () => {
    const a = parseArgs([
      'node', 'x',
      '--merge',
      '--template=t.md',
      '--input=in.csv',
      '--dry-run',
    ]);
    expect(a.merge).toBe(true);
    expect(a.template).toBe('t.md');
    expect(a.dryRun).toBe(true);
  });
});

describe('outreach export · validateArgs', () => {
  it('throws when format is missing on non-merge', () => {
    expect(() => validateArgs({ format: null, input: 'in.csv' })).toThrow(/--format/);
  });

  it('throws on unsupported format', () => {
    expect(() => validateArgs({ format: 'unknown', input: 'in.csv' })).toThrow(/unsupported/);
  });

  it('throws when input is missing on non-merge', () => {
    expect(() => validateArgs({ format: 'hubspot', input: null })).toThrow(/--input/);
  });

  it('throws when merge mode lacks template', () => {
    expect(() => validateArgs({ merge: true, template: null, input: 'in.csv' })).toThrow(/--template/);
  });

  it('accepts valid hubspot format', () => {
    expect(() => validateArgs({ format: 'hubspot', input: 'in.csv' })).not.toThrow();
  });

  it('accepts all 4 supported formats', () => {
    for (const f of ['hubspot', 'salesforce', 'pipedrive', 'vcard']) {
      expect(() => validateArgs({ format: f, input: 'in.csv' })).not.toThrow();
    }
  });
});

describe('outreach export · CSV parsing', () => {
  it('parseCsvLine handles unquoted, quoted, and embedded-quote cells', () => {
    expect(parseCsvLine('a,b,c')).toEqual(['a', 'b', 'c']);
    expect(parseCsvLine('"a","b","c"')).toEqual(['a', 'b', 'c']);
    expect(parseCsvLine('"a,b","c"')).toEqual(['a,b', 'c']);
    expect(parseCsvLine('"a""b","c"')).toEqual(['a"b', 'c']);
  });

  it('parseCsv handles empty input', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [] });
    expect(parseCsv('\n\n')).toEqual({ headers: [], rows: [] });
  });

  it('parseCsv reads header + rows', () => {
    const text = 'Name,Role,Email\nAlice,CTO,a@x\nBob,CMO,b@x';
    const r = parseCsv(text);
    expect(r.headers).toEqual(['Name', 'Role', 'Email']);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0]).toEqual({ Name: 'Alice', Role: 'CTO', Email: 'a@x' });
    expect(r.rows[1]).toEqual({ Name: 'Bob', Role: 'CMO', Email: 'b@x' });
  });

  it('csvQuote escapes commas, quotes, newlines', () => {
    expect(csvQuote('simple')).toBe('simple');
    expect(csvQuote('a,b')).toBe('"a,b"');
    expect(csvQuote('a"b')).toBe('"a""b"');
    expect(csvQuote('a\nb')).toBe('"a\nb"');
  });

  it('rowsToCsv round-trips parseCsv', () => {
    const headers = ['Name', 'Email'];
    const rows = [
      { Name: 'A', Email: 'a@x' },
      { Name: 'B, Inc.', Email: 'b@x' },
    ];
    const csv = rowsToCsv(headers, rows);
    const parsed = parseCsv(csv);
    expect(parsed.headers).toEqual(headers);
    expect(parsed.rows).toEqual(rows);
  });
});

describe('outreach export · normalizeContactRow', () => {
  it('normalizes a complete row', () => {
    const n = normalizeContactRow({
      Name: 'Alice Smith',
      Role: 'CTO',
      Email: 'alice@lw.com',
      LinkedIn: 'https://linkedin.com/in/alice',
      Phone: '+1-555-0100',
      FirstContactDate: '2026-05-20',
      LastContactDate: '2026-05-22',
      Status: 'replied_interested',
      NextAction: 'Schedule demo',
      Owner: 'boki',
    });
    expect(n.name).toBe('Alice Smith');
    expect(n.role).toBe('CTO');
    expect(n.status).toBe('replied_interested');
  });

  it('defaults unknown status to "cold"', () => {
    const n = normalizeContactRow({ Name: 'X', Status: 'unknown_status' });
    expect(n.status).toBe('cold');
  });

  it('defaults unknown role to "Other"', () => {
    const n = normalizeContactRow({ Name: 'X', Role: 'Janitor' });
    expect(n.role).toBe('Other');
  });

  it('handles missing fields gracefully', () => {
    const n = normalizeContactRow({});
    expect(n.name).toBe('');
    expect(n.status).toBe('cold');
  });
});

describe('outreach export · format mappers', () => {
  it('mapStatusToHubspotLifecycle covers all 9 statuses', () => {
    expect(mapStatusToHubspotLifecycle('cold')).toBe('lead');
    expect(mapStatusToHubspotLifecycle('won')).toBe('customer');
    expect(mapStatusToHubspotLifecycle('lost')).toBe('other');
    expect(mapStatusToHubspotLifecycle('demo_done')).toBe('opportunity');
  });

  it('mapStatusToSalesforce covers all 9 statuses', () => {
    expect(mapStatusToSalesforce('cold')).toMatch(/Not Contacted/);
    expect(mapStatusToSalesforce('won')).toMatch(/Converted/);
    expect(mapStatusToSalesforce('lost')).toMatch(/Not Converted/);
  });
});

describe('outreach export · CRM format renderers', () => {
  const rows = [
    { Name: 'Alice Smith', Role: 'CTO', Email: 'a@lw', LinkedIn: 'li/a', Phone: '555-1', Status: 'meeting_scheduled', NextAction: 'Demo', Owner: 'boki', FirstContactDate: '2026-05-20', LastContactDate: '2026-05-22' },
    { Name: 'Bob Jones', Role: 'CMO', Email: 'b@lw', LinkedIn: 'li/b', Phone: '555-2', Status: 'cold', NextAction: 'Cold DM', Owner: 'boki', FirstContactDate: '', LastContactDate: '' },
  ];

  it('toHubspotCsv emits the right header', () => {
    const csv = toHubspotCsv(rows);
    expect(csv).toMatch(/First Name,Last Name,Email/);
    expect(csv).toMatch(/Alice,Smith,a@lw/);
    expect(csv).toMatch(/Bob,Jones,b@lw/);
  });

  it('toHubspotCsv maps meeting_scheduled to salesqualifiedlead', () => {
    const csv = toHubspotCsv(rows);
    expect(csv).toMatch(/salesqualifiedlead/);
  });

  it('toSalesforceCsv emits Salesforce-style headers', () => {
    const csv = toSalesforceCsv(rows);
    expect(csv).toMatch(/FirstName,LastName,Email/);
    expect(csv).toMatch(/Company/);
    expect(csv).toMatch(/Vendor B/);
  });

  it('toPipedriveJson emits valid JSON with data array', () => {
    const json = toPipedriveJson(rows);
    const parsed = JSON.parse(json);
    expect(parsed.success).toBe(true);
    expect(parsed.count).toBe(2);
    expect(parsed.data).toHaveLength(2);
    expect(parsed.data[0].name).toBe('Alice Smith');
    expect(parsed.data[0].email[0].value).toBe('a@lw');
  });

  it('toVcard emits BEGIN/END VCARD blocks per contact', () => {
    const vcf = toVcard(rows);
    expect(vcf).toMatch(/BEGIN:VCARD/);
    expect(vcf).toMatch(/VERSION:3\.0/);
    expect(vcf).toMatch(/FN:Alice Smith/);
    expect(vcf).toMatch(/FN:Bob Jones/);
    expect(vcf.match(/BEGIN:VCARD/g) ?? []).toHaveLength(2);
    expect(vcf.match(/END:VCARD/g) ?? []).toHaveLength(2);
  });

  it('toVcard escapes newlines in NOTE field', () => {
    const rowsWithNote = [
      { Name: 'X Y', Role: 'CTO', Email: 'x@y', NextAction: 'line1\nline2' },
    ];
    const vcf = toVcard(rowsWithNote);
    expect(vcf).toMatch(/NOTE:line1 line2/);
    expect(vcf).not.toMatch(/NOTE:line1\nline2/);
  });
});

describe('outreach export · mergeTemplate', () => {
  it('substitutes {{first_name}} from contact', () => {
    const template = '## Body\nHi {{first_name}},\n\nThanks.\n## Suggested\n';
    const merged = mergeTemplate({ template, contacts: [{ Name: 'Alice Smith' }] });
    expect(merged).toHaveLength(1);
    expect(merged[0].body).toMatch(/Hi Alice/);
    expect(merged[0].placeholders_used).toContain('first_name');
  });

  it('preserves un-supplied placeholders as {{name}}', () => {
    const template = '## Body\nHi {{first_name}}, see {{custom_field}}.\n## Suggested\n';
    const merged = mergeTemplate({ template, contacts: [{ Name: 'Bob' }] });
    expect(merged[0].body).toMatch(/Hi Bob, see \{\{custom_field\}\}/);
  });

  it('throws when template is not a string', () => {
    expect(() => mergeTemplate({ template: null, contacts: [] })).toThrow(/template/);
  });

  it('throws when contacts is not an array', () => {
    expect(() => mergeTemplate({ template: '', contacts: 'x' })).toThrow(/contacts/);
  });

  it('overrides sender_* from contact extra fields', () => {
    const template = '## Body\nHi {{first_name}},\n— {{sender_name}}\n## Suggested\n';
    const merged = mergeTemplate({
      template,
      contacts: [{ Name: 'Alice', sender_name: 'Boki' }],
    });
    expect(merged[0].body).toMatch(/— Boki/);
  });
});
