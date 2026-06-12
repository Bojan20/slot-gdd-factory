/**
 * tools/_lib/patchRepair.mjs
 *
 * Robust unified-diff normalizer + repair for LLM-emitted patches.
 *
 * WHY
 * ---
 * Opus / Fable returns "patches" that look unified-diff but routinely have:
 *   • Prose / fence wrap before & after the diff body.
 *   • Hunk headers with WRONG line counts (`@@ -13,6 +13,29 @@` when the
 *     actual hunk body has 28 added lines, not 29 — off-by-one error).
 *   • Missing `diff --git a/.. b/..` header (only `--- a/file` / `+++ b/file`).
 *   • Missing file headers entirely (just `@@` hunks against an implied file).
 *
 * `git apply` is strict; any of those three failures yields the cryptic
 * `corrupt patch at line N` / `patch fragment without header` messages
 * that wrecked Fable Wave 1 (52% invalid output).
 *
 * This module fixes all three classes deterministically before `git apply`
 * is invoked, eliminating the entire failure surface for well-intentioned
 * but sloppy LLM output.
 *
 * PUBLIC API
 * ----------
 *   normalizePatch(raw, { filePath }) → { patch: string, repaired: boolean, notes: string[] }
 *     - Strips markdown fences and prose.
 *     - Synthesizes file headers when only hunks are present.
 *     - Recomputes hunk line counts from actual `+`/`-`/` ` body.
 *     - Returns the cleaned patch ready for `git apply --check`.
 *
 *   extractEditsJson(raw) → { edits: [{file, old, new}], ok: boolean }
 *     - When the LLM was asked for JSON-edits instead of a diff, parse it
 *       defensively (fence-tolerant, prose-tolerant).
 *
 * STYLE
 * -----
 * No dependencies. Single-file. Pure functions. Defensive on every input.
 * Test contract: input arbitrary string, output either a clean unified diff
 * git can apply, or a structured edit list. Never throw.
 */

/**
 * Strip markdown fences and surrounding prose, returning only the unified
 * diff body. Tolerant of `````diff `, `` ``` ``, leading/trailing chatter.
 */
function stripFencesAndProse(raw) {
  if (!raw) return '';
  let t = String(raw).replace(/\r\n/g, '\n');

  // Strip opening fence if present.
  t = t.replace(/^[\s\S]*?```(?:diff|patch)?\n/, (m) => {
    // If there's no leading prose-or-fence, do not strip the whole prefix.
    // But the regex `/^[\s\S]*?\`\`\`/` is non-greedy so it only eats up
    // to the first fence; that's intentional.
    return '';
  });

  // Strip closing fence and any trailing prose.
  const closeIdx = t.indexOf('\n```');
  if (closeIdx !== -1) {
    t = t.slice(0, closeIdx + 1);
  }

  // If there's no fence at all, try to locate the first diff marker and
  // drop everything before it.
  const firstDiff = findFirstDiffMarker(t);
  if (firstDiff > 0) t = t.slice(firstDiff);

  // Drop trailing prose after the last hunk line (best-effort).
  t = dropTrailingProse(t);

  return t.trimEnd() + '\n';
}

function findFirstDiffMarker(s) {
  // Cheap shortcut: if the very first line is already a diff marker, don't
  // hunt — leave the string untouched. Otherwise we'd slice off the first
  // legitimate header line whenever there happens to be a later `\n---` etc.
  if (s.startsWith('diff --git ') || s.startsWith('--- ') || s.startsWith('@@ -')) return 0;
  const candidates = [
    s.indexOf('\ndiff --git '),
    s.indexOf('\n--- a/'),
    s.indexOf('\n--- '),
    s.indexOf('\n@@ -'),
  ].filter((i) => i >= 0);
  if (candidates.length === 0) return -1;
  // +1 to skip the preceding newline.
  return Math.min(...candidates) + 1;
}

function dropTrailingProse(s) {
  // Walk backwards and find the last line that is a legal diff line:
  //   starts with `+`, `-`, ` `, `@@`, `diff `, `index `, `---`, `+++`, or
  //   the `\ No newline at end of file` marker.
  const lines = s.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const L = lines[i];
    if (L === '') continue;
    if (
      L.startsWith('+') ||
      L.startsWith('-') ||
      L.startsWith(' ') ||
      L.startsWith('@@') ||
      L.startsWith('diff ') ||
      L.startsWith('index ') ||
      L.startsWith('--- ') ||
      L.startsWith('+++ ') ||
      L.startsWith('\\ No newline')
    ) {
      return lines.slice(0, i + 1).join('\n');
    }
    // Otherwise this is trailing prose — strip and keep walking.
  }
  return '';
}

/**
 * If headers are missing but at least one `@@` is present, synthesize
 * `diff --git`, `--- a/<path>`, `+++ b/<path>` from the known target file.
 */
function ensureFileHeaders(patch, filePath) {
  if (!patch || !filePath) return patch;

  // If we already have a file header, leave as-is.
  if (/^diff --git /m.test(patch) || /^--- a\//m.test(patch)) return patch;
  // No headers — but do we have hunks?
  if (!/^@@ -/m.test(patch)) return patch;

  const synth =
    `diff --git a/${filePath} b/${filePath}\n` +
    `--- a/${filePath}\n` +
    `+++ b/${filePath}\n`;
  return synth + patch;
}

/**
 * Recompute every hunk's line counts so they match the actual body.
 *
 * Format: `@@ -<oldStart>,<oldCount> +<newStart>,<newCount> @@[ heading]`
 *
 * The LLM frequently emits a stale `<oldCount>` / `<newCount>`. Git rejects
 * the patch with "corrupt patch at line N" pointing at the NEXT hunk header,
 * because it tried to consume the announced number of lines and overshot.
 *
 * Counts:
 *   oldCount  = (context lines starting with ' ') + (removed lines '-')
 *   newCount  = (context lines starting with ' ') + (added lines '+')
 *
 * Single-line hunks (`@@ -X +Y @@`) are normalized to `@@ -X,1 +Y,1 @@`.
 */
function repairHunkCounts(patch) {
  if (!patch) return { patch, fixed: 0 };
  const lines = patch.split('\n');
  let fixed = 0;

  // Locate hunk header indices.
  const hunkHeaders = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^@@ -\d/.test(lines[i])) hunkHeaders.push(i);
  }
  if (hunkHeaders.length === 0) return { patch, fixed };

  for (let h = 0; h < hunkHeaders.length; h++) {
    const start = hunkHeaders[h];
    const end = (h + 1 < hunkHeaders.length) ? hunkHeaders[h + 1] : lines.length;

    const header = lines[start];
    const m = header.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (!m) continue;
    const oldStart = m[1];
    const newStart = m[3];
    const tail = m[5] || '';

    // Walk body, count.
    let oldCount = 0;
    let newCount = 0;
    for (let i = start + 1; i < end; i++) {
      const L = lines[i];
      if (L === '' || L.startsWith('\\ No newline')) continue;
      const c = L[0];
      if (c === ' ') { oldCount++; newCount++; }
      else if (c === '-') { oldCount++; }
      else if (c === '+') { newCount++; }
      // Anything else is ignored (synthetic blank lines, etc).
    }

    const newHeader = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@${tail}`;
    if (newHeader !== header) {
      lines[start] = newHeader;
      fixed++;
    }
  }

  return { patch: lines.join('\n'), fixed };
}

/**
 * Some LLMs forget the leading space on blank context lines (they emit just
 * an empty line instead of " "). Git treats truly-empty lines inside a hunk
 * as the END of the hunk. Repair by inserting a single space on each
 * mid-hunk empty line.
 */
function repairBlankContextLines(patch) {
  if (!patch) return { patch, fixed: 0 };
  const lines = patch.split('\n');
  let fixed = 0;
  let inHunk = false;
  for (let i = 0; i < lines.length; i++) {
    if (/^@@ -\d/.test(lines[i])) { inHunk = true; continue; }
    if (!inHunk) continue;
    // Exit hunk on next file header.
    if (/^(diff --git|--- |\+\+\+ )/.test(lines[i])) { inHunk = false; continue; }
    if (lines[i] === '') {
      // Check whether the NEXT line is still legal hunk content; if so,
      // assume this empty line was meant to be a blank context line.
      const nxt = lines[i + 1] || '';
      if (
        nxt.startsWith('+') ||
        nxt.startsWith('-') ||
        nxt.startsWith(' ') ||
        nxt.startsWith('\\ No newline')
      ) {
        lines[i] = ' ';
        fixed++;
      } else {
        inHunk = false;
      }
    }
  }
  return { patch: lines.join('\n'), fixed };
}

/**
 * Public — apply every repair stage in order.
 */
export function normalizePatch(raw, { filePath } = {}) {
  const notes = [];
  const stripped = stripFencesAndProse(raw);
  if (stripped !== raw) notes.push('stripped-prose-or-fences');

  let withHeaders = stripped;
  if (filePath) {
    withHeaders = ensureFileHeaders(stripped, filePath);
    if (withHeaders !== stripped) notes.push('synthesized-file-headers');
  }

  const { patch: blanksFixed, fixed: blanks } = repairBlankContextLines(withHeaders);
  if (blanks > 0) notes.push(`repaired-${blanks}-blank-context-lines`);

  const { patch: countsFixed, fixed: counts } = repairHunkCounts(blanksFixed);
  if (counts > 0) notes.push(`repaired-${counts}-hunk-counts`);

  return {
    patch: countsFixed,
    repaired: notes.length > 0,
    notes,
  };
}

/**
 * Defensively extract a JSON edits document from LLM output. Accepts
 * either a bare JSON blob or one wrapped in ```json fences with prose.
 *
 * Schema:
 *   {
 *     "edits": [
 *       { "file": "src/blocks/X.mjs", "old": "...", "new": "..." },
 *       ...
 *     ]
 *   }
 */
export function extractEditsJson(raw) {
  if (!raw) return { edits: [], ok: false, reason: 'empty' };
  const t = String(raw);

  // Try fenced block first.
  let body = null;
  const fence = t.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fence) body = fence[1];

  // If no fence, try the largest balanced `{...}` substring.
  if (!body) {
    const first = t.indexOf('{');
    const last = t.lastIndexOf('}');
    if (first !== -1 && last > first) body = t.slice(first, last + 1);
  }
  if (!body) return { edits: [], ok: false, reason: 'no-json-body' };

  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (e) {
    return { edits: [], ok: false, reason: `parse-error: ${e.message}` };
  }
  if (!parsed || !Array.isArray(parsed.edits)) {
    return { edits: [], ok: false, reason: 'no-edits-array' };
  }
  const edits = parsed.edits.filter(
    (e) => e && typeof e.file === 'string' && typeof e.old === 'string' && typeof e.new === 'string'
  );
  if (edits.length === 0) return { edits: [], ok: false, reason: 'edits-empty-or-malformed' };
  return { edits, ok: true };
}
