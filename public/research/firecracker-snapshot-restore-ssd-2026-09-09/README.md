# Firecracker snapshot restore on SSD

This archive contains the de-identified sample CSV, analysis script, and expected summary for the September 9, 2026 Firecracker snapshot restore acceptance run (`v0.1.18-rc.94`). [Read the published report](https://gregale.dev/research/firecracker-snapshot-restore-ssd-2026-09-09).

## Verify the published results

Use Python 3.11 or later and run this command from the extracted directory.

```sh
python3 analyze.py --verify
```

The check uses only the bundled files and Python's standard library. It recomputes the nearest-rank percentile distribution from `samples.csv` and compares the result with `summary.json`. The expected result is **100 snapshot restores** with a **94.795 ms p50**, **137.756 ms p95**, **149.067 ms max**, and **0 samples at or above 350 ms**.

## Measurement boundary

`platform_start_us` and `platform_end_us` record the scheduler interval from `wake.boot_started` to `wake.boot_completed` on one SSD-backed compute node with warm artifact caches and sequential wakes (concurrency 0, queue depth 0 at admission). It excludes public network distance, edge routing, and application execution.
