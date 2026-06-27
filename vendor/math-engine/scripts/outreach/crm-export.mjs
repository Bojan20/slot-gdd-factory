#!/usr/bin/env node
/**
 * W213 Faza 900.0 — Vendor B Outreach CRM Export + Email Merge.
 *
 * Reads contact data (CSV) and exports to common CRM formats:
 *   - HubSpot CSV
 *   - Salesforce CSV
 *   - Pipedrive JSON
 *   - VCard (.vcf)
 *
 * Also supports email merge: combines an outreach template with a contact CSV
 * to produce personalized emails (dry-run preview only).
 *
 * Usage:
 *   node scripts/outreach/crm-export.mjs --format=hubspot --input=contacts.csv --output=out.csv
 *   node scripts/outreach/crm-export.mjs --format=salesforce --input=contacts.csv --output=out.csv
 *   node scripts/outreach/crm-export.mjs --format=pipedrive --input=contacts.csv --output=out.json
 *   node scripts/outreach/crm-export.mjs --format=vcard --input=contacts.csv --output=out.vcf
 *   node scripts/outreach/crm-export.mjs --merge --template=email.md --input=contacts.csv [--dry-run]
 *
 * Pure Node 18+ stdlib. No external dependencies. Self-contained, testable.
 */

import { promises as fs } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const SUPPORTED_FORMATS = ['hubspot', 'salesforce', 'pipedrive', 'vcard'];

const STATUS_ENUM = new Set([
  'cold',
  'contacted_no_response',
  'replied_interested',
  'meeting_scheduled',
  'demo_done',
  'in_negotiation',
  'won',
  'lost',
  'shelved',
]);

const ROLE_ENUM = new Set([
  'CEO', 'CTO', 'COO', 'CFO', 'CMO',
  'HeadOfStudio', 'MathLead', 'EngManager',
  'ComplianceOfficer', 'PartnershipLead', 'Other',
]);

/** Parse CLI args into a plain object. Pure function — testable. */
export function parseArgs(argv) {
  const args = {
    format: null,
    input: null,
    output: null,
    template: null,
    merge: false,
    dryRun: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--merge') args.merge = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--format=')) args.format = a.slice('--format='.length);
    else if (a.startsWith('--input=')) args.input = a.slice('--input='.length);
    else if (a.startsWith('--output=')) args.output = a.slice('--output='.length);
    else if (a.startsWith('--template=')) args.template = a.slice('--template='.length);
  }
  return args;
}

/** Validate parsed args. Throws on invalid combinations. */
export function validateArgs(args) {
  if (args.merge) {
    if (!args.template) throw new Error('--merge requires --template=PATH');
    if (!args.input) throw new Error('--merge requires --input=PATH');
    return;
  }
  if (!args.format) throw new Error('--format=FORMAT required (one of: ' + SUPPORTED_FORMATS.join(', ') + ')');
  if (!SUPPORTED_FORMATS.includes(args.format)) {
    throw new Error('unsupported format: ' + args.format + ' (one of: ' + SUPPORTED_FORMATS.join(', ') + ')');
  }
  if (!args.input) throw new Error('--input=PATH required');
}

/**
 * Parse a CSV string (RFC 4180-ish) into an array of row objects.
 * Header row is required.
 * Returns { headers: string[], rows: Record<string,string>[] }.
 */
export function parseCsv(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { headers: [], rows: [] };
  }
  const lines = text.replace(/\r\n/g, '\n').split('\n').filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    const row = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = cells[j] ?? '';
    }
    rows.push(row);
  }
  return { headers, rows };
}

/** Parse one CSV line, RFC 4180-style quote handling. */
export function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuote) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') {
        inQuote = false;
      } else {
        cur += c;
      }
    } else {
      if (c === ',') {
        out.push(cur);
        cur = '';
      } else if (c === '"') {
        inQuote = true;
      } else {
        cur += c;
      }
    }
  }
  out.push(cur);
  return out;
}

/** Quote a CSV cell value if needed. */
export function csvQuote(s) {
  const v = String(s ?? '');
  if (v.includes(',') || v.includes('"') || v.includes('\n') || v.includes('\r')) {
    return '"' + v.replace(/"/g, '""') + '"';
  }
  return v;
}

/** Render an array of row objects to CSV text. */
export function rowsToCsv(headers, rows) {
  const out = [headers.map(csvQuote).join(',')];
  for (const row of rows) {
    const line = headers.map((h) => csvQuote(row[h] ?? '')).join(',');
    out.push(line);
  }
  return out.join('\n') + '\n';
}

/** Normalize a contact row from L_W_CONTACTS schema. */
export function normalizeContactRow(row) {
  const norm = {
    name: (row.Name ?? row.name ?? '').trim(),
    role: (row.Role ?? row.role ?? '').trim(),
    email: (row.Email ?? row.email ?? '').trim(),
    linkedin: (row.LinkedIn ?? row.linkedin ?? '').trim(),
    phone: (row.Phone ?? row.phone ?? '').trim(),
    firstContact: (row.FirstContactDate ?? row.firstContact ?? '').trim(),
    lastContact: (row.LastContactDate ?? row.lastContact ?? '').trim(),
    status: (row.Status ?? row.status ?? 'cold').trim(),
    nextAction: (row.NextAction ?? row.nextAction ?? '').trim(),
    owner: (row.Owner ?? row.owner ?? '').trim(),
  };
  if (norm.role && !ROLE_ENUM.has(norm.role)) {
    norm.role = 'Other';
  }
  if (!STATUS_ENUM.has(norm.status)) {
    norm.status = 'cold';
  }
  return norm;
}

/** Render contact rows to HubSpot CSV format. */
export function toHubspotCsv(rows) {
  const headers = [
    'First Name', 'Last Name', 'Email', 'Phone Number', 'LinkedIn URL',
    'Job Title', 'Lifecycle Stage', 'Lead Status', 'HubSpot Owner', 'Next Activity Date',
  ];
  const mapped = rows.map((r) => {
    const c = normalizeContactRow(r);
    const [first, ...rest] = c.name.split(' ');
    return {
      'First Name': first ?? '',
      'Last Name': rest.join(' '),
      'Email': c.email,
      'Phone Number': c.phone,
      'LinkedIn URL': c.linkedin,
      'Job Title': c.role,
      'Lifecycle Stage': mapStatusToHubspotLifecycle(c.status),
      'Lead Status': c.status,
      'HubSpot Owner': c.owner,
      'Next Activity Date': c.firstContact,
    };
  });
  return rowsToCsv(headers, mapped);
}

/** Map our internal status to HubSpot lifecycle. */
export function mapStatusToHubspotLifecycle(status) {
  switch (status) {
    case 'cold': return 'lead';
    case 'contacted_no_response': return 'lead';
    case 'replied_interested': return 'marketingqualifiedlead';
    case 'meeting_scheduled': return 'salesqualifiedlead';
    case 'demo_done': return 'opportunity';
    case 'in_negotiation': return 'opportunity';
    case 'won': return 'customer';
    case 'lost': return 'other';
    case 'shelved': return 'other';
    default: return 'lead';
  }
}

/** Render contact rows to Salesforce CSV format. */
export function toSalesforceCsv(rows) {
  const headers = [
    'FirstName', 'LastName', 'Email', 'Phone', 'Title',
    'Company', 'LeadSource', 'Status', 'OwnerId', 'Description',
  ];
  const mapped = rows.map((r) => {
    const c = normalizeContactRow(r);
    const [first, ...rest] = c.name.split(' ');
    return {
      'FirstName': first ?? '',
      'LastName': rest.join(' '),
      'Email': c.email,
      'Phone': c.phone,
      'Title': c.role,
      'Company': 'Vendor B',
      'LeadSource': 'Outbound',
      'Status': mapStatusToSalesforce(c.status),
      'OwnerId': c.owner,
      'Description': c.nextAction,
    };
  });
  return rowsToCsv(headers, mapped);
}

export function mapStatusToSalesforce(status) {
  switch (status) {
    case 'cold': return 'Open - Not Contacted';
    case 'contacted_no_response': return 'Working - Contacted';
    case 'replied_interested': return 'Working - Contacted';
    case 'meeting_scheduled': return 'Working - Contacted';
    case 'demo_done': return 'Qualified';
    case 'in_negotiation': return 'Qualified';
    case 'won': return 'Closed - Converted';
    case 'lost': return 'Closed - Not Converted';
    case 'shelved': return 'Closed - Not Converted';
    default: return 'Open - Not Contacted';
  }
}

/** Render contact rows to Pipedrive JSON format. */
export function toPipedriveJson(rows) {
  const persons = rows.map((r, idx) => {
    const c = normalizeContactRow(r);
    return {
      id: idx + 1,
      name: c.name,
      email: [{ value: c.email, primary: true }],
      phone: [{ value: c.phone, primary: true }],
      org_id: { name: 'Vendor B' },
      title: c.role,
      label: c.status,
      visible_to: '3',
      custom_fields: {
        linkedin_url: c.linkedin,
        next_action: c.nextAction,
        first_contact_date: c.firstContact,
        last_contact_date: c.lastContact,
        owner: c.owner,
      },
    };
  });
  return JSON.stringify({ data: persons, success: true, count: persons.length }, null, 2);
}

/** Render contact rows to VCard 3.0 format. */
export function toVcard(rows) {
  const cards = rows.map((r) => {
    const c = normalizeContactRow(r);
    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `FN:${c.name}`,
      `N:${c.name.split(' ').slice(1).join(' ')};${c.name.split(' ')[0] ?? ''};;;`,
      `ORG:Vendor B`,
      `TITLE:${c.role}`,
    ];
    if (c.email) lines.push(`EMAIL;TYPE=WORK:${c.email}`);
    if (c.phone) lines.push(`TEL;TYPE=WORK:${c.phone}`);
    if (c.linkedin) lines.push(`URL;TYPE=LinkedIn:${c.linkedin}`);
    if (c.nextAction) lines.push(`NOTE:${c.nextAction.replace(/\n/g, ' ')}`);
    lines.push('END:VCARD');
    return lines.join('\r\n');
  });
  return cards.join('\r\n') + '\r\n';
}

/**
 * Merge a template with contacts.
 * Returns array of { contact, subject, body, placeholders_used }.
 * Pure function — does not write to disk.
 */
export function mergeTemplate({ template, contacts }) {
  if (typeof template !== 'string') throw new Error('template must be a string');
  if (!Array.isArray(contacts)) throw new Error('contacts must be an array');
  const subjectMatch = template.match(/^##?\s*Subject line variants[\s\S]*?\n(.+)$/m);
  const subject = subjectMatch ? subjectMatch[1].replace(/^[-*\s]+/, '').replace(/^A:|^B:|^C:|^D:/, '').trim() : 'Outreach';
  const bodyStartIdx = template.indexOf('## Body');
  const bodyEndIdx = template.indexOf('## Suggested', bodyStartIdx > 0 ? bodyStartIdx : 0);
  const rawBody = bodyStartIdx >= 0
    ? template.slice(bodyStartIdx + '## Body'.length, bodyEndIdx > bodyStartIdx ? bodyEndIdx : undefined)
    : template;
  const merged = contacts.map((rawContact) => {
    const c = normalizeContactRow(rawContact);
    const placeholders = {
      first_name: c.name.split(' ')[0] ?? '',
      last_name: c.name.split(' ').slice(1).join(' '),
      email: c.email,
      role: c.role,
      linkedin: c.linkedin,
      sender_name: rawContact.sender_name ?? '{{sender_name}}',
      sender_title: rawContact.sender_title ?? '{{sender_title}}',
      sender_email: rawContact.sender_email ?? '{{sender_email}}',
      sender_phone: rawContact.sender_phone ?? '{{sender_phone}}',
      tarball_link: rawContact.tarball_link ?? '{{tarball_link}}',
      one_pager_link: rawContact.one_pager_link ?? '{{one_pager_link}}',
    };
    let body = rawBody;
    const used = [];
    for (const [k, v] of Object.entries(placeholders)) {
      const re = new RegExp('\\{\\{' + k + '\\}\\}', 'g');
      if (re.test(body)) used.push(k);
      body = body.replace(re, v);
    }
    let mergedSubject = subject;
    for (const [k, v] of Object.entries(placeholders)) {
      const re = new RegExp('\\{\\{' + k + '\\}\\}', 'g');
      mergedSubject = mergedSubject.replace(re, v);
    }
    return {
      contact: c,
      subject: mergedSubject,
      body: body.trim(),
      placeholders_used: used,
    };
  });
  return merged;
}

/** Main entry — orchestrates read → transform → write. */
export async function main(argv = process.argv) {
  const args = parseArgs(argv);
  validateArgs(args);

  const inputText = await fs.readFile(args.input, 'utf8');
  const parsed = parseCsv(inputText);

  if (args.merge) {
    const templateText = await fs.readFile(args.template, 'utf8');
    const merged = mergeTemplate({ template: templateText, contacts: parsed.rows });
    if (args.dryRun) {
      for (const m of merged.slice(0, 3)) {
        process.stdout.write('---\n');
        process.stdout.write('To: ' + m.contact.email + '\n');
        process.stdout.write('Subject: ' + m.subject + '\n\n');
        process.stdout.write(m.body.slice(0, 500) + '...\n');
      }
      process.stdout.write(`\n[dry-run] ${merged.length} emails prepared. Placeholders used: ${merged[0]?.placeholders_used.join(', ') ?? '(none)'}\n`);
    } else if (args.output) {
      const out = merged.map((m) => `To: ${m.contact.email}\nSubject: ${m.subject}\n\n${m.body}\n\n---\n`).join('\n');
      await fs.writeFile(args.output, out, 'utf8');
      process.stdout.write(`[merge] ${merged.length} emails written to ${args.output}\n`);
    }
    return merged;
  }

  let out;
  if (args.format === 'hubspot') out = toHubspotCsv(parsed.rows);
  else if (args.format === 'salesforce') out = toSalesforceCsv(parsed.rows);
  else if (args.format === 'pipedrive') out = toPipedriveJson(parsed.rows);
  else if (args.format === 'vcard') out = toVcard(parsed.rows);
  else throw new Error('unsupported format: ' + args.format);

  if (args.output) {
    await fs.mkdir(dirname(resolve(args.output)), { recursive: true });
    await fs.writeFile(args.output, out, 'utf8');
    process.stdout.write(`[${args.format}] ${parsed.rows.length} rows → ${args.output}\n`);
  } else {
    process.stdout.write(out);
  }
  return out;
}

// CLI entry guard
const isMain = (() => {
  try {
    return import.meta.url === `file://${process.argv[1]}`;
  } catch {
    return false;
  }
})();
if (isMain) {
  main(process.argv).catch((err) => {
    process.stderr.write(`error: ${err.message}\n`);
    process.exit(1);
  });
}
