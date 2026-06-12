// tests/tools/patchRepair.test.mjs — exercise the LLM-patch repair stages.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizePatch, extractEditsJson } from '../../tools/_lib/patchRepair.mjs';

test('repairs off-by-one hunk count in @@ header', () => {
  // Claims new=29 but actual body has 28 new lines (3 context + 22 added + 3 context).
  const bad =
    `@@ -13,6 +13,29 @@\n` +
    ` ctx1\n ctx2\n ctx3\n` +
    Array(22).fill('+addline').join('\n') + '\n' +
    ` ctx4\n ctx5\n ctx6\n`;

  const { patch, repaired, notes } = normalizePatch(bad, { filePath: 'src/blocks/anteBet.mjs' });
  assert.ok(repaired, 'should report repaired');
  assert.match(patch, /@@ -13,6 \+13,28 @@/, 'count should be corrected to 28');
  assert.ok(notes.some((n) => n.startsWith('repaired-') && n.includes('hunk-counts')), 'should note count repair');
});

test('synthesizes file headers when only @@ hunks present', () => {
  const bare = `@@ -1,1 +1,2 @@\n ctx\n+added\n`;
  const { patch } = normalizePatch(bare, { filePath: 'src/blocks/foo.mjs' });
  assert.match(patch, /^diff --git a\/src\/blocks\/foo\.mjs b\/src\/blocks\/foo\.mjs/, 'diff --git header injected');
  assert.match(patch, /^--- a\/src\/blocks\/foo\.mjs$/m, '--- header injected');
  assert.match(patch, /^\+\+\+ b\/src\/blocks\/foo\.mjs$/m, '+++ header injected');
});

test('strips markdown fence wrapper', () => {
  const wrapped = "```diff\ndiff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n```";
  const { patch, notes } = normalizePatch(wrapped, { filePath: 'x' });
  assert.ok(!patch.includes('```'), 'fence stripped');
  assert.ok(notes.includes('stripped-prose-or-fences'), 'note recorded');
  assert.match(patch, /^diff --git/m);
});

test('strips leading prose narration before diff', () => {
  const proseWrapped =
    "Here's the patch:\n\n" +
    "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n";
  const { patch } = normalizePatch(proseWrapped, { filePath: 'x' });
  assert.match(patch, /^diff --git/, 'first line is diff --git after strip');
});

test('repairs missing-space blank context lines', () => {
  // Note the empty line between context — LLMs often emit just '\n' instead of ' \n'.
  const bad =
    `@@ -1,3 +1,4 @@\n` +
    ` a\n` +
    `\n` +
    ` b\n` +
    `+c\n`;
  const { patch, notes } = normalizePatch(bad, { filePath: 'x' });
  assert.match(patch, /\n \n/, 'blank context now has leading space');
  assert.ok(notes.some((n) => n.includes('blank-context-lines')), 'note recorded');
});

test('extracts edits from fenced JSON', () => {
  const blob = "Here:\n```json\n" +
    JSON.stringify({ edits: [{ file: 'a.mjs', old: 'foo', new: 'bar' }] }) +
    "\n```\nDone.";
  const r = extractEditsJson(blob);
  assert.ok(r.ok);
  assert.equal(r.edits.length, 1);
  assert.deepEqual(r.edits[0], { file: 'a.mjs', old: 'foo', new: 'bar' });
});

test('extracts edits from bare JSON', () => {
  const blob = JSON.stringify({ edits: [{ file: 'a.mjs', old: 'x', new: 'y' }] });
  const r = extractEditsJson(blob);
  assert.ok(r.ok);
  assert.equal(r.edits.length, 1);
});

test('rejects edits json missing required fields', () => {
  const blob = JSON.stringify({ edits: [{ file: 'a.mjs' }] }); // missing old/new
  const r = extractEditsJson(blob);
  assert.ok(!r.ok, 'should reject');
  assert.equal(r.edits.length, 0);
});

test('rejects garbage gracefully without throwing', () => {
  assert.doesNotThrow(() => normalizePatch('not a patch at all', { filePath: 'x' }));
  assert.doesNotThrow(() => extractEditsJson('total garbage no json'));
});

test('handles single-line @@ header (no comma counts)', () => {
  // Some LLMs emit `@@ -5 +5 @@` for single-line hunks.
  const bad = `@@ -5 +5 @@\n-old\n+new\n`;
  const { patch } = normalizePatch(bad, { filePath: 'x' });
  assert.match(patch, /@@ -5,1 \+5,1 @@/, 'normalized to explicit count');
});
