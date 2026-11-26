"""Recompute the scheduler wake distribution from the de-identified sample CSV."""

import argparse
import csv
import json
from pathlib import Path
from statistics import fmean


def distribution(values_us):
    ordered = sorted(values_us)

    def percentile(percent):
        rank = (len(ordered) * percent + 99) // 100
        return ordered[rank - 1] / 1000

    return {
        "min": ordered[0] / 1000,
        "mean": round(fmean(ordered) / 1000, 3),
        "p50": percentile(50),
        "p90": percentile(90),
        "p95": percentile(95),
        "p99": percentile(99),
        "max": ordered[-1] / 1000,
    }


def summarize(path):
    with path.open(newline="", encoding="utf-8") as source:
        rows = list(csv.DictReader(source))

    if not rows or len({int(row["sample"]) for row in rows}) != len(rows):
        raise ValueError("expected nonempty rows with unique sample numbers")
    platform_us = [
        int(row["platform_end_us"]) - int(row["platform_start_us"]) for row in rows
    ]
    if min(platform_us) < 0:
        raise ValueError("expected nonnegative durations")

    return {
        "samples": len(rows),
        "snapshot_restores": sum(row["method"] == "restore" for row in rows),
        "all_artifacts_cached": sum(row["all_artifacts_cached"] == "true" for row in rows),
        "max_concurrency_at_admission": max(int(row["concurrency_at_admission"]) for row in rows),
        "max_queue_depth_at_admission": max(int(row["queue_depth_at_admission"]) for row in rows),
        "platform_ms": distribution(platform_us),
        "platform_samples_at_or_above_350_ms": sum(value >= 350_000 for value in platform_us),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "samples",
        nargs="?",
        type=Path,
        default=Path(__file__).with_name("samples.csv"),
    )
    parser.add_argument(
        "--verify",
        action="store_true",
        help="Compare the recomputed results with summary.json next to the sample CSV",
    )
    args = parser.parse_args()
    summary = summarize(args.samples)
    if args.verify:
        expected = json.loads(
            args.samples.with_name("summary.json").read_text(encoding="utf-8")
        )
        if summary != expected:
            parser.exit(1, "Recomputed results differ from the published summary.\n")
        ms = summary["platform_ms"]
        print(
            "Verified published summary. "
            f"{summary['snapshot_restores']} snapshot restores; "
            f"platform wake p50 {ms['p50']:.3f} ms, p95 {ms['p95']:.3f} ms, "
            f"max {ms['max']:.3f} ms "
            f"({summary['platform_samples_at_or_above_350_ms']} >= 350 ms)."
        )
    else:
        print(json.dumps(summary, indent=2))
