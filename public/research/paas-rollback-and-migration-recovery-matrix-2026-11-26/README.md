# PaaS Rollback and Migration Recovery Matrix (2026-11-26)

Reproducible dataset and verification script scoring 8 PaaS and serverless container platforms across 8 code-rollback, progressive-canary, and PostgreSQL point-in-time recovery criteria (`immutable_release_rollback`, `pre_traffic_migration_command`, `default_canary_auto_rollback`, `managed_postgres_pitr`, `coordinated_code_and_db_rollback`, `config_and_env_revision_rollback`, `release_freezes_and_approvals`, `immutable_staging_to_prod_promotion`).

## Files

- `criteria.json`: Scoring weights (`full = 2`, `partial = 1`, `none = 0`) and criterion definitions.
- `vendors.json`: Platform evaluations with verbatim evidence notes and primary `https://` vendor source URLs checked on `2026-11-26`.
- `summary.json`: Deterministic leaderboard and per-criterion breakdown.
- `analyze.py`: Python 3.11+ standard-library-only validator and scorer.

## Reproduce

```sh
python3 analyze.py --verify
```
