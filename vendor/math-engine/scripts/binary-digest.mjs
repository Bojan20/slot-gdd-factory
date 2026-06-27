#!/usr/bin/env node
// Faza 9.4 — Binary digest helper.
//
// Computes the SHA-256 of a compiled binary and emits the digest in a
// machine-readable format suitable for embedding into the runtime's
// self-verification check.
//
// Usage:
//   node scripts/binary-digest.mjs --file dist/index.js
//   node scripts/binary-digest.mjs --file dist/index.js --out reports/integrity/index-digest.json
//
// The intent is to run this AFTER `tsc` lands `dist/`, capture the
// digest, and either:
//   (a) commit the digest JSON to `reports/integrity/` for auditable
//       reference, OR
//   (b) pipe it into a release packaging step that embeds the digest
//       as a string constant in the production bundle.

import { createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync, statSync } from 'node:fs';
import { dirname, basename } from 'node:path';

const args = process.argv.slice(2);
const opts = { file: null, out: null, label: null };
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case '--file': opts.file = args[++i]; break;
    case '--out': opts.out = args[++i]; break;
    case '--label': opts.label = args[++i]; break;
    case '-h':
    case '--help': {
      process.stdout.write(
        'Usage: binary-digest.mjs --file <path> [--out <json>] [--label <name>]\n'
      );
      process.exit(0);
      break;
    }
    default:
      console.error(`unknown flag: ${args[i]}`);
      process.exit(2);
  }
}
if (!opts.file) {
  console.error('--file required');
  process.exit(2);
}

let stat;
try {
  stat = statSync(opts.file);
} catch (e) {
  console.error(`cannot stat ${opts.file}: ${e.message}`);
  process.exit(3);
}
const buf = readFileSync(opts.file);
const sha256 = createHash('sha256').update(buf).digest('hex');
const sha512 = createHash('sha512').update(buf).digest('hex');

const record = {
  file: opts.file,
  label: opts.label ?? basename(opts.file),
  size_bytes: stat.size,
  sha256_hex: sha256,
  sha512_hex: sha512,
  computed_at: new Date(0).toISOString(), // deterministic — overridden by --label or external pipe
};

if (opts.out) {
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, JSON.stringify(record, null, 2) + '\n', 'utf8');
  console.log(`wrote ${opts.out}`);
} else {
  process.stdout.write(JSON.stringify(record, null, 2) + '\n');
}
