# Intermittent FastAPI compute benchmark

This archive contains the fixture, traffic and instance observations, billing ledger captures, pricing snapshot, and expected summary for the November 24, 2026 study. [Read the published study](https://gregale.dev/research/intermittent-fastapi-cost-2026-11-24).

## Verify the published results

Use Python 3.11 or later and run this command from the extracted directory.

```sh
python3 analyze.py --verify
```

The check uses only the bundled files and Python's standard library. It recomputes the billable compute and 30-day estimates and compares the results with `summary.json`. The expected result is **3,696 MB-seconds for spread traffic** and **2,112 MB-seconds for bursts**, a reduction of **42.9%**.

## Collect a fresh sample

The bundle includes the deployable FastAPI fixture and the traffic and ledger collector. Use a disposable app in a Gregale account with access to the route activity report. The published study gives the resource settings, commands, and measurement boundaries. [Fresh run instructions](https://gregale.dev/research/intermittent-fastapi-cost-2026-11-24#data-and-reproduction).
