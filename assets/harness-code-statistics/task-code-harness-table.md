# Production-code additions and harness outcomes

Each run is weighted equally. Code additions are compared only after within-task transformation; raw line counts are not a cross-task complexity scale.

| Category | Task | Runs | Runs with code | Median additions | Mean harness ratio | Outcome variation |
|---|---|---:|---:|---:|---:|---|
| debug | `abs-stepped-slices` | 12 | 12 | 249.5 | 100.0% | no |
| debug | `actionlint-action-pinning-lint` | 12 | 12 | 362.0 | 83.3% | yes |
| debug | `awilix-async-container-initialization` | 12 | 12 | 406.0 | 50.0% | yes |
| debug | `bandit-incremental-cache-control` | 12 | 12 | 527.5 | 41.7% | yes |
| debug | `boa-hierarchical-evaluation-cancellation` | 12 | 12 | 404.0 | 58.3% | yes |
| debug | `csstree-shorthand-expansion-compression` | 12 | 12 | 814.0 | 91.7% | yes |
| debug | `dasel-html-document-format` | 12 | 12 | 750.0 | 25.0% | yes |
| debug | `dynamodb-toolbox-conditional-attribute-requirements` | 11 | 11 | 600.0 | 81.8% | yes |
| debug | `fd-deterministic-multi-key-sorting` | 12 | 12 | 409.0 | 91.7% | yes |
| debug | `happy-dom-abort-pending-body-reads` | 12 | 12 | 143.0 | 91.7% | yes |
| debug | `katex-multicolumn-array-spans` | 12 | 12 | 242.0 | 33.3% | yes |
| debug | `langchain-request-coalescing` | 12 | 12 | 796.0 | 41.7% | yes |
| debug | `narwhals-rolling-window-suite` | 12 | 12 | 578.0 | 75.0% | yes |
| debug | `numba-stencil-boundary-modes` | 12 | 12 | 190.5 | 100.0% | no |
| debug | `pest-character-class-coalescing` | 12 | 12 | 483.0 | 0.0% | no |
| debug | `quill-shared-toolbar-focus` | 11 | 11 | 341.0 | 18.2% | yes |
| debug | `testem-per-launcher-reports` | 12 | 12 | 295.5 | 83.3% | yes |
| debug | `wasmi-trap-coredumps` | 12 | 12 | 671.5 | 66.7% | yes |
| debug | `yaegi-go-embed-directives` | 12 | 12 | 365.0 | 100.0% | no |
| debug | `yjs-map-conflict-detection` | 12 | 12 | 319.5 | 100.0% | no |
| rewrite | `eza` | 8 | 8 | 965.0 | 79.8% | yes |
| rewrite | `nushell` | 8 | 6 | 908.0 | 68.2% | yes |
| rewrite | `prompt-gallery-tanstack-fullstack-rebuild` | 8 | 8 | 788.5 | 93.1% | yes |
| rewrite | `xsv` | 8 | 6 | 878.0 | 54.3% | yes |
| rewrite | `zip-password-finder` | 8 | 6 | 567.5 | 99.3% | no |
