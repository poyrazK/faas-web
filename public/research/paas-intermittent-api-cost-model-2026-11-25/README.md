# Cross-platform intermittent and evenly distributed API cost model

This archive contains the published vendor pricing inputs (`vendors.json`), workload definitions (`scenarios.json`), deterministic Python calculator (`analyze.py`), and expected output (`summary.json`) for the November 25, 2026 cross-platform PaaS cost model. [Read the published report](https://gregale.dev/research/paas-intermittent-api-cost-model-2026-11-25).

It models how Gregale's three-state idle ladder (`Paused` in RAM ~1–2 s after each request with ~1 ms resume and zero billing → `Frozen` → `Parked` snapshot on disk after 10 minutes) compares against 5–30 minute sleep timers on evenly distributed traffic and continuously busy traffic.

## Verify the published results

Use Python 3.11 or later and run this command from the extracted directory.

```sh
python3 analyze.py --verify
```

The script uses only Python's standard library (`decimal.Decimal`, `json`, `pathlib`) to recompute all four 30-day scenarios across Gregale, Render, Railway, Fly.io, Google Cloud Run, and Heroku and compare them against `summary.json`. Run `python3 analyze.py --markdown` to print the Markdown comparison table.

## Scope and boundary

This is a **deterministic published-pricing model** checked on **November 25, 2026**, not live competitor billing invoices. Gregale's `1.75 s` billed awake duration per isolated request comes from [the intermittent FastAPI study](https://gregale.dev/research/intermittent-fastapi-cost-2026-11-24). All prices are USD/month before tax and exclude egress, builds, extra storage, and paid team seats.
