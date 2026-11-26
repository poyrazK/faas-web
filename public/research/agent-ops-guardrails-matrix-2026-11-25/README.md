# Cloud Agent-Ops Guardrails Matrix (2026-11-25)

Reproducible dataset and verification script scoring 8 PaaS and serverless container platforms across 8 operational safety criteria for AI coding agents (`non_interactive_json_cli`, `official_mcp_server`, `scoped_agent_identity`, `pre_mutation_cost_preview`, `human_approval_gate_on_mutations`, `non_code_mutation_undo`, `default_canary_auto_rollback`, `code_plus_postgres_rollback`).

## Files

- `criteria.json`: Scoring weights (`full = 2`, `partial = 1`, `none = 0`) and criterion definitions.
- `vendors.json`: Platform evaluations with verbatim evidence notes and primary `https://` vendor source URLs checked on `2026-11-25`.
- `summary.json`: Deterministic leaderboard and per-criterion breakdown.
- `analyze.py`: Python 3.11+ standard-library-only validator and scorer.

## Reproduce

```sh
python3 analyze.py --verify
```
