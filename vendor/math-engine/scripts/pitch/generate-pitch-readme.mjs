#!/usr/bin/env node
/**
 * W212 Faza 800.0 — Pitch Tarball Bundler — README generator.
 *
 * Builds the bundle's top-level README.md with:
 *   - "Hello Vendor B Team" intro (configurable operator name + greeting)
 *   - Quick stats block (live numbers: total specs, solvers, P-IDs, gates,
 *     waves, M-gaps closed)
 *   - Suggested reading order per role (CTO / CMO / CFO / CEO)
 *   - "Verify yourself" section (verifier script pointer)
 *   - Contact info template
 *
 * Pure functions. Exports renderReadme + ROLE_GUIDES + DEFAULT_STATS
 * so tests can introspect each section in isolation.
 *
 * Stats default to live engine values per CLAUDE.md:
 *   77 solvers / 106 CI gates / 97 P-IDs / 7171 grand-total specs.
 * Override via the `stats` arg.
 */

export const DEFAULT_OPERATOR_NAME = 'Vendor B';

export const DEFAULT_STATS = Object.freeze({
  totalSpecs: 7171,
  closedFormSolvers: 77,
  ciGates: 106,
  industryPatternIds: 97,
  wavesShipped: 212,
  lwMechanicGapsClosed: 16,
  lwMechanicGapsTotal: 16,
  integrationStepsPassing: 10,
  integrationStepsTotal: 10,
  smokeChecksPassing: 6,
  smokeChecksTotal: 6,
  certLabsCovered: 4,
});

export const ROLE_GUIDES = Object.freeze({
  CTO: {
    headline: 'Verify the math + integrate the engine',
    order: [
      'sales/03-technical-deep-dive.html — 30-min architecture + math primer',
      'sales/06-pilot-dossier.html — 12-section evaluation dossier',
      'proof/integration-suite-latest.json — 10/10 step PASS evidence',
      'proof/closed-form-portfolio.json — 77 solvers, CF vs MC reconciliation',
      'proof/cert-dossier-samples/ — 4 lab-shaped submission bundles',
      'reference/PILOT_ARCHITECTURE.md — wire-protocol + tenancy model',
    ],
  },
  CMO: {
    headline: 'Position the offer + the story',
    order: [
      'sales/01-executive-deck.html — 12-slide pitch deck (self-contained)',
      'sales/02-roi-calculator.html — operator-tuned ROI model',
      'sales/storyboards/storyboard-30sec-elevator.md — 30-sec hook',
      'sales/storyboards/storyboard-5min-deep.md — 5-min concept walkthrough',
      'proof/demo-theater-narrative-cto.md — narrative day-by-day pilot',
    ],
  },
  CFO: {
    headline: 'Sign the cheque with confidence',
    order: [
      'sales/02-roi-calculator.html — pilot vs production ROI projections',
      'sales/04-competitive-matrix.html — engine vs incumbents pricing/feature',
      'sales/05-pitch-guide.html — commercial terms + pilot cost model',
      'proof/lw-coverage-matrix.json — 16/16 M-gap closure receipts',
      'reference/CERT_LAB_SUBMISSION.md — cert lab cost + timeline guide',
    ],
  },
  CEO: {
    headline: 'See the strategic picture in 8 minutes',
    order: [
      'sales/01-executive-deck.html — slides 1-2 (problem + solution) only',
      'sales/04-competitive-matrix.html — landscape snapshot',
      'sales/02-roi-calculator.html — pilot-to-prod uplift summary',
      'sales/storyboards/storyboard-90min-board.md — boardroom narrative',
    ],
  },
});

export function parseReadmeArgs(argv) {
  const a = { operator: DEFAULT_OPERATOR_NAME, greeting: null };
  for (const arg of argv.slice(2)) {
    if (arg.startsWith('--operator=')) a.operator = arg.slice(11);
    else if (arg.startsWith('--greeting=')) a.greeting = arg.slice(11);
  }
  if (process.env.PITCH_OPERATOR_NAME) a.operator = process.env.PITCH_OPERATOR_NAME;
  if (process.env.PITCH_GREETING) a.greeting = process.env.PITCH_GREETING;
  return a;
}

function statsTable(stats) {
  const rows = [
    ['Engine waves shipped', stats.wavesShipped],
    ['Closed-form solvers (clean-room kernels)', stats.closedFormSolvers],
    ['CI acceptance gates', stats.ciGates],
    ['Industry-pattern catalog (P-IDs)', stats.industryPatternIds],
    ['Vitest grand-total specs', stats.totalSpecs.toLocaleString('en-US')],
    [
      'Vendor B M-gaps closed',
      `${stats.lwMechanicGapsClosed} / ${stats.lwMechanicGapsTotal}`,
    ],
    [
      'Pilot integration suite (latest run)',
      `${stats.integrationStepsPassing} / ${stats.integrationStepsTotal} PASS`,
    ],
    [
      'Smoke-test checks (latest run)',
      `${stats.smokeChecksPassing} / ${stats.smokeChecksTotal} OK`,
    ],
    ['Cert labs covered', `${stats.certLabsCovered} (GLI, BMM, eCOGRA, NMi)`],
  ];
  const out = ['| Metric | Value |', '|---|---|'];
  for (const [k, v] of rows) out.push(`| ${k} | ${v} |`);
  return out.join('\n');
}

function roleSections(operator) {
  const out = [];
  for (const [role, guide] of Object.entries(ROLE_GUIDES)) {
    out.push(`### For the ${role} — ${guide.headline}`);
    out.push('');
    for (const item of guide.order) out.push(`- ${item}`);
    out.push('');
  }
  return out.join('\n');
}

export function renderReadme(opts = {}) {
  const operator = opts.operator ?? DEFAULT_OPERATOR_NAME;
  const stats = opts.stats ?? DEFAULT_STATS;
  const greeting =
    opts.greeting ??
    `Hello ${operator} team — this bundle contains every artifact you need to evaluate, verify, and pilot the Slot Math Engine.`;
  const generatedAt = opts.generatedAt ?? new Date().toISOString().slice(0, 10);
  const bundleVersion = opts.bundleVersion ?? 'dev';

  const lines = [];
  lines.push(`# Slot Math Engine — ${operator} Acceleration Pilot Package`);
  lines.push('');
  lines.push(`**Bundle version:** \`${bundleVersion}\``);
  lines.push(`**Generated:** ${generatedAt}`);
  lines.push('');
  lines.push(greeting);
  lines.push('');
  lines.push('Everything in this archive opens offline (no CDN, no http server, no npm install).');
  lines.push('Sales materials live under `sales/`, live proof under `proof/`, and engine reference under `reference/`.');
  lines.push('');
  lines.push('## Quick stats');
  lines.push('');
  lines.push(statsTable(stats));
  lines.push('');
  lines.push('## Suggested reading order (by role)');
  lines.push('');
  lines.push(roleSections(operator));
  lines.push('## Verify yourself');
  lines.push('');
  lines.push('Every file in this bundle is hashed (SHA-256) in `MANIFEST.json`.');
  lines.push('');
  lines.push('1. Untar/unzip the bundle.');
  lines.push('2. From the bundle root, run: `node verify.mjs` (offline, pure Node 18+ stdlib).');
  lines.push('   - Or, from a checked-out engine repo: `npm run pitch:verify <tarball-path>`.');
  lines.push('3. Exit code 0 ⇒ every file matches the manifest. Non-zero ⇒ a file is missing or tampered.');
  lines.push('');
  lines.push('To reproduce the proof artifacts on your own hardware, see `INSTALL.md` —');
  lines.push('three commands (`pilot:seed`, `pilot:integration`, `pilot:dossier`) generate the same outputs.');
  lines.push('');
  lines.push('## Contact');
  lines.push('');
  lines.push('See `CONTACT.md` for sales + technical contact details.');
  lines.push('');
  return lines.join('\n');
}

export function renderInstall({ operator = DEFAULT_OPERATOR_NAME } = {}) {
  return [
    `# INSTALL — verify this pitch package against the live engine`,
    '',
    `Recipients who want to reproduce the proof artifacts on their own hardware can clone the engine repo and run three commands.`,
    '',
    '## Requirements',
    '',
    '- Node.js 18+ (any LTS)',
    '- ~1 GB free disk for the engine repo',
    '- 2–3 minutes wall time for the pilot suite',
    '',
    '## Steps',
    '',
    '```sh',
    'git clone <engine-repo-url> slot-math-engine && cd slot-math-engine',
    'npm ci',
    'npm run build',
    'npm run pilot:seed             # seeds a fresh Vendor B pilot tenant',
    'npm run pilot:integration      # runs the 10-step pilot integration suite',
    'npm run pilot:dossier          # builds the 12-section dossier',
    '```',
    '',
    'Outputs land under `dist/pilot/` and should match the JSON proofs in `proof/`',
    `byte-for-byte modulo timestamps + run IDs. Reach out to ${operator} sales (see CONTACT.md)`,
    'if any hash drifts.',
    '',
  ].join('\n');
}

export function renderContact({ operator = DEFAULT_OPERATOR_NAME } = {}) {
  return [
    `# CONTACT — Slot Math Engine ${operator} Pilot`,
    '',
    '## Commercial',
    '',
    '- Sales lead: _<replace-with-AE-name>_',
    '- Email:      _<replace-with-AE-email>_',
    '- Calendar:   _<replace-with-booking-link>_',
    '',
    '## Technical',
    '',
    '- Solution architect: _<replace-with-SA-name>_',
    '- Email:              _<replace-with-SA-email>_',
    '- Slack/IM:           _<replace-with-IM-handle>_',
    '',
    '## Escalations',
    '',
    '- VP of Sales:    _<replace-with-VP-name>_',
    '- CTO:            _<replace-with-CTO-name>_',
    '',
    'PGP keys + signed cert paper trail available on request.',
    '',
  ].join('\n');
}

export function renderVersionTxt({ bundleVersion, gitCommit, gitBranch, generatedAt, engineVersion }) {
  return [
    `bundleVersion=${bundleVersion}`,
    `engineVersion=${engineVersion}`,
    `gitCommit=${gitCommit}`,
    `gitBranch=${gitBranch}`,
    `generatedAt=${generatedAt}`,
    '',
  ].join('\n');
}

// CLI — write README to stdout for debugging.
if (import.meta.url === `file://${process.argv[1]}`) {
  const a = parseReadmeArgs(process.argv);
  process.stdout.write(renderReadme({ operator: a.operator, greeting: a.greeting }));
}
