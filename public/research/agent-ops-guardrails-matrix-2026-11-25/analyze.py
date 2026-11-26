#!/usr/bin/env python3
"""Deterministic scorer and verifier for the Cloud Agent-Ops Guardrails Matrix kit."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

KIT_DIR = Path(__file__).resolve().parent


def compute_summary(criteria_data: dict, vendors_data: dict) -> dict:
    scoring = criteria_data["scoring"]
    criteria = criteria_data["criteria"]
    criteria_ids = [c["id"] for c in criteria]
    max_score = len(criteria_ids) * scoring["full"]

    leaderboard = []
    for platform in vendors_data["platforms"]:
        checks = platform["checks"]
        missing = [cid for cid in criteria_ids if cid not in checks]
        if missing:
            raise ValueError(f"{platform['id']} missing criteria: {missing}")

        counts = {"full": 0, "partial": 0, "none": 0}
        total_score = 0
        for cid in criteria_ids:
            entry = checks[cid]
            status = entry["status"]
            if status not in scoring:
                raise ValueError(f"{platform['id']}.{cid} invalid status: {status}")
            url = entry.get("source_url", "")
            if not url.startswith("https://"):
                raise ValueError(f"{platform['id']}.{cid} source_url must be https://: {url}")
            counts[status] += 1
            total_score += scoring[status]

        leaderboard.append(
            {
                "id": platform["id"],
                "name": platform["name"],
                "score": total_score,
                "max_score": max_score,
                "full_count": counts["full"],
                "partial_count": counts["partial"],
                "none_count": counts["none"],
            }
        )

    leaderboard.sort(key=lambda row: (-row["score"], -row["full_count"], row["name"]))

    by_criterion = {}
    for crit in criteria:
        cid = crit["id"]
        by_criterion[cid] = {
            "label": crit["label"],
            "full": [p["id"] for p in vendors_data["platforms"] if p["checks"][cid]["status"] == "full"],
            "partial": [p["id"] for p in vendors_data["platforms"] if p["checks"][cid]["status"] == "partial"],
            "none": [p["id"] for p in vendors_data["platforms"] if p["checks"][cid]["status"] == "none"],
        }

    return {
        "checked_on": criteria_data["checked_on"],
        "criteria_count": len(criteria_ids),
        "platform_count": len(leaderboard),
        "max_score": max_score,
        "leaderboard": leaderboard,
        "by_criterion": by_criterion,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--write", action="store_true", help="Write summary.json")
    parser.add_argument("--verify", action="store_true", help="Verify summary.json matches computed output")
    args = parser.parse_args()

    criteria_data = json.loads((KIT_DIR / "criteria.json").read_text(encoding="utf-8"))
    vendors_data = json.loads((KIT_DIR / "vendors.json").read_text(encoding="utf-8"))
    computed = compute_summary(criteria_data, vendors_data)
    summary_path = KIT_DIR / "summary.json"

    if args.write:
        summary_path.write_text(json.dumps(computed, indent=2) + "\n", encoding="utf-8")
        print(f"Wrote {summary_path} ({computed['platform_count']} platforms, max {computed['max_score']})")
        return 0

    if args.verify:
        existing = json.loads(summary_path.read_text(encoding="utf-8"))
        if existing != computed:
            raise SystemExit("summary.json does not match recomputed scores")
        top = computed["leaderboard"][0]
        print(
            f"Verified {computed['platform_count']} platforms across {computed['criteria_count']} "
            f"criteria (top: {top['name']} {top['score']}/{top['max_score']})"
        )
        return 0

    print(json.dumps(computed, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
