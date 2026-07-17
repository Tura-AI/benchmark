#!/usr/bin/env python3
import csv
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path


TASK = os.environ["SOURCE_PORT_TASK"]
TARGET_LANGUAGE = os.environ.get("SOURCE_PORT_TARGET_LANGUAGE", "Python")
REFERENCE_BINARY = Path(os.environ["SOURCE_PORT_REFERENCE_BINARY"])
SOURCE_PORT_CASES = os.environ.get("SOURCE_PORT_CASES")
GENERIC_CASE_PAYLOAD = None


def quote_cmd_arg(value):
    text = str(value)
    if text and not re.search(r'[\\s"&<>|^%]', text):
        return text
    return '"' + text.replace('"', '""') + '"'


def command_argv(argv):
    argv = [str(x) for x in argv]
    if os.name == "nt" and argv and argv[0].lower().endswith((".cmd", ".bat")):
        return " ".join(quote_cmd_arg(x) for x in argv)
    return argv


def find_shell():
    candidates = [shutil.which("sh"), shutil.which("bash")]
    if os.name == "nt":
        candidates.extend([
            r"C:\Program Files\Git\bin\sh.exe",
            r"C:\Program Files\Git\usr\bin\sh.exe",
            r"C:\Program Files\Git\bin\bash.exe",
            r"C:\Program Files\Git\usr\bin\bash.exe",
        ])
    for candidate in candidates:
        if not candidate:
            continue
        lower = str(candidate).replace("\\", "/").lower()
        if os.name == "nt" and lower.endswith("/windows/system32/bash.exe"):
            continue
        if Path(candidate).exists():
            return candidate
    return None


def run_cmd(argv, cwd, stdin=None, timeout=30):
    command = command_argv(argv)
    try:
        proc = subprocess.run(
            command,
            cwd=str(cwd),
            input=stdin,
            text=True,
            encoding="utf-8",
            errors="replace",
            capture_output=True,
            timeout=timeout,
            shell=isinstance(command, str),
            env={**os.environ, "NO_COLOR": "1", "CLICOLOR": "0", "TERM": "dumb", "PYTHONIOENCODING": "utf-8", "PYTHONUTF8": "1"},
        )
        return {"status": proc.returncode, "stdout": proc.stdout, "stderr": proc.stderr, "timed_out": False}
    except subprocess.TimeoutExpired as exc:
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode("utf-8", "replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode("utf-8", "replace")
        timeout_stderr = (stderr + "\n" if stderr else "") + f"TIMEOUT after {timeout}s: {' '.join(str(x) for x in argv)}"
        return {"status": 124, "stdout": stdout, "stderr": timeout_stderr, "timed_out": True}


def normalize(text):
    text = text or ""
    text = text.replace("\r\n", "\n")
    text = re.sub(r"\x1b\[[0-9;?]*[A-Za-z]", "", text)
    text = re.sub(r"Time elapsed: [^\n]*", "Time elapsed: <DURATION>", text)
    text = re.sub(r"\b\d+(?:\.\d+)?\s*(?:ns|us|µs|ms|s)\b", "<DURATION>", text)
    return text


def compact(text):
    return " ".join(normalize(text).split())


def split_lines(text):
    return [line.rstrip() for line in normalize(text).splitlines() if line.strip()]


def parse_csv_text(text):
    try:
        return list(csv.reader(normalize(text).splitlines()))
    except Exception:
        return None


def normalize_scalar(text):
    value = compact(text).strip()
    if re.fullmatch(r"-?\d+(?:\.\d+)?", value):
        return str(float(value)).rstrip("0").rstrip(".")
    return value.strip('"').strip("'")


def same_status(actual, expected):
    return actual["status"] == expected["status"]


def same_csv(actual, expected):
    if not same_status(actual, expected):
        return False
    if normalize(actual["stderr"]) != normalize(expected["stderr"]):
        return False
    actual_rows = parse_csv_text(actual["stdout"])
    expected_rows = parse_csv_text(expected["stdout"])
    return actual_rows is not None and actual_rows == expected_rows


def same_csv_unordered_body(actual, expected):
    if not same_status(actual, expected):
        return False
    if normalize(actual["stderr"]) != normalize(expected["stderr"]):
        return False
    actual_rows = parse_csv_text(actual["stdout"])
    expected_rows = parse_csv_text(expected["stdout"])
    if actual_rows is None or expected_rows is None:
        return False
    return actual_rows[:1] == expected_rows[:1] and sorted(actual_rows[1:]) == sorted(expected_rows[1:])


def same_sample_csv(actual, expected):
    if not same_status(actual, expected):
        return False
    if normalize(actual["stderr"]) != normalize(expected["stderr"]):
        return False
    actual_rows = parse_csv_text(actual["stdout"])
    expected_rows = parse_csv_text(expected["stdout"])
    return (
        actual_rows is not None
        and expected_rows is not None
        and len(actual_rows) == len(expected_rows)
        and (not expected_rows or actual_rows[0] == expected_rows[0])
    )


def same_normalized_streams(actual, expected):
    return (
        same_status(actual, expected)
        and normalize(actual["stdout"]) == normalize(expected["stdout"])
        and normalize(actual["stderr"]) == normalize(expected["stderr"])
    )


def same_line_set(actual, expected):
    return (
        same_status(actual, expected)
        and normalize(actual["stderr"]) == normalize(expected["stderr"])
        and sorted(split_lines(actual["stdout"])) == sorted(split_lines(expected["stdout"]))
    )


def scrub_json_timing(value):
    if isinstance(value, list):
        return [scrub_json_timing(item) for item in value]
    if isinstance(value, dict):
        return {
            key: scrub_json_timing(item)
            for key, item in value.items()
            if key not in {"elapsed", "elapsed_total"}
        }
    return value


def json_lines(text):
    rows = []
    for line in normalize(text).splitlines():
        if line.strip():
            rows.append(scrub_json_timing(json.loads(line)))
    return rows


def same_json_lines(actual, expected):
    if not same_status(actual, expected):
        return False
    if normalize(actual["stderr"]) != normalize(expected["stderr"]):
        return False
    try:
        return json_lines(actual["stdout"]) == json_lines(expected["stdout"])
    except Exception:
        return False


def same_scalar(actual, expected):
    if not same_status(actual, expected):
        return False
    if expected["status"] != 0:
        return bool(compact(actual["stderr"]) or compact(actual["stdout"]))
    expected_out = normalize_scalar(expected["stdout"])
    actual_out = normalize_scalar(actual["stdout"])
    if expected_out in {"true", "false"}:
        return actual_out.lower() == expected_out
    return actual_out == expected_out


def same_json_or_scalar(actual, expected):
    if not same_status(actual, expected):
        return False
    if expected["status"] != 0:
        return bool(compact(actual["stderr"]) or compact(actual["stdout"]))
    try:
        return json.loads(actual["stdout"]) == json.loads(expected["stdout"])
    except Exception:
        return same_scalar(actual, expected)


def known_fixture_entries(fx):
    names = {
        "Cargo.toml", "README.md", "empty.txt", "exec.sh", "long name file.txt",
        "notes.txt", "script.py", "semi.csv", "people.csv", "people2.csv",
        "no_headers.csv", "unequal.csv", "sub", "nested.txt", "data.log",
        "deep", "final.md", ".hidden", "link-notes",
    }
    return sorted(names, key=len, reverse=True)


def eza_entries(text, fx):
    clean = normalize(text).replace("\\", "/").replace("//?/", "")
    found = []
    for name in known_fixture_entries(fx):
        pattern = re.escape(name).replace("\\ ", r"\s+")
        if re.search(r"(?<![\w.-])" + pattern + r"[/@*|=]?(?![\w.-])", clean):
            found.append(name)
    return set(found)


def eza_order(text, fx):
    clean = normalize(text).replace("\\", "/").replace("//?/", "")
    positions = []
    for name in known_fixture_entries(fx):
        idx = clean.find(name)
        if idx >= 0:
            positions.append((idx, name))
    return [name for _, name in sorted(positions)]


def eza_classifiers(text, fx):
    clean = normalize(text).replace("\\", "/").replace("//?/", "")
    markers = {}
    for name in known_fixture_entries(fx):
        pattern = re.escape(name).replace("\\ ", r"\s+")
        match = re.search(r"(?<![\w.-])" + pattern + r"([/@*|=])?(?:\s+->\s+[^\\n]+)?", clean)
        if match:
            marker = match.group(1) or ("@" if " -> " in match.group(0) else "")
            markers[name] = marker
    return markers


def same_eza(actual, expected, case, fx):
    if not same_status(actual, expected):
        return False
    if case.get("comparison") == "normalized_streams":
        return same_normalized_streams(actual, expected)
    if expected["status"] != 0:
        return same_normalized_streams(actual, expected)
    if normalize(actual["stderr"]) != normalize(expected["stderr"]):
        return False
    name = case["name"]
    actual_entries = eza_entries(actual["stdout"], fx)
    expected_entries = eza_entries(expected["stdout"], fx)
    if name == "absolute":
        actual_text = normalize(actual["stdout"]).replace("\\", "/")
        expected_text = normalize(expected["stdout"]).replace("\\", "/")
        return "notes.txt" in actual_entries and ("/" in actual_text or "/" in expected_text)
    if name == "classify always":
        return eza_classifiers(actual["stdout"], fx) == eza_classifiers(expected["stdout"], fx)
    if name.startswith("sort ") or name in {"group dirs first", "multiple paths"}:
        return eza_order(actual["stdout"], fx) == eza_order(expected["stdout"], fx)
    return actual_entries == expected_entries


def zip_password(text):
    match = re.search(r"(?:password|found)[^A-Za-z0-9]+([A-Za-z0-9_!@#$%^&*.-]+)", normalize(text), re.I)
    return match.group(1) if match else None


def same_zip(actual, expected):
    if not same_status(actual, expected):
        return False
    if expected["status"] != 0:
        return bool(compact(actual["stderr"]) or compact(actual["stdout"]))
    expected_password = zip_password(expected["stdout"] + "\n" + expected["stderr"])
    actual_password = zip_password(actual["stdout"] + "\n" + actual["stderr"])
    if expected_password:
        return actual_password == expected_password
    return compact(actual["stdout"]) == compact(expected["stdout"])


def same_business(task, case, actual, expected, fx):
    if task == "zip-password-finder":
        return same_zip(actual, expected)
    if task == "xsv":
        if case.get("comparison") == "normalized_streams":
            return same_normalized_streams(actual, expected)
        if case.get("comparison") == "csv_unordered_body":
            return same_csv_unordered_body(actual, expected)
        if case.get("comparison") == "sample_csv":
            return same_sample_csv(actual, expected)
        return same_csv(actual, expected)
    if task == "eza":
        return same_eza(actual, expected, case, fx)
    if task == "nushell":
        if case["name"].startswith("help "):
            topic = case["name"].replace("help ", "")
            return same_status(actual, expected) and topic in normalize(actual["stdout"]).lower()
        if case["name"] in {"csv select"}:
            return same_csv(actual, expected)
        return same_json_or_scalar(actual, expected)
    if case.get("comparison") == "line_set":
        return same_line_set(actual, expected)
    if case.get("comparison") == "json_lines":
        return same_json_lines(actual, expected)
    if case.get("comparison") == "status_only":
        return same_status(actual, expected)
    return same_normalized_streams(actual, expected)


def write(path, text):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def make_fixtures(root):
    fx = root / "fixtures"
    fx.mkdir(parents=True, exist_ok=True)
    write(fx / "people.csv", "name,city,age,score\nalice,Paris,30,8.5\nbob,Berlin,22,7\ncarol,Paris,41,9.25\ndave,New York,30,8.5\neve,Berlin,,6\n")
    write(fx / "people2.csv", "name,city,age,score\nfrank,Rome,28,6.5\ngrace,Paris,35,8\n")
    write(fx / "cities.csv", "city,country\nParis,FR\nBerlin,DE\nRome,IT\n")
    write(fx / "semi.csv", "name;city;age\nana;Lisbon;10\nbea;Porto;12\n")
    write(fx / "no_headers.csv", "a,1,red\nb,2,blue\nc,3,red\n")
    write(fx / "unequal.csv", "a,b,c\n1,2\n3,4,5,6\n")
    write(fx / "notes.txt", "alpha\nbeta\nalphabet\n")
    write(fx / "empty.txt", "")
    write(fx / "long name file.txt", "spaces\n")
    write(fx / "script.py", "print('hello')\n# TODO: inspect\n")
    write(fx / "unused_import.py", "import os\n\nprint('hello')\n")
    write(fx / "undefined.py", "print(missing_name)\n")
    write(fx / "exec.sh", "#!/bin/sh\necho hi\n")
    write(fx / "README.md", "# Demo\n\nhello world\n")
    write(fx / "Cargo.toml", "[package]\nname = \"demo\"\nversion = \"0.1.0\"\n")
    write(fx / "data.json", "{\"name\":\"alice\",\"age\":30,\"items\":[1,2,3]}\n")
    write(fx / "data.xml", "<root><name>alice</name><item color=\"red\">one</item><item color=\"blue\">two</item></root>\n")
    write(fx / "config.yaml", "name: alice\nage: 30\nitems:\n  - red\n  - blue\n")
    write(fx / "multi.yaml", "---\nname: alice\nage: 30\n---\ncity: Paris\nscore: 8\n")
    write(fx / "expr.yq", ".items | length\n")
    write(fx / "valid.ts", "const answer: number = 42;\nconsole.log(answer);\n")
    write(fx / "invalid.ts", "const answer: number = 'forty-two';\n")
    write(fx / "tsconfig.json", "{\"compilerOptions\":{\"strict\":true,\"target\":\"es2017\",\"module\":\"commonjs\",\"noEmit\":true},\"files\":[\"valid.ts\"]}\n")
    write(fx / "sample.js", "const demo={alpha:1,beta:2};\nconsole.log(demo)\n")
    write(fx / "sample.ts", "type User={name:string;age:number}\nconst user:User={name:'alice',age:30}\n")
    write(fx / "sample.html", "<div><span>Hello</span><span>world</span></div>\n")
    write(fx / "sample.css", "body{color:red;background:white}.item{display:flex;gap:4px}\n")
    write(fx / "sample.yaml", "name: alice\nitems: [red, blue]\n")
    write(fx / ".prettierrc", "{\"singleQuote\":true,\"semi\":false}\n")
    write(fx / "unformatted.py", "def add(a,b):\n    return(a+b)\n")
    write(fx / "bad_py.py", "def broken(:\n    pass\n")
    write(fx / "Hello.java", "public class Hello { public static void main(String[] args) { System.out.println(\"hi\"); } }\n")
    write(fx / "Bad.java", "public class Bad { public static void main(String[] args) { System.out.println(\"bad\") } }\n")
    write(fx / "Imports.java", "import java.util.List;\nimport java.io.File;\nimport java.util.ArrayList;\npublic class Imports { List<String> names = new ArrayList<>(); }\n")
    write(fx / "JavadocExample.java", "/** Example class. */\npublic class JavadocExample { /** Returns one. */ int one() { return 1; } }\n")
    write(fx / "javadoc-comment.txt", " Example method.\n @param value input value\n @return output value\n")
    (fx / ".hidden").write_text("hidden\n", encoding="utf-8")
    sub = fx / "sub"
    sub.mkdir(exist_ok=True)
    write(sub / "nested.txt", "nested\n")
    write(sub / "data.log", "alpha log\n")
    deep = sub / "deep"
    deep.mkdir(exist_ok=True)
    write(deep / "final.md", "final\n")
    try:
        (fx / "link-notes").symlink_to(fx / "notes.txt")
    except Exception:
        pass
    return fx


def expand_case_value(value, fx):
    replacements = {
        "fixtures": str(fx),
        "people_csv": str(fx / "people.csv"),
        "people2_csv": str(fx / "people2.csv"),
        "cities_csv": str(fx / "cities.csv"),
        "semi_csv": str(fx / "semi.csv"),
        "no_headers_csv": str(fx / "no_headers.csv"),
        "notes_txt": str(fx / "notes.txt"),
        "readme_md": str(fx / "README.md"),
        "script_py": str(fx / "script.py"),
        "bad_py": str(fx / "bad_py.py"),
        "unformatted_py": str(fx / "unformatted.py"),
        "unused_import_py": str(fx / "unused_import.py"),
        "undefined_py": str(fx / "undefined.py"),
        "cargo_toml": str(fx / "Cargo.toml"),
        "data_json": str(fx / "data.json"),
        "data_xml": str(fx / "data.xml"),
        "config_yaml": str(fx / "config.yaml"),
        "multi_yaml": str(fx / "multi.yaml"),
        "expr_yq": str(fx / "expr.yq"),
        "valid_ts": str(fx / "valid.ts"),
        "invalid_ts": str(fx / "invalid.ts"),
        "tsconfig_json": str(fx / "tsconfig.json"),
        "ts_out": str(fx / "ts-out"),
        "declaration_out": str(fx / "declaration-out"),
        "sample_js": str(fx / "sample.js"),
        "sample_ts": str(fx / "sample.ts"),
        "sample_html": str(fx / "sample.html"),
        "sample_css": str(fx / "sample.css"),
        "sample_yaml": str(fx / "sample.yaml"),
        "hello_java": str(fx / "Hello.java"),
        "bad_java": str(fx / "Bad.java"),
        "imports_java": str(fx / "Imports.java"),
        "javadoc_java": str(fx / "JavadocExample.java"),
        "javadoc_comment": str(fx / "javadoc-comment.txt"),
        "checkstyle_out": str(fx / "checkstyle-out.txt"),
        "empty_txt": str(fx / "empty.txt"),
    }
    if isinstance(value, str):
        out = value
        for key, item in replacements.items():
            out = out.replace("{{" + key + "}}", item)
        return out
    if isinstance(value, list):
        return [expand_case_value(item, fx) for item in value]
    if isinstance(value, dict):
        return {key: expand_case_value(item, fx) for key, item in value.items()}
    return value


def generic_case_payload():
    global GENERIC_CASE_PAYLOAD
    if GENERIC_CASE_PAYLOAD is not None:
        return GENERIC_CASE_PAYLOAD
    case_file = Path(SOURCE_PORT_CASES) if SOURCE_PORT_CASES else Path.cwd() / "SOURCE_PORT_CASES.json"
    if not case_file.exists():
        raise AssertionError(f"missing generic case file for {TASK}: {case_file}")
    GENERIC_CASE_PAYLOAD = json.loads(case_file.read_text(encoding="utf-8"))
    return GENERIC_CASE_PAYLOAD


def generic_cases(fx):
    raw = generic_case_payload()
    cases = raw.get("cases", raw) if isinstance(raw, dict) else raw
    if not isinstance(cases, list) or not cases:
        raise AssertionError(f"generic case file must contain a non-empty cases array for {TASK}")
    return [expand_case_value(case, fx) for case in cases]


def generic_coverage():
    raw = generic_case_payload()
    if not isinstance(raw, dict):
        return {}
    coverage = raw.get("coverage") or {}
    return coverage if isinstance(coverage, dict) else {}


def zip_cases(fx):
    zips = Path("rust-reference") / "test-files"
    dict_file = zips / "generated-passwords-lowercase.txt"
    two = zips / "2.test.txt.zip"
    three = zips / "3.test.txt.zip"
    return [
        {"name": "find generated", "kind": "success", "feature": "bruteforce-lowercase", "args": ["-i", str(two), "-c", "l", "--maxPasswordLen", "2", "-w", "1"], "timeout": 90},
        {"name": "find generated starting password", "kind": "success", "feature": "starting-password", "args": ["-i", str(three), "-c", "l", "--maxPasswordLen", "3", "-s", "abc", "-w", "1"], "timeout": 90},
        {"name": "not found", "kind": "success", "feature": "not-found", "args": ["-i", str(two), "-c", "l", "--maxPasswordLen", "1", "-w", "1"], "timeout": 90},
        {"name": "dictionary", "kind": "success", "feature": "dictionary", "args": ["-i", str(two), "-p", str(dict_file), "-w", "1"], "timeout": 90},
        {"name": "mask two lowercase", "kind": "success", "feature": "mask", "args": ["-i", str(two), "--mask", "?l?l", "-w", "1"], "timeout": 90},
        {"name": "mask custom charset", "kind": "success", "feature": "custom-charset", "args": ["-i", str(two), "--mask", "?1?1", "-1", "ab", "-w", "1"], "timeout": 90},
        {"name": "missing input", "kind": "error", "feature": "missing-input", "args": ["-i", "missing.zip"]},
        {"name": "workers zero", "kind": "error", "feature": "invalid-workers", "args": ["-i", str(two), "-w", "0"]},
        {"name": "min zero", "kind": "error", "feature": "invalid-length", "args": ["-i", str(two), "--minPasswordLen", "0"]},
        {"name": "max before min", "kind": "error", "feature": "invalid-range", "args": ["-i", str(two), "--minPasswordLen", "3", "--maxPasswordLen", "2"]},
        {"name": "file number missing", "kind": "error", "feature": "missing-file-number", "args": ["-i", str(two), "--fileNumber", "99", "-c", "l", "--maxPasswordLen", "2"]},
    ]


def xsv_cases(fx):
    people = fx / "people.csv"
    people2 = fx / "people2.csv"
    cities = fx / "cities.csv"
    semi = fx / "semi.csv"
    no_headers = fx / "no_headers.csv"
    split_dir = fx / "split-out"
    partition_dir = fx / "partition-out"
    return [
        {"name": "headers", "kind": "success", "args": ["headers", str(people)]},
        {"name": "headers missing", "kind": "error", "args": ["headers", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "headers names", "kind": "success", "args": ["headers", "--just-names", str(people)]},
        {"name": "count file", "kind": "success", "args": ["count", str(people)]},
        {"name": "count stdin", "kind": "success", "args": ["count"], "stdin_file": people},
        {"name": "count missing", "kind": "error", "args": ["count", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "cat rows", "kind": "success", "args": ["cat", "rows", str(people), str(people2)]},
        {"name": "cat columns", "kind": "success", "args": ["cat", "columns", str(people), str(people2)]},
        {"name": "cat invalid mode", "kind": "error", "args": ["cat", "diagonal", str(people)], "comparison": "normalized_streams"},
        {"name": "select", "kind": "success", "args": ["select", "city,name", str(people)]},
        {"name": "select range", "kind": "success", "args": ["select", "1-2", str(people)]},
        {"name": "select no headers", "kind": "success", "args": ["select", "--no-headers", "1,3", str(no_headers)]},
        {"name": "select invert", "kind": "success", "args": ["select", "!score", str(people)]},
        {"name": "select missing column", "kind": "error", "args": ["select", "not-a-column", str(people)], "comparison": "normalized_streams"},
        {"name": "slice", "kind": "success", "args": ["slice", "-s", "1", "-l", "2", str(people)]},
        {"name": "slice end", "kind": "success", "args": ["slice", "-e", "3", str(people)]},
        {"name": "slice invalid range", "kind": "error", "args": ["slice", "-s", "3", "-e", "1", str(people)], "comparison": "normalized_streams"},
        {"name": "search", "kind": "success", "args": ["search", "-s", "city", "Berlin", str(people)]},
        {"name": "search regex", "kind": "success", "args": ["search", "-s", "name", "a.*e", str(people)]},
        {"name": "search invert", "kind": "success", "args": ["search", "-v", "-s", "city", "Berlin", str(people)]},
        {"name": "search missing column", "kind": "error", "args": ["search", "-s", "not-a-column", "Berlin", str(people)], "comparison": "normalized_streams"},
        {"name": "sort numeric", "kind": "success", "args": ["sort", "-s", "age", "-N", str(people)]},
        {"name": "sort numeric reverse", "kind": "success", "args": ["sort", "-s", "age", "-N", "-R", str(people)]},
        {"name": "sort reverse", "kind": "success", "args": ["sort", "-s", "city", "-R", str(people)]},
        {"name": "sort missing column", "kind": "error", "args": ["sort", "-s", "not-a-column", str(people)], "comparison": "normalized_streams"},
        {"name": "fmt delimiter", "kind": "success", "args": ["fmt", "-d", ";", str(semi)]},
        {"name": "fmt missing", "kind": "error", "args": ["fmt", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "input delimiter", "kind": "success", "args": ["input", "-d", ";", str(semi)]},
        {"name": "input missing", "kind": "error", "args": ["input", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "fixlengths", "kind": "success", "args": ["fixlengths", str(fx / "unequal.csv")]},
        {"name": "fixlengths missing", "kind": "error", "args": ["fixlengths", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "flatten", "kind": "success", "args": ["flatten", str(people)]},
        {"name": "flatten missing", "kind": "error", "args": ["flatten", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "table", "kind": "success", "args": ["table", str(people)]},
        {"name": "table missing", "kind": "error", "args": ["table", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "stats", "kind": "success", "args": ["stats", "-s", "age,score", str(people)]},
        {"name": "stats missing column", "kind": "error", "args": ["stats", "-s", "not-a-column", str(people)], "comparison": "normalized_streams"},
        {"name": "frequency", "kind": "success", "args": ["frequency", "-s", "city", str(people)], "comparison": "csv_unordered_body"},
        {"name": "frequency missing column", "kind": "error", "args": ["frequency", "-s", "not-a-column", str(people)], "comparison": "normalized_streams"},
        {"name": "join", "kind": "success", "args": ["join", "city", str(people), "city", str(cities)]},
        {"name": "join missing key", "kind": "error", "args": ["join", "not-a-column", str(people), "city", str(cities)], "comparison": "normalized_streams"},
        {"name": "sample", "kind": "success", "args": ["sample", "3", str(people)], "comparison": "sample_csv"},
        {"name": "sample invalid count", "kind": "error", "args": ["sample", "not-a-number", str(people)], "comparison": "normalized_streams"},
        {"name": "index", "kind": "success", "args": ["index", str(people)], "side_effects": [str(people) + ".idx"], "side_effect_mode": "exists"},
        {"name": "index missing", "kind": "error", "args": ["index", str(fx / "missing.csv")], "comparison": "normalized_streams"},
        {"name": "split", "kind": "success", "args": ["split", "-s", "2", str(split_dir), str(people)], "side_effects": [str(split_dir)]},
        {"name": "split invalid size", "kind": "error", "args": ["split", "-s", "0", str(split_dir), str(people)], "comparison": "normalized_streams"},
        {"name": "partition", "kind": "success", "args": ["partition", "city", str(partition_dir), str(people)], "side_effects": [str(partition_dir)]},
        {"name": "partition missing column", "kind": "error", "args": ["partition", "not-a-column", str(partition_dir), str(people)], "comparison": "normalized_streams"},
    ]


def eza_cases(fx):
    notes = fx / "notes.txt"
    readme = fx / "README.md"
    return [
        {"name": "plain", "kind": "success", "feature": "listing", "args": ["--color=never", "--icons=never", str(fx)]},
        {"name": "all", "kind": "success", "feature": "hidden", "args": ["--color=never", "--icons=never", "-a", str(fx)]},
        {"name": "almost all", "kind": "success", "feature": "hidden", "args": ["--color=never", "--icons=never", "-A", str(fx)]},
        {"name": "long", "kind": "success", "feature": "long-view", "args": ["--color=never", "--icons=never", "-l", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "long all", "kind": "success", "feature": "long-view", "args": ["--color=never", "--icons=never", "-la", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "long modified", "kind": "success", "feature": "time-fields", "args": ["--color=never", "--icons=never", "-l", "--modified", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "long changed", "kind": "success", "feature": "time-fields", "args": ["--color=never", "--icons=never", "-l", "--changed", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "long accessed", "kind": "success", "feature": "time-fields", "args": ["--color=never", "--icons=never", "-l", "--accessed", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "long created", "kind": "success", "feature": "time-fields", "args": ["--color=never", "--icons=never", "-l", "--created", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "tree", "kind": "success", "feature": "tree-recursion", "args": ["--color=never", "--icons=never", "-T", "-L", "2", str(fx)]},
        {"name": "tree level one", "kind": "success", "feature": "tree-recursion", "args": ["--color=never", "--icons=never", "-T", "-L", "1", str(fx)]},
        {"name": "sort extension", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--sort=extension", str(fx)]},
        {"name": "sort name reverse", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--sort=name", "-r", str(fx)]},
        {"name": "sort size", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--sort=size", str(fx)]},
        {"name": "sort modified", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--sort=modified", str(fx)]},
        {"name": "sort none", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "-U", str(fx)]},
        {"name": "one per line", "kind": "success", "feature": "display-modes", "args": ["--color=never", "--icons=never", "-1", str(fx)]},
        {"name": "classify", "kind": "success", "feature": "classify", "args": ["--color=never", "--icons=never", "-F", str(fx)]},
        {"name": "classify always", "kind": "success", "feature": "classify", "args": ["--color=never", "--icons=never", "--classify=always", str(fx)]},
        {"name": "only dirs", "kind": "success", "feature": "filtering", "args": ["--color=never", "--icons=never", "-D", str(fx)]},
        {"name": "only files", "kind": "success", "feature": "filtering", "args": ["--color=never", "--icons=never", "-f", str(fx)]},
        {"name": "treat dirs as files", "kind": "success", "feature": "filtering", "args": ["--color=never", "--icons=never", "-d", str(fx)]},
        {"name": "ignore glob", "kind": "success", "feature": "filtering", "args": ["--color=never", "--icons=never", "-I", "*.csv|*.toml", str(fx)]},
        {"name": "recurse", "kind": "success", "feature": "tree-recursion", "args": ["--color=never", "--icons=never", "-R", "-L", "2", str(fx)]},
        {"name": "recurse all", "kind": "success", "feature": "tree-recursion", "args": ["--color=never", "--icons=never", "-Ra", "-L", "2", str(fx)]},
        {"name": "grid", "kind": "success", "feature": "display-modes", "args": ["--color=never", "--icons=never", "-G", str(fx)]},
        {"name": "across", "kind": "success", "feature": "display-modes", "args": ["--color=never", "--icons=never", "-x", str(fx)]},
        {"name": "binary sizes", "kind": "success", "feature": "size-format", "args": ["--color=never", "--icons=never", "-l", "-b", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "bytes sizes", "kind": "success", "feature": "size-format", "args": ["--color=never", "--icons=never", "-l", "-B", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "header", "kind": "success", "feature": "long-view", "args": ["--color=never", "--icons=never", "-l", "--header", "--no-permissions", "--no-user", "--time-style=iso", str(fx)]},
        {"name": "group dirs first", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--group-directories-first", str(fx)]},
        {"name": "group dirs last", "kind": "success", "feature": "sorting", "args": ["--color=never", "--icons=never", "--group-directories-last", str(fx)]},
        {"name": "absolute", "kind": "success", "feature": "path-display", "args": ["--color=never", "--icons=never", "--absolute", str(notes)]},
        {"name": "no quotes", "kind": "success", "feature": "path-display", "args": ["--color=never", "--icons=never", "--no-quotes", str(fx)]},
        {"name": "single file", "kind": "success", "feature": "path-display", "args": ["--color=never", "--icons=never", str(notes)]},
        {"name": "multiple paths", "kind": "success", "feature": "path-display", "args": ["--color=never", "--icons=never", str(notes), str(readme)]},
        {"name": "stdin paths", "kind": "success", "feature": "stdin", "args": ["--color=never", "--icons=never", "--stdin"], "stdin": f"{notes}\\n{readme}\\n"},
        {"name": "extension display", "kind": "success", "feature": "path-display", "args": ["--color=never", "--icons=never", "--extension", str(fx)]},
        {"name": "invalid sort", "kind": "error", "feature": "invalid-option-value", "args": ["--color=never", "--icons=never", "--sort=definitely-not-sort", str(fx)], "comparison": "normalized_streams"},
        {"name": "invalid color", "kind": "error", "feature": "invalid-option-value", "args": ["--color=bogus", "--icons=never", str(fx)], "comparison": "normalized_streams"},
        {"name": "invalid icons", "kind": "error", "feature": "invalid-option-value", "args": ["--color=never", "--icons=bogus", str(fx)], "comparison": "normalized_streams"},
        {"name": "invalid classify", "kind": "error", "feature": "invalid-option-value", "args": ["--color=never", "--icons=never", "--classify=bogus", str(fx)], "comparison": "normalized_streams"},
        {"name": "invalid level", "kind": "error", "feature": "invalid-numeric-value", "args": ["--color=never", "--icons=never", "-T", "-L", "not-a-number", str(fx)], "comparison": "normalized_streams"},
        {"name": "missing level value", "kind": "error", "feature": "missing-required-value", "args": ["--color=never", "--icons=never", "-T", "-L"], "comparison": "normalized_streams"},
        {"name": "missing", "kind": "error", "feature": "missing-path", "args": ["--color=never", "--icons=never", str(fx / "missing")], "comparison": "normalized_streams"},
        {"name": "unknown option", "kind": "error", "feature": "unknown-option", "args": ["--color=never", "--icons=never", "--definitely-not-an-eza-flag", str(fx)], "comparison": "normalized_streams"},
    ]


def nushell_cases(fx):
    people = fx / "people.csv"
    return [
        {"name": "help math", "kind": "success", "feature": "help", "args": ["-c", "help math"]},
        {"name": "help open", "kind": "success", "feature": "help", "args": ["-c", "help open"]},
        {"name": "math", "kind": "success", "feature": "math", "args": ["-c", "1 + 2"]},
        {"name": "pipeline math", "kind": "success", "feature": "math", "args": ["-c", "[1 2 3 4] | math sum"]},
        {"name": "math avg", "kind": "success", "feature": "math", "args": ["-c", "[1 2 3 4] | math avg"]},
        {"name": "math min", "kind": "success", "feature": "math", "args": ["-c", "[1 2 3 4] | math min"]},
        {"name": "math max", "kind": "success", "feature": "math", "args": ["-c", "[1 2 3 4] | math max"]},
        {"name": "string", "kind": "success", "feature": "strings", "args": ["-c", "'hello' | str upcase"]},
        {"name": "string downcase", "kind": "success", "feature": "strings", "args": ["-c", "'HELLO' | str downcase"]},
        {"name": "string contains", "kind": "success", "feature": "strings", "args": ["-c", "'alphabet' | str contains 'alpha'"]},
        {"name": "string replace", "kind": "success", "feature": "strings", "args": ["-c", "'alpha beta' | str replace beta gamma"]},
        {"name": "split row", "kind": "success", "feature": "strings", "args": ["-c", "'a,b,c' | split row ',' | length"]},
        {"name": "json compact", "kind": "success", "feature": "json", "args": ["-c", "{name: alice, age: 30} | to json --raw"]},
        {"name": "from json", "kind": "success", "feature": "json", "args": ["-c", "'{\"name\":\"alice\",\"age\":30}' | from json | get name"]},
        {"name": "list length", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3 4] | length"]},
        {"name": "first", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3 4] | first"]},
        {"name": "last", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3 4] | last"]},
        {"name": "skip", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3 4] | skip 2 | first"]},
        {"name": "take", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3 4] | take 2 | length"]},
        {"name": "each", "kind": "success", "feature": "lists", "args": ["-c", "[1 2 3] | each { |x| $x * 2 } | math sum"]},
        {"name": "where filter", "kind": "success", "feature": "tables", "args": ["-c", "[[name age]; [alice 30] [bob 22]] | where age > 25 | get name | first"]},
        {"name": "sort table", "kind": "success", "feature": "tables", "args": ["-c", "[[name age]; [alice 30] [bob 22]] | sort-by age | get name | first"]},
        {"name": "select table", "kind": "success", "feature": "tables", "args": ["-c", "[[name age city]; [alice 30 Paris]] | select name city | to json --raw"]},
        {"name": "insert table", "kind": "success", "feature": "tables", "args": ["-c", "[[name age]; [alice 30]] | insert city Paris | to json --raw"]},
        {"name": "update table", "kind": "success", "feature": "tables", "args": ["-c", "[[name age]; [alice 30]] | update age 31 | get age | first"]},
        {"name": "default value", "kind": "success", "feature": "tables", "args": ["-c", "[[name age]; [alice null]] | default 0 age | get age | first"]},
        {"name": "transpose record", "kind": "success", "feature": "tables", "args": ["-c", "{a: 1, b: 2} | transpose key value | length"]},
        {"name": "csv count", "kind": "success", "feature": "csv", "args": ["-c", f"open {str(people)!r} | length"]},
        {"name": "csv select", "kind": "success", "feature": "csv", "args": ["-c", f"open {str(people)!r} | select name city | to csv --noheaders"]},
        {"name": "csv where", "kind": "success", "feature": "csv", "args": ["-c", f"open {str(people)!r} | where city == Paris | length"]},
        {"name": "open text", "kind": "success", "feature": "filesystem", "args": ["-c", f"open {str(fx / 'notes.txt')!r} | lines | length"]},
        {"name": "open toml", "kind": "success", "feature": "filesystem", "args": ["-c", f"open {str(fx / 'Cargo.toml')!r} | get package.name"]},
        {"name": "path exists", "kind": "success", "feature": "paths", "args": ["-c", f"({str(people)!r} | path exists)"]},
        {"name": "path basename", "kind": "success", "feature": "paths", "args": ["-c", f"{str(people)!r} | path basename"]},
        {"name": "path dirname", "kind": "success", "feature": "paths", "args": ["-c", f"{str(people)!r} | path dirname | path basename"]},
        {"name": "ls fixture", "kind": "success", "feature": "filesystem", "args": ["-c", f"ls {str(fx)!r} | length"]},
        {"name": "glob txt", "kind": "success", "feature": "filesystem", "args": ["-c", f"glob {str(fx / '*.txt')!r} | length"]},
        {"name": "empty input", "kind": "success", "feature": "empty-values", "args": ["-c", "'' | is-empty"]},
        {"name": "invalid json", "kind": "error", "feature": "invalid-json", "args": ["-c", "'not-json' | from json"]},
        {"name": "missing file", "kind": "error", "feature": "missing-file", "args": ["-c", f"open {str(fx / 'missing.txt')!r}"]},
        {"name": "bad expression", "kind": "error", "feature": "bad-expression", "args": ["-c", "definitely-not-a-command"]},
    ]


def cases_for(task, fx):
    if task == "zip-password-finder":
        return zip_cases(fx)
    if task == "xsv":
        return xsv_cases(fx)
    if task == "eza":
        return eza_cases(fx)
    if task == "nushell":
        return nushell_cases(fx)
    return generic_cases(fx)


def command_name_from_case(task, case):
    if task == "xsv" and case.get("args"):
        return case["args"][0]
    if task == "eza":
        return case.get("feature")
    if case.get("feature"):
        return case.get("feature")
    return None


def safe_case_name(name):
    return re.sub(r"[^A-Za-z0-9_.-]+", "-", name).strip("-") or "case"


def read_side_effect(path, mode=None):
    path = Path(path)
    if mode == "exists":
        return {"kind": "exists", "exists": path.exists()}
    if path.is_dir():
        rows = []
        for child in sorted(p for p in path.rglob("*") if p.is_file()):
            rows.append({"path": str(child.relative_to(path)), "content": child.read_bytes().decode("utf-8", "replace")})
        return {"kind": "dir", "entries": rows}
    if path.exists():
        return {"kind": "file", "content": path.read_bytes().decode("utf-8", "replace")}
    return {"kind": "missing"}


def side_effect_outputs(case):
    return [
        {"index": index, "output": read_side_effect(path, case.get("side_effect_mode"))}
        for index, path in enumerate(case.get("side_effects", []))
    ]


def find_actual_executable(workspace):
    candidates = [
        workspace / "executable",
        workspace / "executable.exe",
        workspace / "executable.cmd",
        workspace / "executable.bat",
        workspace / "executable.js",
        workspace / "executable.py",
        workspace / "executable.jar",
    ]
    for candidate in candidates:
        if candidate.exists():
            return candidate
    return workspace / "executable"


def actual_command(executable, args):
    if executable.suffix == ".py":
        return [sys.executable, executable, *args]
    if executable.suffix == ".js":
        return ["node", executable, *args]
    if executable.suffix == ".jar":
        return ["java", "-jar", executable, *args]
    if TARGET_LANGUAGE.lower() == "python" and executable.name == "executable":
        return [sys.executable, executable, *args]
    return [executable, *args]


def eza_required_success_features():
    return {
        "listing", "hidden", "long-view", "time-fields", "tree-recursion",
        "sorting", "display-modes", "classify", "filtering", "size-format",
        "path-display", "stdin",
    }


def eza_required_error_features():
    return {
        "invalid-option-value", "invalid-numeric-value", "missing-required-value",
        "missing-path", "unknown-option",
    }


def zip_required_success_features():
    return {
        "bruteforce-lowercase", "starting-password", "not-found",
        "dictionary", "mask", "custom-charset",
    }


def zip_required_error_features():
    return {
        "missing-input", "invalid-workers", "invalid-length",
        "invalid-range", "missing-file-number",
    }


def nushell_required_success_features():
    return {
        "help", "math", "strings", "json", "lists", "tables",
        "csv", "filesystem", "paths", "empty-values",
    }


def nushell_required_error_features():
    return {"invalid-json", "missing-file", "bad-expression"}


def builtin_required_coverage(task):
    if task == "zip-password-finder":
        return {
            "success": sorted(zip_required_success_features()),
            "error": sorted(zip_required_error_features()),
            "minimumSuccessCasesPerFeature": 1,
            "minimumErrorCasesPerFeature": 1,
        }
    if task == "nushell":
        return {
            "success": sorted(nushell_required_success_features()),
            "error": sorted(nushell_required_error_features()),
            "minimumSuccessCasesPerFeature": 1,
            "minimumErrorCasesPerFeature": 1,
        }
    return {}


def discover_cli_help(task, workspace):
    root = run_cmd([REFERENCE_BINARY, "--help"], workspace, timeout=15)
    help_data = {
        "root_status": root["status"],
        "root_stdout": normalize(root["stdout"])[:120000],
        "root_stderr": normalize(root["stderr"])[:120000],
        "help_commands": [],
        "source_commands": [],
        "commands": [],
        "command_help": {},
    }
    if task == "eza":
        text = normalize(root["stdout"] + "\n" + root["stderr"])
        help_data["help_options"] = sorted(set(re.findall(r"(?<![\\w-])--[A-Za-z][A-Za-z0-9-]*(?:=\\w+)?", text)))
        help_data["commands"] = sorted(eza_required_success_features() | eza_required_error_features())
        return help_data
    builtin_coverage = builtin_required_coverage(task)
    if builtin_coverage:
        text = normalize(root["stdout"] + "\n" + root["stderr"])
        help_data["help_options"] = sorted(set(re.findall(r"(?<![\\w-])--[A-Za-z][A-Za-z0-9-]*(?:=\\w+)?", text)))
        help_data["commands"] = sorted(set(builtin_coverage.get("success", [])) | set(builtin_coverage.get("error", [])))
        return help_data
    if task != "xsv":
        return help_data
    text = normalize(root["stdout"] + "\n" + root["stderr"])
    commands = set()
    known = {
        "cat", "count", "fixlengths", "flatten", "fmt", "frequency", "headers",
        "index", "input", "join", "partition", "sample", "search", "select",
        "slice", "sort", "split", "stats", "table",
    }
    for line in text.splitlines():
        match = re.match(r"^\s{2,}([a-z][a-z0-9_-]+)\b", line)
        if match and match.group(1) in known:
            commands.add(match.group(1))
    if not commands:
        commands = known
    help_commands = set(commands)
    source_commands = set()
    source_path = workspace / "rust-reference" / "src" / "main.rs"
    if source_path.exists():
        source_text = source_path.read_text(encoding="utf-8", errors="replace")
        for command in known:
            quoted_command = "[\"']" + re.escape(command) + "[\"']"
            if re.search(quoted_command, source_text) or re.search(rf"\b{re.escape(command)}\b", source_text):
                source_commands.add(command)
    commands = help_commands | source_commands
    for command in sorted(commands):
        sub = run_cmd([REFERENCE_BINARY, command, "--help"], workspace, timeout=15)
        help_data["command_help"][command] = {
            "status": sub["status"],
            "stdout": normalize(sub["stdout"])[:4000],
            "stderr": normalize(sub["stderr"])[:4000],
        }
    help_data["help_commands"] = sorted(help_commands)
    help_data["source_commands"] = sorted(source_commands)
    help_data["commands"] = sorted(commands)
    return help_data


class Check:
    def __init__(self, workspace):
        self.workspace = Path(workspace)
        self.exe = find_actual_executable(self.workspace)
        self.failures = []
        self.passes = 0
        self.cli_help = None
        self.discovered_commands = []
        self.covered_commands = []
        self.covered_success_commands = []
        self.covered_error_commands = []

    def fail(self, name, detail):
        self.failures.append({"name": name, "detail": detail})

    def ok(self, name):
        self.passes += 1

    def build(self):
        compile_script = self.workspace / "compile.sh"
        if not compile_script.exists():
            self.fail("compile.sh exists", "missing")
            return
        shell = find_shell()
        if shell:
            result = run_cmd([shell, compile_script], self.workspace, timeout=180)
        else:
            result = run_cmd([compile_script], self.workspace, timeout=180)
        if result["status"] == 0:
            self.ok("compile.sh succeeds")
        else:
            self.fail("compile.sh succeeds", result)
        self.exe = find_actual_executable(self.workspace)

    def check_files(self):
        if not (self.workspace / "compile.sh").exists():
            self.fail("compile.sh exists", "missing")
        else:
            self.ok("compile.sh exists")
        if not self.exe.exists():
            self.fail("executable exists", "missing")
        else:
            self.ok("executable exists")
        if (self.workspace / "REFERENCE_BINARY.txt").exists() or REFERENCE_BINARY.exists():
            self.ok("reference binary available")
        else:
            self.fail("reference binary available", "missing REFERENCE_BINARY.txt and SOURCE_PORT_REFERENCE_BINARY")
        if self.exe.exists():
            self.ok("executable target language")

    def check_cli_help_coverage(self, cases):
        self.cli_help = discover_cli_help(TASK, self.workspace)
        self.discovered_commands = list(self.cli_help.get("commands") or [])
        if self.cli_help.get("root_status") != 0:
            self.fail("reference root help", {"status": self.cli_help.get("root_status"), "stderr": self.cli_help.get("root_stderr")})
            return
        coverage = builtin_required_coverage(TASK) if TASK not in {"xsv", "eza"} else {}
        if TASK not in {"xsv", "eza"} and not coverage:
            coverage = generic_coverage()
        if TASK not in {"xsv", "eza"} and not coverage:
            return
        covered = {
            command_name_from_case(TASK, case)
            for case in cases
            if command_name_from_case(TASK, case)
        }
        success_covered = {
            command_name_from_case(TASK, case)
            for case in cases
            if command_name_from_case(TASK, case) and case.get("kind", "success") == "success"
        }
        error_covered = {
            command_name_from_case(TASK, case)
            for case in cases
            if command_name_from_case(TASK, case) and case.get("kind") == "error"
        }
        self.covered_commands = sorted(covered)
        self.covered_success_commands = sorted(success_covered)
        self.covered_error_commands = sorted(error_covered)
        if TASK == "xsv":
            required_success = set(self.discovered_commands)
            required_error = set(self.discovered_commands)
            check_name = "success and error coverage for discovered xsv commands"
        elif TASK == "eza":
            required_success = eza_required_success_features()
            required_error = eza_required_error_features()
            check_name = "success and error coverage for discovered eza option groups"
        else:
            required_success = set(coverage.get("success", []))
            required_error = set(coverage.get("error", []))
            check_name = f"success and error coverage for {TASK} help-derived option groups"
            help_text = normalize((self.cli_help.get("root_stdout") or "") + "\n" + (self.cli_help.get("root_stderr") or ""))
            missing_help_options = [option for option in coverage.get("helpOptions", []) if option not in help_text]
            if missing_help_options:
                self.fail("reference help includes covered options", {"missing_help_options": missing_help_options})
        missing_success = sorted(required_success - success_covered)
        missing_error = sorted(required_error - error_covered)
        if missing_success or missing_error:
            self.fail(check_name, {
                "missing_success": missing_success,
                "missing_error": missing_error,
                "covered_success": self.covered_success_commands,
                "covered_error": self.covered_error_commands,
                "discovered": self.discovered_commands,
            })
        else:
            self.ok(check_name)
        minimum_success = int(coverage.get("minimumSuccessCasesPerFeature", 0) or 0)
        minimum_error = int(coverage.get("minimumErrorCasesPerFeature", 0) or 0)
        if minimum_success or minimum_error:
            success_counts = {
                feature: sum(
                    1 for case in cases
                    if command_name_from_case(TASK, case) == feature and case.get("kind", "success") == "success"
                )
                for feature in required_success
            }
            error_counts = {
                feature: sum(
                    1 for case in cases
                    if command_name_from_case(TASK, case) == feature and case.get("kind") == "error"
                )
                for feature in required_error
            }
            sparse_success = {feature: count for feature, count in success_counts.items() if count < minimum_success}
            sparse_error = {feature: count for feature, count in error_counts.items() if count < minimum_error}
            if sparse_success or sparse_error:
                self.fail("minimum feature case counts", {
                    "minimum_success": minimum_success,
                    "minimum_error": minimum_error,
                    "sparse_success": sparse_success,
                    "sparse_error": sparse_error,
                })
            else:
                self.ok("minimum feature case counts")

    def run(self):
        self.build()
        self.check_files()
        if not self.exe.exists():
            return
        fx = make_fixtures(self.workspace / "harness")
        cases = cases_for(TASK, fx)
        self.check_cli_help_coverage(cases)
        for case in cases:
            stdin = None
            if "stdin_file" in case:
                stdin = Path(case["stdin_file"]).read_text(encoding="utf-8")
            elif "stdin" in case:
                stdin = case["stdin"]
            expected_case = case
            actual_case = case
            expected_fx = fx
            actual_fx = fx
            if case.get("side_effects"):
                case_root = self.workspace / "harness" / "side-effects" / safe_case_name(case["name"])
                expected_fx = make_fixtures(case_root / "reference")
                actual_fx = make_fixtures(case_root / "actual")
                expected_case = next(item for item in cases_for(TASK, expected_fx) if item["name"] == case["name"])
                actual_case = next(item for item in cases_for(TASK, actual_fx) if item["name"] == case["name"])
            expected = run_cmd([REFERENCE_BINARY, *expected_case["args"]], self.workspace, stdin=stdin, timeout=case.get("timeout", 30))
            actual = run_cmd(actual_command(self.exe, actual_case["args"]), self.workspace, stdin=stdin, timeout=case.get("timeout", 30))
            ok = same_business(TASK, actual_case, actual, expected, actual_fx)
            expected_side_effects = side_effect_outputs(expected_case)
            actual_side_effects = side_effect_outputs(actual_case)
            side_effect_failures = expected_side_effects != actual_side_effects
            if ok and not side_effect_failures:
                self.ok(case["name"])
            else:
                self.fail(case["name"], {
                    "args": actual_case["args"],
                    "expected": expected,
                    "actual": actual,
                    "comparison": "business_semantics",
                    "expected_side_effects": expected_side_effects,
                    "actual_side_effects": actual_side_effects,
                })


def main():
    if len(sys.argv) < 2:
        print("usage: evaluate_source_port.py WORKSPACE [WORKSPACE...]", file=sys.stderr)
        return 2
    reports = []
    for workspace in sys.argv[1:]:
        check = Check(workspace)
        check.run()
        reports.append({
            "workspace": str(Path(workspace).resolve()),
            "passed": check.passes,
            "failed": len(check.failures),
            "discovered_commands": check.discovered_commands,
            "covered_commands": check.covered_commands,
            "covered_success_commands": check.covered_success_commands,
            "covered_error_commands": check.covered_error_commands,
            "cli_help": check.cli_help,
            "failures": check.failures,
        })
    print(json.dumps({"task": TASK, "reference_binary": str(REFERENCE_BINARY), "reports": reports}, indent=2))
    return 0 if all(report["failed"] == 0 for report in reports) else 1


if __name__ == "__main__":
    raise SystemExit(main())
