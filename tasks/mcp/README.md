# MCP benchmark tasks

This directory contains 20 independent DeepSWE-inspired repository tasks. Every task owns its prompt, starting fixture, stdio MCP server with explicit JSON input schemas, behavioral verifier, executable runner, task contract, and harness contract.

The agent discovers tool schemas through the real MCP `tools/list` request. Runs record `initialize`, `tools/list`, and `tools/call` evidence before producing schema-valid benchmark reports.
