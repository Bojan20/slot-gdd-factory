#!/usr/bin/env node
/**
 * tools/_inject-data-block-name.mjs
 *
 * UQ-DEEP-AO · AO-1 batch injector — wraps every `emit*Markup` function's
 * return value in each `src/blocks/<name>.mjs` (and the auto-scaffolded
 * variants) with a call to `tagBlockMarkup(<expr>, '<blockName>')`.
 *
 * Behaviour:
 *   1. Walk `src/blocks/*.mjs` (skip _auto-scaffolded child dir — those
 *      modules have no emit*Markup exports).
 *   2. Per file, parse top-level `export function emit\w*Markup(...) {` and
 *      track its body via brace-depth + template-literal awareness.
 *   3. Inside each body, find every `return <expr>;` statement and replace
 *      with `return tagBlockMarkup(<expr>, '<blockName>');` — skipping
 *      empty-string returns (`return '';`, `return "";`, "return ``;").
 *   4. Inject `import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';`
 *      if not already present.
 *   5. Idempotent — already-wrapped expressions (`return tagBlockMarkup(`)
 *      are left alone.
 *
 * Usage:
 *   node tools/_inject-data-block-name.mjs               # apply
 *   node tools/_inject-data-block-name.mjs --dry-run     # report only
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const REPO_ROOT  = path.resolve(__dirname, '..');
const BLOCKS_DIR = path.join(REPO_ROOT, 'src', 'blocks');

const IMPORT_LINE_REL = "import { tagBlockMarkup } from '../registry/blockMarkupWrapper.mjs';";
const ARGS = new Set(process.argv.slice(2));
const DRY  = ARGS.has('--dry-run');

/* ────────────────────────────────────────────────────────────────────── */
/* Tokenizer helpers                                                       */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Find the matching closing brace for an opening brace at index `openIdx`
 * within `src`. Tracks `{}` depth while skipping over:
 *   • single-line comments  // ... \n
 *   • multi-line comments   /* ... *​/
 *   • single-quote strings  '...'  (with \-escape)
 *   • double-quote strings  "..."  (with \-escape)
 *   • template literals     `...`  including nested ${ ... }
 *   • regex literals (best-effort heuristic)
 *
 * Returns the index of the closing brace, or -1 if not balanced.
 */
/**
 * Find matching `)` for the `(` at `openIdx`. Tracks string / template
 * literal contexts to avoid being fooled by parens inside string literals.
 */
function findMatchingParen(src, openIdx) {
  if (src[openIdx] !== '(') return -1;
  const n = src.length;
  let depth = 0;
  let i = openIdx;
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      if (nl < 0) return -1;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      if (e < 0) return -1;
      i = e + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q)    { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`')  { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === '(') { depth++; i++; continue; }
    if (ch === ')') {
      depth--;
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

function findMatchingBrace(src, openIdx) {
  if (src[openIdx] !== '{') return -1;
  const n = src.length;
  let depth = 0;
  let i = openIdx;
  /* Stack of template-literal "${ ... }" interpolation contexts so we know
     when a } closes interpolation vs a regular block. */
  const tmplStack = []; /* each entry: { depth: <braceDepthAtEntry> } */

  while (i < n) {
    const ch = src[i];

    /* Inside template-literal interpolation? Treat braces normally but
       check for the matching } that pops back into the template. */
    /* Comments — only when we're at top level (not inside a string/tmpl). */
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      if (nl < 0) return -1;
      i = nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      if (end < 0) return -1;
      i = end + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        if (src[i] === '\n') break; /* unterminated — bail */
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`')  { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          /* Enter interpolation — count this { as part of the outer
             depth so brace matching for the body stays accurate. */
          tmplStack.push({ depth });
          depth++;
          i += 2;
          /* Resume outer loop to process interpolation contents. */
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '{') {
      depth++;
      i++;
      continue;
    }
    if (ch === '}') {
      depth--;
      /* Did we just close a template-literal interpolation? */
      if (tmplStack.length > 0 && tmplStack[tmplStack.length - 1].depth === depth) {
        tmplStack.pop();
        i++;
        /* Re-enter the template-literal scanner to continue the backtick. */
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '`')  { i++; break; }
          if (src[i] === '$' && src[i + 1] === '{') {
            tmplStack.push({ depth });
            depth++;
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
      if (depth === 0) return i;
      i++;
      continue;
    }
    i++;
  }
  return -1;
}

/**
 * Walk the body of an emit*Markup function and rewrite each top-level
 * `return <expr>;` into `return tagBlockMarkup(<expr>, '<blockName>');`.
 *
 * "top-level" means returns that belong to the function we're in — we still
 * skip into nested function declarations to avoid wrapping their returns.
 */
function rewriteReturnsInBody(body, blockName) {
  /* Track positions of every `return ` that:
     - is at top-level brace depth WITHIN the function body
     - is preceded by token boundary (start-of-line/whitespace/{)
     - is NOT immediately followed by ';' or 'tagBlockMarkup(' (idempotent)
     - does NOT return an empty string literal */
  const out = [];
  let i = 0;
  const n = body.length;
  let depth = 0;
  const tmplStack = [];
  /* Each entry on funcDepthStack records the brace depth at which a NESTED
     function was opened. When we close back through it, we exit the nested
     function. Returns inside nested functions are NOT rewritten. */
  let nestedFnDepth = -1;

  while (i < n) {
    const ch = body[i];

    /* Comments. */
    if (ch === '/' && body[i + 1] === '/') {
      const nl = body.indexOf('\n', i + 2);
      const end = nl < 0 ? n : nl + 1;
      out.push(body.slice(i, end));
      i = end;
      continue;
    }
    if (ch === '/' && body[i + 1] === '*') {
      const e = body.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      out.push(body.slice(i, end));
      i = end;
      continue;
    }
    /* Strings. */
    if (ch === "'" || ch === '"') {
      const q = ch;
      const start = i;
      i++;
      while (i < n) {
        if (body[i] === '\\') { i += 2; continue; }
        if (body[i] === q)    { i++; break; }
        if (body[i] === '\n') break;
        i++;
      }
      out.push(body.slice(start, i));
      continue;
    }
    if (ch === '`') {
      const start = i;
      i++;
      while (i < n) {
        if (body[i] === '\\') { i += 2; continue; }
        if (body[i] === '`')  { i++; break; }
        if (body[i] === '$' && body[i + 1] === '{') {
          tmplStack.push({ depth });
          depth++;
          i += 2;
          /* Break to outer scanner so interpolation contents (which may
             contain returns?) are processed — though returns inside an
             expression are syntax errors, so this is just for safety. */
          break;
        }
        i++;
      }
      out.push(body.slice(start, i));
      continue;
    }
    /* Brace tracking. */
    if (ch === '{') {
      depth++;
      out.push(ch);
      i++;
      continue;
    }
    if (ch === '}') {
      /* template-literal interpolation close? */
      if (tmplStack.length > 0 && tmplStack[tmplStack.length - 1].depth === depth - 1) {
        tmplStack.pop();
        depth--;
        out.push(ch);
        i++;
        /* Resume template-literal scan. */
        const tStart = i;
        while (i < n) {
          if (body[i] === '\\') { i += 2; continue; }
          if (body[i] === '`')  { i++; break; }
          if (body[i] === '$' && body[i + 1] === '{') {
            tmplStack.push({ depth });
            depth++;
            i += 2;
            break;
          }
          i++;
        }
        out.push(body.slice(tStart, i));
        continue;
      }
      depth--;
      /* Exit nested function context? */
      if (nestedFnDepth >= 0 && depth < nestedFnDepth) {
        nestedFnDepth = -1;
      }
      out.push(ch);
      i++;
      continue;
    }
    /* Detect nested function declarations / arrow-fn boundaries: we only
       care that returns inside them stay untouched. A NESTED function adds
       a new brace context. Simpler approach: any `function` keyword inside
       the body opens a nested fn whose body ends when its braces close. */
    if (/[A-Za-z_$0-9]/.test(body[i - 1] || ' ') === false) {
      /* token-boundary preceding. */
      if (body.startsWith('function', i)) {
        const after = body[i + 8];
        if (after && /[\s(*]/.test(after)) {
          /* Find the opening { of this nested function. */
          let j = i + 8;
          let parens = 0;
          let foundBrace = -1;
          while (j < n) {
            const cj = body[j];
            if (cj === '(') parens++;
            else if (cj === ')') parens--;
            else if (cj === '{' && parens === 0) { foundBrace = j; break; }
            j++;
          }
          if (foundBrace >= 0 && nestedFnDepth < 0) {
            /* Mark nested-fn depth = depth + 1 (since the { will inc depth) */
            nestedFnDepth = depth + 1;
          }
        }
      }
    }

    /* Detect `return ` at top of THIS function (not nested). */
    if (nestedFnDepth < 0 && body.startsWith('return', i)) {
      const prevCh = body[i - 1] || ' ';
      const nextCh = body[i + 6] || '';
      if (!/[A-Za-z_$0-9]/.test(prevCh) && /[\s;]/.test(nextCh)) {
        /* Find the end of the return statement: the matching ';' at the
           same brace/paren/tmpl depth. */
        const stmtStart = i;
        const exprStart = i + 6 + skipSpaces(body, i + 6);
        /* Skip empty-string and "return;" cases. */
        const exprPrefix = body.slice(exprStart, exprStart + 16);
        if (exprPrefix.startsWith(';')) {
          /* bare `return;` — nothing to wrap. */
          out.push('return');
          i += 6;
          continue;
        }
        if (
          exprPrefix.startsWith("''") ||
          exprPrefix.startsWith('""') ||
          exprPrefix.startsWith('``')
        ) {
          /* empty string — skip. */
          const semi = findStmtEnd(body, exprStart);
          if (semi < 0) { out.push(ch); i++; continue; }
          out.push(body.slice(i, semi + 1));
          i = semi + 1;
          continue;
        }
        if (body.startsWith('tagBlockMarkup(', exprStart)) {
          /* Already wrapped — idempotent. */
          const semi = findStmtEnd(body, exprStart);
          if (semi < 0) { out.push(ch); i++; continue; }
          out.push(body.slice(i, semi + 1));
          i = semi + 1;
          continue;
        }
        const semi = findStmtEnd(body, exprStart);
        if (semi < 0) {
          /* couldn't locate stmt end — bail safely on this return */
          out.push(ch);
          i++;
          continue;
        }
        const expr = body.slice(exprStart, semi).trim();
        const wrapped = `return tagBlockMarkup(${expr}, '${blockName}');`;
        out.push(wrapped);
        i = semi + 1;
        continue;
      }
    }

    out.push(ch);
    i++;
  }
  return out.join('');
}

function skipSpaces(s, idx) {
  let k = 0;
  while (idx + k < s.length && /\s/.test(s[idx + k])) k++;
  return k;
}

/**
 * Given an expression starting at `start`, return the index of its
 * terminating `;` at the same depth, accounting for strings / templates /
 * parens / braces / brackets.
 */
function findStmtEnd(src, start) {
  const n = src.length;
  let i = start;
  let depthRound = 0;
  let depthCurly = 0;
  let depthSquare = 0;
  const tmplStack = [];
  while (i < n) {
    const ch = src[i];
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i + 2);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      const e = src.indexOf('*/', i + 2);
      i = e < 0 ? n : e + 2;
      continue;
    }
    if (ch === "'" || ch === '"') {
      const q = ch;
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === q)    { i++; break; }
        if (src[i] === '\n') break;
        i++;
      }
      continue;
    }
    if (ch === '`') {
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === '`')  { i++; break; }
        if (src[i] === '$' && src[i + 1] === '{') {
          tmplStack.push({ round: depthRound, curly: depthCurly, square: depthSquare });
          i += 2;
          /* break to outer scanner to track interp content */
          break;
        }
        i++;
      }
      continue;
    }
    if (ch === '(') { depthRound++; i++; continue; }
    if (ch === ')') { depthRound--; i++; continue; }
    if (ch === '[') { depthSquare++; i++; continue; }
    if (ch === ']') { depthSquare--; i++; continue; }
    if (ch === '{') { depthCurly++; i++; continue; }
    if (ch === '}') {
      /* possibly closing template-literal interpolation? */
      if (
        tmplStack.length > 0 &&
        tmplStack[tmplStack.length - 1].round === depthRound &&
        tmplStack[tmplStack.length - 1].curly === depthCurly &&
        tmplStack[tmplStack.length - 1].square === depthSquare
      ) {
        tmplStack.pop();
        i++;
        /* Resume template scan. */
        while (i < n) {
          if (src[i] === '\\') { i += 2; continue; }
          if (src[i] === '`')  { i++; break; }
          if (src[i] === '$' && src[i + 1] === '{') {
            tmplStack.push({ round: depthRound, curly: depthCurly, square: depthSquare });
            i += 2;
            break;
          }
          i++;
        }
        continue;
      }
      depthCurly--;
      i++;
      continue;
    }
    if (ch === ';' && depthRound === 0 && depthCurly === 0 && depthSquare === 0 && tmplStack.length === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

/* ────────────────────────────────────────────────────────────────────── */
/* File-level injection                                                    */
/* ────────────────────────────────────────────────────────────────────── */

/**
 * Process one block file. Returns { changed, returnsWrapped, fn count }.
 */
function processFile(src, blockName) {
  let work = src;
  /* Find every emit*Markup function. Because parameter lists may contain
     nested parens (e.g. `cfg = defaultConfig()`), we match only up to the
     opening `(`, then locate the matching `)` and the body `{` manually. */
  const re = /export\s+function\s+(emit\w*Markup)\s*\(/g;
  const tasks = [];
  let m;
  while ((m = re.exec(work)) !== null) {
    const openParenIdx = m.index + m[0].length - 1;
    const closeParenIdx = findMatchingParen(work, openParenIdx);
    if (closeParenIdx < 0) continue;
    /* Skip whitespace between `)` and `{`. */
    let bi = closeParenIdx + 1;
    while (bi < work.length && /\s/.test(work[bi])) bi++;
    if (work[bi] !== '{') continue;
    const braceIdx = bi;
    const closeIdx = findMatchingBrace(work, braceIdx);
    if (closeIdx < 0) continue;
    tasks.push({ fnName: m[1], braceIdx, closeIdx });
  }
  /* Apply rewrites from LAST to FIRST so earlier offsets remain valid. */
  let returnsWrapped = 0;
  let perFnCounts = [];
  for (let t = tasks.length - 1; t >= 0; t--) {
    const { braceIdx, closeIdx } = tasks[t];
    const body = work.slice(braceIdx + 1, closeIdx);
    const newBody = rewriteReturnsInBody(body, blockName);
    if (newBody !== body) {
      const wraps = (newBody.match(/tagBlockMarkup\(/g) || []).length -
                    (body.match(/tagBlockMarkup\(/g) || []).length;
      returnsWrapped += Math.max(0, wraps);
      perFnCounts.push(wraps);
      work = work.slice(0, braceIdx + 1) + newBody + work.slice(closeIdx);
    }
  }
  /* Inject import if any rewrite happened and import not already present. */
  if (returnsWrapped > 0 && !work.includes("from '../registry/blockMarkupWrapper.mjs'")) {
    /* Find a good insertion point: after the last leading import line, OR
       at the very top after the leading JSDoc/comment block. */
    work = insertImport(work);
  }
  return { changed: work !== src, src: work, returnsWrapped, fnCount: tasks.length };
}

function insertImport(src) {
  /* Pattern A: insert after the last `import ... from '...';` near the top. */
  const importRe = /^import\s+[^;]+from\s+['"][^'"]+['"]\s*;[ \t]*\r?\n/gm;
  let last = -1;
  let mm;
  while ((mm = importRe.exec(src)) !== null) {
    last = mm.index + mm[0].length;
    /* Only consider imports in the top ~5KB of the file. */
    if (mm.index > 5000) break;
  }
  if (last > 0) {
    return src.slice(0, last) + IMPORT_LINE_REL + '\n' + src.slice(last);
  }
  /* Pattern B: skip a leading JSDoc /** ... *​/ block then insert. */
  const jsdocRe = /^\s*\/\*\*[\s\S]*?\*\/\s*\r?\n/;
  const j = src.match(jsdocRe);
  if (j) {
    const k = j.index + j[0].length;
    return src.slice(0, k) + IMPORT_LINE_REL + '\n' + src.slice(k);
  }
  /* Fallback: prepend. */
  return IMPORT_LINE_REL + '\n' + src;
}

/* ────────────────────────────────────────────────────────────────────── */
/* Walker                                                                  */
/* ────────────────────────────────────────────────────────────────────── */

async function listBlocks() {
  const top = await fs.readdir(BLOCKS_DIR, { withFileTypes: true });
  const files = [];
  for (const ent of top) {
    if (ent.isFile() && ent.name.endsWith('.mjs')) {
      files.push(path.join(BLOCKS_DIR, ent.name));
    }
  }
  return files;
}

async function main() {
  const files = await listBlocks();
  let tagged = 0;
  let totalFns = 0;
  let totalReturns = 0;
  let changedFiles = 0;
  const noEmitFiles = [];
  for (const f of files) {
    const blockName = path.basename(f, '.mjs');
    const src = await fs.readFile(f, 'utf8');
    if (!/export\s+function\s+emit\w*Markup/.test(src)) {
      noEmitFiles.push(blockName);
      continue;
    }
    totalFns += (src.match(/export\s+function\s+emit\w*Markup/g) || []).length;
    const { changed, src: newSrc, returnsWrapped, fnCount } = processFile(src, blockName);
    totalReturns += returnsWrapped;
    if (changed) {
      tagged++;
      changedFiles++;
      if (!DRY) await fs.writeFile(f, newSrc, 'utf8');
      process.stdout.write(`  • ${blockName.padEnd(40)}  ${fnCount} fn  ${returnsWrapped} return(s) wrapped\n`);
    } else if (fnCount > 0 && returnsWrapped === 0) {
      /* Already wrapped or empty-return only — count as success. */
      tagged++;
    }
  }
  console.log('');
  console.log(`tagged ${tagged} / ${files.length - noEmitFiles.length} blocks (${files.length} total .mjs)`);
  console.log(`changed files: ${changedFiles}${DRY ? ' (dry-run)' : ''}`);
  console.log(`total emit*Markup fns: ${totalFns}`);
  console.log(`total returns wrapped: ${totalReturns}`);
  console.log(`blocks without emit*Markup: ${noEmitFiles.length}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
