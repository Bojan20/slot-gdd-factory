#!/usr/bin/env node
/**
 * tools/install-precommit.mjs
 *
 * Wave UQ-12 (2026-06-21) — Pre-commit hook installer.
 *
 * Writes a small POSIX shell hook into .git/hooks/pre-commit that runs
 *   npm run verify:quick
 * before any commit. If the gate fails, the commit is blocked.
 *
 * Zero npm-dependency choice (no Husky) — works on a fresh clone with
 * a single `node tools/install-precommit.mjs`.
 *
 * Re-running is idempotent: existing hook with our marker is overwritten,
 * a foreign hook (no marker) is renamed to pre-commit.local-backup and
 * the new hook is installed.
 */
import { readFile, writeFile, chmod, rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const REPO = resolve(__dirname, '..');
const HOOKS = resolve(REPO, '.git/hooks');
const HOOK = resolve(HOOKS, 'pre-commit');
const MARKER = '# slot-gdd-factory UQ-12 verify gate';
const BODY = `#!/bin/sh
${MARKER}
# Auto-installed by tools/install-precommit.mjs.
# To bypass once: \`git commit --no-verify\` (discouraged; CI runs same gate).
set -e

cd "$(git rev-parse --show-toplevel)"

# Skip on empty commits / merge / rebase to avoid noise.
if [ -n "$(git rev-parse -q --verify MERGE_HEAD 2>/dev/null)" ]; then
  echo "[verify] merge commit — skipping pre-commit gate."
  exit 0
fi

echo "[verify] UQ-12 quick gate…"
node tools/verify.mjs --quick
`;

async function main() {
  if (!existsSync(HOOKS)) {
    console.error('✗ .git/hooks directory missing — is this a git repo?');
    process.exit(2);
  }

  /* If existing hook lacks our marker, back it up first */
  if (existsSync(HOOK)) {
    const existing = await readFile(HOOK, 'utf8');
    if (!existing.includes(MARKER)) {
      const backup = HOOK + '.local-backup';
      await rename(HOOK, backup);
      console.log(`  ⇡ existing pre-commit hook backed up → ${backup}`);
    }
  }

  await writeFile(HOOK, BODY, 'utf8');
  await chmod(HOOK, 0o755);
  console.log('✓ pre-commit hook installed');
  console.log('  · runs: npm run verify:quick');
  console.log('  · bypass single commit: git commit --no-verify (discouraged)');
}

main().catch(e => { console.error('FATAL:', e); process.exit(1); });
