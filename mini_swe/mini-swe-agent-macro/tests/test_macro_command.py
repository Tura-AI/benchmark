import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

from minisweagent.macro_command import (
    action_for_command_run,
    active_shell_command_name,
    apply_patch,
    command_run_tool,
    execute_command_run,
)
from minisweagent.models.utils.actions_toolcall import parse_toolcall_actions
from minisweagent.models.utils.actions_toolcall_response import parse_toolcall_actions_response


def command(command_line: str, step: int = 1, command_type: str | None = None) -> dict:
    return {
        "command_type": command_type or active_shell_command_name(),
        "command_line": command_line,
        "step": step,
    }


def test_provider_schemas_expose_only_command_run():
    chat = command_run_tool(responses_api=False)
    responses = command_run_tool(responses_api=True)

    assert chat["function"]["name"] == responses["name"] == "command_run"
    assert chat["function"]["strict"] is responses["strict"] is True
    assert chat["function"]["parameters"] == responses["parameters"]
    assert chat["function"]["parameters"]["properties"]["commands"]["items"]["properties"][
        "command_type"
    ]["enum"] == [active_shell_command_name(), "apply_patch"]
    assert "tura" not in json.dumps(chat).lower()


def test_both_api_parsers_wrap_command_run_as_one_environment_action():
    arguments = {"commands": [command("echo hello")]}
    chat_call = SimpleNamespace(
        id="chat-call",
        function=SimpleNamespace(name="command_run", arguments=json.dumps(arguments)),
    )
    response_call = {
        "type": "function_call",
        "call_id": "response-call",
        "name": "command_run",
        "arguments": json.dumps(arguments),
    }

    chat_action = parse_toolcall_actions([chat_call], format_error_template="{{ error }}")[0]
    response_action = parse_toolcall_actions_response(
        [response_call], format_error_template="{{ error }}"
    )[0]

    assert chat_action["command_run"] == response_action["command_run"] == arguments
    assert chat_action["tool_call_id"] == "chat-call"
    assert response_action["tool_call_id"] == "response-call"
    assert "minisweagent.macro_command" in chat_action["command"]


def test_macro_runner_preserves_result_order_and_step_dependencies(tmp_path: Path):
    create = 'python -c "from pathlib import Path; Path(\'marker.txt\').write_text(\'ready\')"'
    read = 'python -c "from pathlib import Path; print(Path(\'marker.txt\').read_text())"'
    output = execute_command_run(
        {"commands": [command(create, 1), command(read, 2)]},
        tmp_path,
    )

    assert [result["step"] for result in output["results"]] == [1, 2]
    assert all(result["success"] for result in output["results"])
    assert output["results"][1]["output"]["stdout"].strip() == "ready"


def test_internal_python_is_the_macro_environment_python(tmp_path: Path):
    output = execute_command_run(
        {"commands": [command('python -c "import sys; print(sys.executable)"')]},
        tmp_path,
    )

    reported = Path(output["results"][0]["output"]["stdout"].strip()).resolve()
    assert reported == Path(sys.executable).resolve()


def test_repeated_step_execution_is_stable(tmp_path: Path):
    for iteration in range(10):
        output = execute_command_run(
            {
                "commands": [
                    command(
                        "python -c \"from pathlib import Path; "
                        f"Path('iteration.txt').write_text('{iteration}')\"",
                        1,
                    ),
                    command(
                        'python -c "from pathlib import Path; print(Path(\'iteration.txt\').read_text())"',
                        2,
                    ),
                ]
            },
            tmp_path,
        )

        assert all(result["success"] for result in output["results"])
        assert output["results"][1]["output"]["stdout"].strip() == str(iteration)


def test_apply_patch_add_update_delete(tmp_path: Path):
    assert "sample.txt" in apply_patch(
        """*** Begin Patch
*** Add File: sample.txt
+alpha
+beta
*** End Patch""",
        tmp_path,
    )
    assert (tmp_path / "sample.txt").read_text() == "alpha\nbeta\n"

    apply_patch(
        """*** Begin Patch
*** Update File: sample.txt
@@
 alpha
-beta
+gamma
*** End Patch""",
        tmp_path,
    )
    assert (tmp_path / "sample.txt").read_text() == "alpha\ngamma\n"

    apply_patch(
        """*** Begin Patch
*** Delete File: sample.txt
*** End Patch""",
        tmp_path,
    )
    assert not (tmp_path / "sample.txt").exists()


def test_failed_patch_cancels_later_steps(tmp_path: Path):
    marker = tmp_path / "must-not-exist.txt"
    output = execute_command_run(
        {
            "commands": [
                command(
                    """*** Begin Patch
*** Update File: missing.txt
@@
-old
+new
*** End Patch""",
                    1,
                    "apply_patch",
                ),
                command(
                    f'python -c "from pathlib import Path; Path(r\"{marker}\").write_text(\"bad\")"',
                    2,
                ),
            ]
        },
        tmp_path,
    )

    assert output["cancelled"] is True
    assert len(output["results"]) == 1
    assert not marker.exists()


def test_encoded_action_runs_without_tura_dependency(tmp_path: Path):
    action = action_for_command_run({"commands": [command("echo macro-ok")]}, "call")
    completed = subprocess.run(
        action["command"],
        cwd=tmp_path,
        shell=True,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )

    assert completed.returncode == 0
    payload = json.loads(completed.stdout)
    assert payload["results"][0]["output"]["stdout"].strip() == "macro-ok"


def test_submission_remains_a_standalone_one_command_batch(tmp_path: Path):
    action = action_for_command_run(
        {"commands": [command("echo COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT")]},
        "call",
    )
    completed = subprocess.run(
        action["command"],
        cwd=tmp_path,
        shell=True,
        text=True,
        capture_output=True,
        encoding="utf-8",
        errors="replace",
        timeout=30,
    )

    assert completed.returncode == 0
    assert completed.stdout.strip() == "COMPLETE_TASK_AND_SUBMIT_FINAL_OUTPUT"
