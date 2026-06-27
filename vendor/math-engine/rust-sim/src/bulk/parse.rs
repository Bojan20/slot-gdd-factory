//! Parse human-friendly spin-count strings: `"1000"`, `"5M"`, `"100B"`,
//! `"1T"`, `"2_500_000"`, `"1.5B"`.
//!
//! Suffix unit table:
//!   K = 10^3
//!   M = 10^6
//!   B = 10^9
//!   T = 10^12
//!
//! Decimals allowed before the suffix (`"1.5B"` = 1_500_000_000). Underscore
//! separators allowed anywhere (`"100_000"` = 100_000). Negative values
//! rejected. Overflow rejected.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ParseSpinCountError {
    Empty,
    InvalidNumber(String),
    UnknownSuffix(char),
    Overflow,
    Negative,
}

impl std::fmt::Display for ParseSpinCountError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Empty => write!(f, "empty string"),
            Self::InvalidNumber(s) => write!(f, "invalid number '{s}'"),
            Self::UnknownSuffix(c) => {
                write!(f, "unknown suffix '{c}' (expected K/M/B/T)")
            }
            Self::Overflow => write!(f, "spin count overflows u64"),
            Self::Negative => write!(f, "spin count must be non-negative"),
        }
    }
}

impl std::error::Error for ParseSpinCountError {}

pub fn parse_spin_count(input: &str) -> Result<u64, ParseSpinCountError> {
    let trimmed: String = input
        .trim()
        .chars()
        .filter(|c| *c != '_' && !c.is_whitespace())
        .collect();
    if trimmed.is_empty() {
        return Err(ParseSpinCountError::Empty);
    }

    // Pull off optional trailing suffix.
    let (number_part, multiplier) = match trimmed.chars().last() {
        Some(c) if c.is_ascii_alphabetic() => {
            let mul = match c.to_ascii_uppercase() {
                'K' => 1_000_u64,
                'M' => 1_000_000_u64,
                'B' => 1_000_000_000_u64,
                'T' => 1_000_000_000_000_u64,
                other => return Err(ParseSpinCountError::UnknownSuffix(other)),
            };
            (&trimmed[..trimmed.len() - 1], mul)
        }
        _ => (trimmed.as_str(), 1_u64),
    };

    if number_part.is_empty() {
        return Err(ParseSpinCountError::InvalidNumber(input.into()));
    }
    if number_part.starts_with('-') {
        return Err(ParseSpinCountError::Negative);
    }

    // Support optional fractional part for the suffix forms (`"1.5B"`).
    let value_f64: f64 = number_part
        .parse()
        .map_err(|_| ParseSpinCountError::InvalidNumber(input.into()))?;
    if !value_f64.is_finite() || value_f64 < 0.0 {
        return Err(ParseSpinCountError::Negative);
    }

    // Multiply in f64 then check fits in u64.
    let scaled = value_f64 * multiplier as f64;
    if scaled > (u64::MAX as f64) {
        return Err(ParseSpinCountError::Overflow);
    }
    // Round-half-to-even via `.round()` — but for these inputs the
    // fractional cancellation against the multiplier is exact for
    // typical cases (1.5B → 1_500_000_000.0 exactly).
    Ok(scaled.round() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plain_integer() {
        assert_eq!(parse_spin_count("1000").unwrap(), 1_000);
        assert_eq!(parse_spin_count("0").unwrap(), 0);
        assert_eq!(parse_spin_count("1_000_000").unwrap(), 1_000_000);
    }

    #[test]
    fn suffixed_integers() {
        assert_eq!(parse_spin_count("5K").unwrap(), 5_000);
        assert_eq!(parse_spin_count("5M").unwrap(), 5_000_000);
        assert_eq!(parse_spin_count("100B").unwrap(), 100_000_000_000);
        assert_eq!(parse_spin_count("1T").unwrap(), 1_000_000_000_000);
    }

    #[test]
    fn fractional_with_suffix() {
        assert_eq!(parse_spin_count("1.5B").unwrap(), 1_500_000_000);
        assert_eq!(parse_spin_count("2.5T").unwrap(), 2_500_000_000_000);
    }

    #[test]
    fn rejects_negative() {
        assert!(matches!(
            parse_spin_count("-5M"),
            Err(ParseSpinCountError::Negative)
        ));
    }

    #[test]
    fn rejects_unknown_suffix() {
        assert!(matches!(
            parse_spin_count("5X"),
            Err(ParseSpinCountError::UnknownSuffix('X'))
        ));
    }

    #[test]
    fn rejects_empty() {
        assert!(matches!(
            parse_spin_count(""),
            Err(ParseSpinCountError::Empty)
        ));
        assert!(matches!(
            parse_spin_count("   "),
            Err(ParseSpinCountError::Empty)
        ));
    }

    #[test]
    fn rejects_invalid_input() {
        // 'abc' lands on the suffix path ('c' is parsed as a suffix
        // first, then rejected as unknown). 'X' is the unambiguous
        // unknown-suffix case. We care that the parser refuses both
        // with a *structured* error variant, not silently coerces.
        assert!(matches!(
            parse_spin_count("abc"),
            Err(ParseSpinCountError::UnknownSuffix(_) | ParseSpinCountError::InvalidNumber(_))
        ));
        assert!(matches!(
            parse_spin_count("1.5.3B"),
            Err(ParseSpinCountError::InvalidNumber(_))
        ));
    }

    #[test]
    fn case_insensitive_suffix() {
        assert_eq!(parse_spin_count("1t").unwrap(), 1_000_000_000_000);
        assert_eq!(parse_spin_count("100b").unwrap(), 100_000_000_000);
    }

    #[test]
    fn underscore_with_suffix() {
        assert_eq!(parse_spin_count("2_500M").unwrap(), 2_500_000_000);
    }
}
