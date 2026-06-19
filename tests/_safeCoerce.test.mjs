#!/usr/bin/env node
/**
 * tests/_safeCoerce.test.mjs · FIX-8 M3 + M4 unit coverage.
 */
import {
  safeNumber, safeCssComment, safeHtmlContent, safeJsonScriptInline,
} from '../src/utils/safeCoerce.mjs';

let pass = 0, fail = 0;
const t = (name, cond, hint) => {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else      { fail++; console.log('  ✗ ' + name + (hint ? ' — ' + hint : '')); }
};

console.log('— safeCoerce —');

/* safeNumber */
t('safeNumber("0.30") = 0.3', safeNumber('0.30', 0) === 0.3);
t('safeNumber("  0.30  ") = 0.3', safeNumber('  0.30  ', 0) === 0.3);
t('safeNumber("30%") = fallback', safeNumber('30%', 99) === 99);
t('safeNumber("") = fallback', safeNumber('', 7) === 7);
t('safeNumber(null) = fallback', safeNumber(null, 7) === 7);
t('safeNumber(undefined) = fallback', safeNumber(undefined, 7) === 7);
t('safeNumber("$5") = fallback', safeNumber('$5', 99) === 99);
t('safeNumber("1,000") = fallback', safeNumber('1,000', 99) === 99);
t('safeNumber(NaN) = fallback', safeNumber(NaN, 99) === 99);
t('safeNumber(Infinity) = fallback', safeNumber(Infinity, 99) === 99);
t('safeNumber(0) = 0 (not fallback)', safeNumber(0, 99) === 0);
t('safeNumber(-1.5) = -1.5', safeNumber(-1.5, 0) === -1.5);
/* parseFloat('0x10') === 0 — consumed as decimal 0 with trailing 'x10'.
 * For decimal-only GDD, 0 is a legitimate parsed value. Document behavior. */
t('safeNumber("0x10") = 0 (parseFloat decimal-prefix)', safeNumber('0x10', 99) === 0);
t('safeNumber({}) = fallback', safeNumber({}, 99) === 99);
t('safeNumber([1,2]) = fallback (array → string with comma)', safeNumber([1, 2], 99) === 99);

/* safeCssComment */
t('safeCssComment escapes */ digraph', safeCssComment('hack */ inject') === 'hack *\\/ inject');
t('safeCssComment escapes multiple */', safeCssComment('a */ b */ c') === 'a *\\/ b *\\/ c');
t('safeCssComment escapes </style', safeCssComment('</style>x') === '<\\/style>x');
t('safeCssComment strips newlines', safeCssComment('a\nb\rc') === 'a b c');
t('safeCssComment caps length default 200', safeCssComment('x'.repeat(500)).length === 200);
t('safeCssComment custom cap', safeCssComment('x'.repeat(500), 10).length === 10);
t('safeCssComment null → ""', safeCssComment(null) === '');
t('safeCssComment undefined → ""', safeCssComment(undefined) === '');
t('safeCssComment passthrough plain', safeCssComment('Hello World') === 'Hello World');

/* safeHtmlContent */
t('safeHtmlContent escapes <', safeHtmlContent('<script>') === '&lt;script&gt;');
t('safeHtmlContent escapes &', safeHtmlContent('Tom & Jerry') === 'Tom &amp; Jerry');
t('safeHtmlContent escapes "', safeHtmlContent('say "hi"') === 'say &quot;hi&quot;');
t('safeHtmlContent escapes \'', safeHtmlContent("it's") === 'it&#39;s');
t('safeHtmlContent caps 500 default', safeHtmlContent('x'.repeat(1000)).length === 500);
t('safeHtmlContent null → ""', safeHtmlContent(null) === '');

/* safeJsonScriptInline */
t('safeJsonScriptInline escapes "<"', safeJsonScriptInline('ab<x>cd') === '"ab\\u003cx>cd"');
t('safeJsonScriptInline handles </script>', safeJsonScriptInline('a</script>b') === '"a\\u003c/script>b"');
t('safeJsonScriptInline null → "null"', safeJsonScriptInline(null) === 'null');
t('safeJsonScriptInline number → number', safeJsonScriptInline(42) === '42');
t('safeJsonScriptInline boolean → boolean', safeJsonScriptInline(true) === 'true');
t('safeJsonScriptInline object → escaped', safeJsonScriptInline({ a: '<b>' }) === '{"a":"\\u003cb>"}');

console.log(`\nResult: ${pass} pass / ${fail} fail`);
process.exit(fail === 0 ? 0 : 1);
