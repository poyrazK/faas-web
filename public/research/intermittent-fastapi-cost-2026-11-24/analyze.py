"""Reproduce the FastAPI compute comparison and 30-day pricing estimates."""

import argparse
import csv
from datetime import datetime, timedelta
from decimal import Decimal
import json
from pathlib import Path
from statistics import mean


MB_SECONDS_PER_GB_HOUR = 1024 * 3600
DAYS = 30
WINDOWS_PER_DAY = (10, 90)
REQUESTS_PER_WINDOW = 4
STATE_OFFSETS = tuple(range(0, 120, 10))


def date(value):
    return datetime.fromisoformat(value)


def get_windows(directory):
    captures = json.loads((directory / "ledger.json").read_text())
    first, last = (capture["windows"] for capture in captures)
    if first != last:
        raise ValueError("The two ledger captures did not settle to the same values")
    control, *windows = last
    if control["mb_seconds"] or control["sample_requests"]:
        raise ValueError("Unexpected compute or requests in the zero-traffic control")
    return windows


def analyze(directory):
    windows = get_windows(directory)
    with (directory / "traffic.csv").open(newline="") as file:
        traffic = list(csv.DictReader(file))
    with (directory / "states.csv").open(newline="") as file:
        states = list(csv.DictReader(file))
    results = {"spread": [], "burst": []}
    for index, window in enumerate(windows, 1):
        requests = [row for row in traffic if int(row["window"]) == index]
        pattern, = {row["pattern"] for row in requests}
        start, end = date(window["from"]), date(window["until"])
        valid_requests = all(
            row["status"] == "200" and start <= date(row["sent_at"]) < end
            for row in requests
        )
        if (
            len(requests) != REQUESTS_PER_WINDOW
            or window["sample_requests"] != len(requests)
            or window["mb_seconds"] <= 0
            or not valid_requests
        ):
            raise ValueError(f"Unexpected request or billing evidence in window {index}")
        samples = [row for row in states if int(row["window"]) == index]
        if (
            tuple(int(row["offset_seconds"]) for row in samples) != STATE_OFFSETS
            or samples[0]["state"] != "no_resident"
            or date(samples[0]["read_completed_at"]) >= date(requests[0]["sent_at"])
            or any(
                not start - timedelta(milliseconds=10)
                <= date(row["read_started_at"]) <= date(row["read_completed_at"]) < end
                for row in samples
            )
        ):
            raise ValueError(f"Unexpected instance state evidence in window {index}")
        results[pattern].append(
            {
                "window": index,
                "requests": len(requests),
                "mb_seconds": window["mb_seconds"],
                "gb_ram_hours": window["mb_seconds"] / MB_SECONDS_PER_GB_HOUR,
                "ledger_awake_seconds": window["awake_seconds"],
                "state_samples": len(samples),
                "no_resident_samples": sum(row["state"] == "no_resident" for row in samples),
                "frozen_samples": sum(row["state"] == "frozen" for row in samples),
            }
        )
    if sum(result["requests"] for rows in results.values() for result in rows) != len(traffic):
        raise ValueError("Traffic contains rows outside the declared windows")
    return results


def monthly_estimates(patterns, plans):
    estimates = []
    for pattern, windows in patterns.items():
        per_window = mean(Decimal(window["mb_seconds"]) for window in windows)
        for daily_windows in WINDOWS_PER_DAY:
            gb_hours = per_window * daily_windows * DAYS / MB_SECONDS_PER_GB_HOUR
            costs = {}
            for plan in plans:
                overage = max(Decimal(0), gb_hours - plan["includedGbHours"])
                policy = plan["computeOverage"]
                if overage and policy["policy"] == "hard-cap":
                    costs[plan["name"]] = {"status": "compute_cap_reached"}
                    continue
                rate = Decimal(str(policy.get("pricePerGbRamHour", 0)))
                costs[plan["name"]] = {
                    "monthly_usd_before_caps_and_tax": float(plan["monthly"] + overage * rate),
                    "compute_overage_gb_ram_hours": float(overage),
                }
            estimates.append(
                {
                    "pattern": pattern,
                    "windows_per_day": daily_windows,
                    "requests_per_day": daily_windows * REQUESTS_PER_WINDOW,
                    "gb_ram_hours": float(gb_hours),
                    "plans": costs,
                }
            )
    return estimates


def summarize(windows):
    totals = {}
    for pattern, rows in windows.items():
        totals[pattern] = {
            key: sum(row[key] for row in rows)
            for key in (
                "requests", "mb_seconds", "ledger_awake_seconds",
                "state_samples", "no_resident_samples", "frozen_samples",
            )
        }
        totals[pattern]["gb_ram_hours"] = totals[pattern]["mb_seconds"] / MB_SECONDS_PER_GB_HOUR
    return totals


def main():
    archive_directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "evidence", type=Path, nargs="?", default=archive_directory,
        help="Directory with the ledger, traffic and state evidence",
    )
    parser.add_argument(
        "pricing", type=Path, nargs="?", default=archive_directory / "pricing.json",
        help="Published pricing feed snapshot used by the study",
    )
    parser.add_argument(
        "--verify", action="store_true",
        help="Compare the recomputed results with summary.json in the evidence directory",
    )
    args = parser.parse_args()
    plans = json.loads(args.pricing.read_text(encoding="utf-8"))["plans"]
    patterns = analyze(args.evidence)
    totals = summarize(patterns)
    data = {
        "windows": patterns,
        "totals": totals,
        "burst_compute_reduction_percent": 100 * (
            1 - totals["burst"]["mb_seconds"] / totals["spread"]["mb_seconds"]
        ),
        "monthly_estimates": monthly_estimates(patterns, plans),
    }
    if args.verify:
        expected = json.loads((args.evidence / "summary.json").read_text(encoding="utf-8"))
        if data != expected:
            parser.exit(1, "Recomputed results differ from the published summary.\n")
        print(
            "Verified published summary. "
            f"Spread used {totals['spread']['mb_seconds']:,} MB-seconds. "
            f"Bursts used {totals['burst']['mb_seconds']:,} MB-seconds. "
            f"Bursts used {data['burst_compute_reduction_percent']:.1f}% less billable compute."
        )
    else:
        print(json.dumps(data, indent=2))


if __name__ == "__main__":
    main()
