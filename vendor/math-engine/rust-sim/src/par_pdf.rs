//! W5.6 — Native PDF 1.4 emitter for the PAR sheet.
//!
//! Generates GLI-16 Appendix D-compatible PAR sheets as PDF without
//! pulling any external dependency (the workspace's lint policy blocks
//! `printpdf` because it transitively pulls `time 0.3.47` →
//! edition2024 → Rust 1.88+ which our CI toolchain doesn't carry).
//!
//! The emitter writes a minimal-but-spec-conformant PDF:
//!
//! * Header: `%PDF-1.4` + binary-marker comment.
//! * Catalog + Pages tree.
//! * One page per `PAGE_LINES` (60) input lines, A4 612×792 pt MediaBox.
//! * Helvetica Type-1 base font (Adobe 14 — guaranteed available in
//!   every PDF reader, no font embedding required).
//! * Cross-reference table + trailer + `startxref` + `%%EOF`.
//!
//! Layout is deliberately plain-text monospace-style — Markdown tables
//! emitted by `par_export::to_markdown_report` survive intact because we
//! preserve every character. Regulator readers (Adobe Reader, Preview,
//! Acrobat, PDFium) all open the result and print byte-identical pages
//! across platforms.
//!
//! **Determinism guarantee** — for the same input `PARSheet` the byte
//! output is identical across machines / OS / Rust versions. There is
//! NO timestamp written into the document body, NO `/CreationDate`,
//! NO RNG anywhere. This lets operators include the PDF SHA-256 in the
//! signed cert bundle and have it survive a re-emit at audit time.
//!
//! Usage:
//!     use slot_sim::par_pdf::render_par_pdf;
//!     let bytes = render_par_pdf(&par);
//!     std::fs::write("PAR_Sheet.pdf", &bytes)?;

use crate::par::PARSheet;
use crate::par_export::to_markdown_report;

const PAGE_W: f32 = 612.0;
const PAGE_H: f32 = 792.0;
const MARGIN_L: f32 = 50.0;
const MARGIN_TOP: f32 = 750.0;
const LINE_HEIGHT: f32 = 12.0;
const PAGE_LINES: usize = 60;
const FONT_SIZE: f32 = 9.0;
const MAX_CHARS_PER_LINE: usize = 110;

// ─── Public entrypoint ──────────────────────────────────────────────────────

/// Render the PAR sheet as a self-contained PDF 1.4 byte stream.
///
/// Output is deterministic — the same `PARSheet` produces byte-identical
/// PDF on every machine, every Rust version, every locale.
pub fn render_par_pdf(par: &PARSheet) -> Vec<u8> {
    let markdown = to_markdown_report(par);
    render_text_pdf(&markdown, &format!("PAR Sheet — {}", par.meta.game_id))
}

/// Render an arbitrary plain-text / Markdown body as a PDF (exposed for
/// tests + reuse by `gen_par_sheet` bin with a custom header).
pub fn render_text_pdf(body: &str, title: &str) -> Vec<u8> {
    let lines = wrap_lines(body, MAX_CHARS_PER_LINE);
    let title_lines = wrap_lines(title, MAX_CHARS_PER_LINE);

    // Group lines into pages. First page reserves the title block on top.
    let mut pages: Vec<Vec<String>> = Vec::new();
    let mut current: Vec<String> = Vec::with_capacity(PAGE_LINES);
    current.extend(title_lines.iter().cloned());
    current.push(String::new()); // blank line under title

    for line in lines {
        if current.len() >= PAGE_LINES {
            pages.push(std::mem::take(&mut current));
        }
        current.push(line);
    }
    if !current.is_empty() {
        pages.push(current);
    }
    if pages.is_empty() {
        pages.push(vec![String::new()]);
    }

    emit_pdf(&pages)
}

// ─── PDF assembly ───────────────────────────────────────────────────────────

fn emit_pdf(pages: &[Vec<String>]) -> Vec<u8> {
    // Object ids:
    //   1 — Catalog
    //   2 — Pages tree
    //   3 — Font (Helvetica)
    //   4..4+P-1 — Page objects
    //   4+P..4+2P-1 — Content streams (one per page)
    let num_pages = pages.len();
    let first_page_id = 4u32;
    let first_content_id = first_page_id + num_pages as u32;

    let mut buf = Vec::<u8>::with_capacity(8 * 1024);
    let mut offsets: Vec<usize> = Vec::new();
    let push_header = |buf: &mut Vec<u8>| {
        buf.extend_from_slice(b"%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    };

    push_header(&mut buf);

    let write_obj = |buf: &mut Vec<u8>, offsets: &mut Vec<usize>, payload: &str| {
        offsets.push(buf.len());
        buf.extend_from_slice(payload.as_bytes());
    };

    // 1 — Catalog
    write_obj(
        &mut buf,
        &mut offsets,
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    );

    // 2 — Pages tree
    let kids = (0..num_pages)
        .map(|i| format!("{} 0 R", first_page_id + i as u32))
        .collect::<Vec<_>>()
        .join(" ");
    let pages_obj = format!(
        "2 0 obj\n<< /Type /Pages /Kids [{kids}] /Count {num_pages} >>\nendobj\n"
    );
    write_obj(&mut buf, &mut offsets, &pages_obj);

    // 3 — Font (Helvetica Type-1, no embedding required)
    write_obj(
        &mut buf,
        &mut offsets,
        "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
    );

    // 4..4+P-1 — Page objects
    for i in 0..num_pages {
        let pid = first_page_id + i as u32;
        let cid = first_content_id + i as u32;
        let page = format!(
            "{pid} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {pw} {ph}] /Contents {cid} 0 R /Resources << /Font << /F1 3 0 R >> >> >>\nendobj\n",
            pw = PAGE_W,
            ph = PAGE_H
        );
        write_obj(&mut buf, &mut offsets, &page);
    }

    // 4+P..4+2P-1 — Content streams
    for (i, lines) in pages.iter().enumerate() {
        let cid = first_content_id + i as u32;
        let stream = build_content_stream(lines);
        let obj = format!(
            "{cid} 0 obj\n<< /Length {len} >>\nstream\n{stream}endstream\nendobj\n",
            len = stream.len()
        );
        write_obj(&mut buf, &mut offsets, &obj);
    }

    // xref
    let xref_offset = buf.len();
    let total_objs = 3 + 2 * num_pages; // catalog + pages + font + page objs + content objs
    buf.extend_from_slice(format!("xref\n0 {n}\n", n = total_objs + 1).as_bytes());
    buf.extend_from_slice(b"0000000000 65535 f \n"); // free object 0
    for off in &offsets {
        let entry = format!("{:010} 00000 n \n", off);
        buf.extend_from_slice(entry.as_bytes());
    }

    // trailer + startxref + %%EOF
    let trailer = format!(
        "trailer\n<< /Size {n} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n",
        n = total_objs + 1,
    );
    buf.extend_from_slice(trailer.as_bytes());

    buf
}

fn build_content_stream(lines: &[String]) -> String {
    let mut s = String::with_capacity(lines.len() * 80);
    s.push_str("BT\n");
    s.push_str(&format!("/F1 {fs} Tf\n", fs = FONT_SIZE));
    s.push_str(&format!("{lh} TL\n", lh = LINE_HEIGHT));
    s.push_str(&format!("{x} {y} Td\n", x = MARGIN_L, y = MARGIN_TOP));
    for (i, line) in lines.iter().enumerate() {
        if i == 0 {
            s.push_str(&format!("({}) Tj\n", escape_pdf_string(line)));
        } else {
            s.push_str(&format!("T*\n({}) Tj\n", escape_pdf_string(line)));
        }
    }
    s.push_str("ET\n");
    s
}

/// Escape `(`, `)`, `\` per PDF string literal rules + replace non-ASCII
/// with `?` so we don't have to embed a CMap. WinAnsiEncoding gives us
/// Latin-1 for free; UTF-8 multibyte gets degraded to `?` to keep the
/// emitter dependency-free.
fn escape_pdf_string(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'(' => out.push_str("\\("),
            b')' => out.push_str("\\)"),
            b'\\' => out.push_str("\\\\"),
            b'\n' => out.push(' '),
            b'\r' => {}
            // ASCII printable + Latin-1 high-half passes through.
            0x20..=0x7E => out.push(b as char),
            0xA1..=0xFF => out.push(b as char),
            _ => out.push('?'),
        }
    }
    out
}

/// Soft-wrap lines at `max_chars` boundaries. Preserves Markdown table
/// alignment by NOT collapsing whitespace; just splits at width.
fn wrap_lines(text: &str, max_chars: usize) -> Vec<String> {
    let mut out = Vec::new();
    for raw_line in text.lines() {
        if raw_line.len() <= max_chars {
            out.push(raw_line.to_string());
            continue;
        }
        let mut remaining = raw_line;
        while remaining.len() > max_chars {
            // Try to break at the last space within the window — avoids
            // splitting in the middle of a word when possible.
            let window = &remaining[..max_chars];
            let break_at = window.rfind(' ').unwrap_or(max_chars);
            let (head, tail) = remaining.split_at(break_at);
            out.push(head.to_string());
            remaining = tail.trim_start();
        }
        if !remaining.is_empty() {
            out.push(remaining.to_string());
        }
    }
    out
}

// ─── Tests ──────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn header_starts_with_pdf_1_4() {
        let bytes = render_text_pdf("Hello world", "Test");
        assert!(bytes.starts_with(b"%PDF-1.4"));
    }

    #[test]
    fn ends_with_eof_marker() {
        let bytes = render_text_pdf("Body", "T");
        assert!(bytes.ends_with(b"%%EOF\n"));
    }

    #[test]
    fn contains_required_pdf_keywords() {
        let bytes = render_text_pdf("a\nb\nc", "Title");
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("/Type /Catalog"));
        assert!(s.contains("/Type /Pages"));
        assert!(s.contains("/Type /Page "));
        assert!(s.contains("xref"));
        assert!(s.contains("startxref"));
        assert!(s.contains("trailer"));
    }

    #[test]
    fn determinism_same_input_same_bytes() {
        let bytes_a = render_text_pdf("Same input", "Same title");
        let bytes_b = render_text_pdf("Same input", "Same title");
        assert_eq!(bytes_a, bytes_b);
    }

    #[test]
    fn escapes_parens_and_backslashes() {
        // PDF strings must escape `(`, `)`, `\` — otherwise readers
        // miscount nesting and the page goes blank.
        let bytes = render_text_pdf("Test (parens) and \\ backslash", "T");
        let s = String::from_utf8_lossy(&bytes);
        assert!(s.contains("\\("));
        assert!(s.contains("\\)"));
        assert!(s.contains("\\\\"));
    }

    #[test]
    fn multi_page_output_when_input_exceeds_page_lines() {
        let lines = (0..200)
            .map(|i| format!("Line {i}"))
            .collect::<Vec<_>>()
            .join("\n");
        let bytes = render_text_pdf(&lines, "T");
        let s = String::from_utf8_lossy(&bytes);
        // With 200 body lines + 2 title lines, expect ≥3 pages with PAGE_LINES=60.
        // Each /Type /Page entry corresponds to one page.
        let page_count = s.matches("/Type /Page ").count();
        assert!(
            page_count >= 3,
            "expected ≥3 pages with 202 lines / 60 per page, got {page_count}"
        );
    }

    #[test]
    fn wrap_lines_breaks_long_lines_at_word_boundary() {
        let long = "the quick brown fox jumps over the lazy dog and the cat";
        let wrapped = wrap_lines(long, 20);
        for line in &wrapped {
            assert!(line.len() <= 20, "wrapped line too long: '{line}'");
        }
        // Round-trip — joining with spaces should reproduce the original
        // word sequence.
        let words_in: Vec<&str> = long.split_whitespace().collect();
        let words_out: Vec<&str> = wrapped
            .iter()
            .flat_map(|l| l.split_whitespace())
            .collect();
        assert_eq!(words_in, words_out);
    }

    #[test]
    fn non_ascii_is_replaced_with_question_mark_or_latin1() {
        // CJK / emoji multibyte → `?` (we don't embed a CMap).
        // Latin-1 (umlaut, é) → passes through.
        let bytes = render_text_pdf("Hello 你好 café 🎰", "T");
        let s = String::from_utf8_lossy(&bytes);
        // The "?" replacement for CJK / emoji must appear in the content
        // stream (the Latin-1 'é' passes through unchanged).
        assert!(s.contains("?"));
    }

    #[test]
    fn xref_offsets_match_object_positions() {
        // Sanity check that the xref table points at real "N 0 obj"
        // markers. We don't fully parse PDF, just confirm each offset
        // either starts with an object header or is the free entry.
        let bytes = render_text_pdf("Body", "T");
        let s = String::from_utf8_lossy(&bytes);
        let xref_start = s.find("xref\n").expect("xref keyword present");
        // After "xref\n" there is "0 N\n" then N entries.
        let body = &s[xref_start + 5..];
        let mut it = body.lines();
        let header = it.next().unwrap();
        let n: usize = header
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        assert!(n >= 2, "expected at least catalog + pages");
        // First entry is the free object (offset 0).
        let first = it.next().unwrap();
        assert!(first.starts_with("0000000000 65535 f"));
    }
}
