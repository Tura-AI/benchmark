# Turn `local-agent-benchmarks` into a Consistent Benchmark Project

## Task Description

Refactor the repository’s three benchmark modes—standard MCP, code-mode MCP, and hierarchical orchestration—into one coherent Python project. The current implementation has inconsistent model identifiers and entry points, uses pytest as the runner for only one mode, performs mode-specific token accounting, depends on execution from `src/`, overwrites existing results, and provides inconsistent restart and resume behavior, among other issues.

Provide a predictable root-level workflow with shared configuration, execution, validation, logging, safe result persistence, and resume behavior. Timeout policy should be configurable per model+mode combination. Preserve the existing benchmark cases, deterministic tools, three benchmark approaches, and archived results. The goal is not to improve benchmark scores, but to make the project consistent, safe, reproducible, maintainable, and straightforward to extend.

## Acceptance Criteria

### 1. Coherent project structure

- The repository has a clear separation between production code, automated tests, benchmark data, configuration, generated results, and archived results.
- Internal imports do not depend on modifying `sys.path`.
- File access does not depend on the caller's current working directory.
- All documented commands work from the repository root.
- Repeated or obsolete implementations are removed or consolidated where appropriate.
- Naming and terminology are consistent across modules, commands, logs, documentation, and result files.

### 2. Unified benchmark interface

- Standard MCP, code-mode MCP, and hierarchical orchestration are all executed through one documented entry point.
- The interface consistently supports:
  - benchmark mode selection;
  - model selection;
  - test-set selection;
  - output-directory or output-file selection;
  - individual-case or case-range selection;
  - starting a new run;
  - resuming an incomplete run;
  - retrying failed or timed-out cases;
  - explicit overwrite behavior.
- Pytest is used only for automated project tests and is not a user-facing benchmark runner.
- All modes follow the same command-line conventions and error conventions.
- Help output accurately documents the available modes, configuration, and run-lifecycle options.

### 3. Centralized configuration

- Model names and shared runtime settings are not hardcoded independently inside benchmark modes.
- The project defines one canonical representation for model identifiers.
- Inconsistent values such as capitalization variants of `qwen2.5:14b` are eliminated.
- The exact effective model identifier is preserved in result metadata.
- Shared settings such as provider, Ollama host, context size, temperature, timeout, test-set location, and output location are configured centrally.
- Configuration precedence is deterministic and documented.
- The effective configuration is displayed before execution and recorded in the run artifact.

### 4. Consistent timeout policy

- Timeout policy is configured centrally for each model and benchmark-mode combination.
- The effective timeout is visible before execution and recorded in run metadata.
- A timeout produces the same normalized status and result fields in every mode.
- Timeout handling preserves the partial run artifact and does not prevent later selected cases from executing.

### 5. Safe new-run, resume, retry, and overwrite behavior

- Existing output files are never silently deleted or overwritten.
- Starting a new run creates a unique run identifier and result path by default.
- When a compatible incomplete run exists, the user can choose whether to resume it or start a new run.
- Interactive prompting is optional, but equivalent decisions must be available through non-interactive options.
- Overwriting an existing artifact requires an explicit option.
- A run is resumable only when its configuration is compatible with the requested execution, including at least:
  - benchmark mode;
  - model identifier;
  - test-set identity;
  - runtime settings that affect execution;
  - result-schema version.
- When resuming:
  - completed cases are not executed again by default;
  - execution continues with the first incomplete selected case;
  - failed or timed-out cases are rerun only when explicitly requested;
  - duplicate case records are not created;
  - run-level counts and cumulative metrics remain correct.
- A malformed or incompatible result artifact produces a clear error instead of being partially reused.
- Resume behavior is available consistently for all three benchmark modes.

### 6. Safe and standardized result artifacts

- Generated results are written to a dedicated results location rather than alongside test data or production modules.
- Archived results included in the repository are not treated as default writable outputs.
- Progress is persisted after each completed case.
- Writes are atomic or otherwise protected against leaving invalid JSON after interruption.
- A partially completed run remains valid, readable, and resumable.
- Every mode produces the same documented and versioned result structure.

Run-level metadata includes at least:

- schema version;
- run ID;
- benchmark mode;
- provider and model identifier;
- test-set identity;
- effective runtime configuration;
- start and last-updated timestamps;
- completion state;
- total selected and completed case counts;
- passed, failed, timed-out, and errored counts;
- duration totals;
- token totals where available.

Each case result includes at least:

- case ID;
- question;
- expected answer;
- actual answer;
- normalized status;
- validation details;
- duration;
- input, output, and total token values;
- token source or method;
- error information where applicable;
- attempt count where reruns are supported.

Allowed statuses are defined centrally and used consistently. They must distinguish at least pending, pass, fail, timeout, and execution error. Unavailable measurements are represented as unavailable values such as `null`.

### 7. Consistent token accounting

- Token accounting is implemented behind one shared interface.
- Native model or provider usage metadata is used where available.
- Estimated token counts are explicitly identified as estimates.
- Missing token data is represented consistently as unavailable.
- Token field names and numeric types are identical across modes.
- Results record whether token counts are native, estimated, or unavailable.
- The direct mode-specific request to Ollama's tokenize endpoint is removed.

### 8. Shared execution, validation, and error behavior

- All modes use a common case-execution and result-recording lifecycle where their behavior should be identical.
- Mode-specific agent behavior remains isolated behind clear interfaces.
- Answer validation exists in one shared implementation rather than being duplicated between evaluators.
- Validation rejects empty answers and avoids arbitrary substring matching.
- Validation handles case, whitespace, complete identifiers, numeric values, currencies, and city names predictably.
- At minimum, validation must:
  - reject `54` when the expected answer is `4`;
  - distinguish `ID-100` from partial identifiers;
  - accept harmless differences such as `60 EUR`, `60 eur`, and additional whitespace;
  - provide a machine-readable reason when validation fails.
- The test-set format may be extended with explicit answer types or validation rules where necessary.
- Exceptions are recorded without corrupting the run artifact.
- One failed case does not terminate the remaining run unless the benchmark environment itself is unusable.
- Normal output avoids unnecessary stack traces, while verbose or debug output can expose diagnostic details.
- Process exit behavior is consistent and documented.

### 9. Consistent logging and terminal experience

- All modes use one logging approach.
- Normal terminal output clearly shows:
  - the effective configuration;
  - run ID;
  - current case;
  - case status;
  - overall progress;
  - result location;
  - final summary.
- Logging verbosity can be controlled.
- Debug output, MCP server output, and benchmark progress do not corrupt structured output.
- Invalid options and incompatible resume attempts produce actionable messages.

### 10. Extensible internal design

- Benchmark modes implement a shared runner or adapter contract rather than separate end-to-end evaluators with incompatible behavior.
- Model-provider integration is separated from benchmark orchestration.
- Result persistence is separated from agent execution.
- Validation is separated from persistence.
- Adding a benchmark mode does not require creating another standalone CLI, result format, or lifecycle implementation.
- Adding a model provider does not require modifying every benchmark mode.

### 11. Automated tests

- Automated tests run from the repository root.
- Tests do not require Ollama to be installed or running.
- Model and MCP interactions can be replaced with test doubles through defined interfaces.
- Tests cover at least:
  - command-line parsing for all three modes;
  - configuration precedence and canonical model identifiers;
  - root-relative path handling;
  - new-run behavior and unique output creation;
  - resume behavior and duplicate prevention;
  - retry and overwrite protection;
  - incompatible and malformed resume attempts;
  - result-schema validation;
  - interruption-safe persistence;
  - answer-validation edge cases;
  - timeout and exception serialization;
  - missing token metadata;
  - mocked execution of every benchmark mode.

### 12. Documentation

The project documentation explains:

- the project's purpose and limitations;
- supported Python version and environment setup;
- Ollama setup and supported model identifiers;
- commands for all benchmark modes;
- configuration sources and precedence;
- timeout configuration by model+mode combination;
- result locations and result schema;
- new-run, resume, retry, and overwrite behavior;
- token-counting methodology;
- automated test execution;
- expected model nondeterminism;
- migration from the previous standalone scripts.

All documented project commands work from the repository root. Reproduction instructions for the current pre-refactor baseline are provided separately and do not need to be duplicated in this document.

## Preservation Requirements

- Preserve the existing 22 benchmark cases.
- Preserve the deterministic supply-chain tools.
- Keep standard MCP, code-mode MCP, and hierarchical orchestration runnable.
- Do not silently modify or replace archived benchmark results.
- Historical result files do not need to be converted automatically, but incompatibility with the new schema must be documented.

## Out of Scope

- Improving model accuracy or benchmark scores.
- Changing the intended questions or expected answers of the existing benchmark cases.
- Automatically migrating historical result artifacts.

## Expected Outcome

A new user should be able to:

1. clone the repository;
2. install its dependencies and required/desired Ollama models;
3. run any benchmark mode through the same interface;
4. interrupt a run and resume it safely;
5. run another model or mode without overwriting previous results;
6. compare consistently structured artifacts;
7. run the automated tests without Ollama.

A developer should be able to add a benchmark mode, validation rule, or model provider without copying an existing evaluator and creating another incompatible execution path.
