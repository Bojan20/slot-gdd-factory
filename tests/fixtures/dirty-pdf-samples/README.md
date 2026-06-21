# Dirty PDF samples — Wave UQ-FORTIFY2 G7

PDF parsers in the wild encounter:
- **OCR artifacts**: `RTl` instead of `RTP`, ` rn` instead of `m`, soft hyphens
- **Unicode confusion**: smart quotes, em-dashes, full-width digits
- **Mismatched fonts**: page-1 in font A, page-2 in font B → header continuity break
- **Watermarks**: "CONFIDENTIAL · DRAFT" stamped diagonally over content
- **Header repetition**: section title repeated on every page-top

This directory holds synthetic dirty fixtures + the expected parsed
model after the parser's defensive layers (Wave UQ-CASH A4 prose
extractor, smartDefaults autofix) run on them.

## Sample inventory

Each `.txt` file is the post-pdftotext output of a synthetic dirty PDF.
`.expected.json` siblings carry the field-level expectations the parser
should still produce despite the dirt.

Use `tools/dirty-pdf-resilience-test.mjs` to validate.

## Editing

When the parser's defensive layers improve, regenerate expectations:

```bash
UQ_BAKE_DIRTY_EXPECTED=1 node tools/dirty-pdf-resilience-test.mjs
```
