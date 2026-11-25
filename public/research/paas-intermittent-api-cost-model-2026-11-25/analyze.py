"""Deterministic monthly PaaS cost model across published vendor rates."""

import argparse
from decimal import Decimal, ROUND_HALF_UP
import json
from pathlib import Path


CENT = Decimal("0.01")
KIB_DIVISOR = Decimal("1024")
MILLION = Decimal("1000000")


def d(value) -> Decimal:
    return Decimal(str(value))


def money(value: Decimal) -> str:
    return f"{value.quantize(CENT, rounding=ROUND_HALF_UP):.2f}"


def compute_scenario(scenario: dict, vendors_data: dict) -> dict:
    hours_mo = d(vendors_data["hours_per_month"])
    v = vendors_data["vendors"]
    apps = int(scenario["apps"])
    ram_mb = int(scenario["ram_mb"])
    requires_db = bool(scenario["requires_postgres"])
    active_h = d(scenario["active_hours_per_app_per_month"])
    reqs = d(scenario["requests_per_month"])
    req_dur = d(scenario["avg_request_duration_seconds"])
    railway_vcpu = d(scenario["railway_avg_vcpu_while_active"])
    cr_vcpu = d(scenario["cloud_run_vcpu"])
    cr_gib = d(scenario["cloud_run_gib"])

    offers = {}

    # Gregale Free (1 app <= 256 MB, no Postgres, hard cap at 20 GB-RAM-h)
    g = v["gregale"]
    g_free = g["free"]
    g_free_gbh = (
        d(apps) * active_h * (d(ram_mb) + d(g["ram_overhead_mb"])) / KIB_DIVISOR
    )
    if (
        apps <= int(g_free["max_apps"])
        and ram_mb <= int(g_free["ram_mb"])
        and not requires_db
        and g_free_gbh <= d(g_free["included_gb_ram_hours"])
    ):
        offers["gregale_free"] = {
            "eligible": True,
            "monthly_usd": money(d(g_free["monthly"])),
            "gb_ram_hours": str(round(float(g_free_gbh), 3)),
            "note": "Within 20 GB-RAM-h Free allowance; hard cap (no overage).",
        }
    else:
        offers["gregale_free"] = {
            "eligible": False,
            "monthly_usd": None,
            "note": "Ineligible (requires Hobby+ for Postgres, >1 app, or >256 MB RAM).",
        }

    # Gregale Hobby (up to 5 apps, 512 MB, 200 GB-RAM-h, 1 Postgres included)
    g_hobby = g["hobby"]
    g_hobby_gbh = (
        d(apps) * active_h * (d(ram_mb) + d(g["ram_overhead_mb"])) / KIB_DIVISOR
    )
    g_overage = max(Decimal("0"), g_hobby_gbh - d(g_hobby["included_gb_ram_hours"]))
    g_hobby_cost = d(g_hobby["monthly"]) + g_overage * d(g["overage_per_gb_ram_hour"])
    offers["gregale_hobby"] = {
        "eligible": True,
        "monthly_usd": money(g_hobby_cost),
        "gb_ram_hours": str(round(float(g_hobby_gbh), 3)),
        "overage_gb_ram_hours": str(round(float(g_overage), 3)),
        "note": "Includes up to 5 apps, 200 GB-RAM-h, and 1 Postgres (1 GiB, 7d PITR).",
    }

    # Render Free (1 web service <= 750h, spins down after 15m, no durable Postgres)
    r = v["render"]
    if apps == 1 and not requires_db and active_h <= d(r["free_instance_hours_per_month"]):
        offers["render_free"] = {
            "eligible": True,
            "monthly_usd": money(d(r["free_web_monthly"])),
            "note": "Spins down after 15 min idle (~1 min cold start); 750 free h/mo.",
        }
    else:
        offers["render_free"] = {
            "eligible": False,
            "monthly_usd": None,
            "note": "Ineligible (paid Render Postgres needed or >1 service).",
        }

    r_paid_cost = d(apps) * d(r["starter_512mb_monthly"]) + (
        d(r["postgres_basic_256mb_monthly"]) if requires_db else Decimal("0")
    )
    offers["render_paid"] = {
        "eligible": True,
        "monthly_usd": money(r_paid_cost),
        "note": "Render Starter 512 MB ($7/service) + Basic 256 MB Postgres ($6 if used).",
    }

    # Railway Hobby ($5 minimum credited toward usage)
    rw = v["railway"]
    ram_gb = d(ram_mb) / KIB_DIVISOR
    rw_db_cost = (
        (
            d(rw["postgres_small_ram_gb"]) * d(rw["ram_per_gb_month"])
            + d(rw["postgres_small_avg_vcpu"]) * d(rw["cpu_per_vcpu_month"])
        )
        if requires_db
        else Decimal("0")
    )
    rw_per_app_full = ram_gb * d(rw["ram_per_gb_month"]) + railway_vcpu * d(
        rw["cpu_per_vcpu_month"]
    )
    rw_always_raw = d(apps) * rw_per_app_full + rw_db_cost
    rw_always_cost = max(d(rw["hobby_minimum_monthly"]), rw_always_raw)
    offers["railway_hobby_always_on"] = {
        "eligible": True,
        "monthly_usd": money(rw_always_cost),
        "raw_usage_usd": money(rw_always_raw),
        "note": "Hobby $5 minimum; assumed small always-on Postgres ($3.50/mo) when needed.",
    }

    rw_active_fraction = min(
        Decimal("1"),
        (active_h * d(rw["serverless_sleep_tail_factor"])) / hours_mo,
    )
    rw_serverless_raw = d(apps) * rw_per_app_full * rw_active_fraction + rw_db_cost
    rw_serverless_cost = max(d(rw["hobby_minimum_monthly"]), rw_serverless_raw)
    offers["railway_hobby_serverless"] = {
        "eligible": True,
        "monthly_usd": money(rw_serverless_cost),
        "raw_usage_usd": money(rw_serverless_raw),
        "note": "Serverless sleep enabled (modeled with 1.5x active-hour tail factor).",
    }

    # Fly.io Auto-Stop and Always-On
    fly = v["fly"]
    fly_machine = d(
        fly["shared_cpu_1x_256mb_monthly"]
        if ram_mb <= 256
        else fly["shared_cpu_1x_512mb_monthly"]
    )
    fly_stopped_rootfs = d(fly["stopped_rootfs_per_gb_month"]) * d(fly["assumed_rootfs_gb"])
    fly_active_frac = min(Decimal("1"), active_h / hours_mo)
    fly_db = d(fly["postgres_developer_monthly"]) if requires_db else Decimal("0")
    fly_autostop_cost = (
        d(apps)
        * (
            fly_machine * fly_active_frac
            + fly_stopped_rootfs * (Decimal("1") - fly_active_frac)
        )
        + fly_db
    )
    fly_always_cost = d(apps) * fly_machine + fly_db
    offers["fly_auto_stop"] = {
        "eligible": True,
        "monthly_usd": money(fly_autostop_cost),
        "note": "Auto-stop Machines + 1 GB stopped rootfs ($0.15/GB-mo) + Dev Postgres ($4 if used).",
    }
    offers["fly_always_on"] = {
        "eligible": True,
        "monthly_usd": money(fly_always_cost),
        "note": "Always-on shared-cpu-1x Machines + Developer Postgres ($4 if used).",
    }

    # Google Cloud Run (Tier 1 request-based billing, compute only)
    cr = v["cloud_run"]
    total_req_s = reqs * req_dur
    cr_billable_vcpu_s = max(Decimal("0"), total_req_s * cr_vcpu - d(cr["free_vcpu_seconds"]))
    cr_billable_gib_s = max(Decimal("0"), total_req_s * cr_gib - d(cr["free_gib_seconds"]))
    cr_billable_reqs = max(Decimal("0"), reqs - d(cr["free_requests"]))
    cr_cost = (
        cr_billable_vcpu_s * d(cr["vcpu_second_usd"])
        + cr_billable_gib_s * d(cr["gib_second_usd"])
        + (cr_billable_reqs / MILLION) * d(cr["requests_per_million_usd"])
    )
    offers["cloud_run_compute_only"] = {
        "eligible": True,
        "monthly_usd": money(cr_cost),
        "postgres_excluded": requires_db,
        "note": (
            "Compute only (excludes managed Cloud SQL Postgres)."
            if requires_db
            else "Tier 1 request-based billing with permanent monthly free tier."
        ),
    }

    # Heroku Paid (Basic 512 MB + Essential-0 Postgres)
    hk = v["heroku"]
    hk_paid_cost = d(apps) * d(hk["basic_512mb_monthly"]) + (
        d(hk["postgres_essential_0_monthly"]) if requires_db else Decimal("0")
    )
    offers["heroku_paid"] = {
        "eligible": True,
        "monthly_usd": money(hk_paid_cost),
        "note": "Basic 512 MB dynos ($7/app) + Essential-0 Postgres ($5 if used).",
    }

    return {
        "id": scenario["id"],
        "label": scenario["label"],
        "apps": apps,
        "ram_mb": ram_mb,
        "requires_postgres": requires_db,
        "active_hours_per_app_per_month": str(active_h),
        "requests_per_month": int(reqs),
        "offers": offers,
    }


def compute_all(directory: Path) -> dict:
    vendors_data = json.loads((directory / "vendors.json").read_text(encoding="utf-8"))
    scenarios_data = json.loads((directory / "scenarios.json").read_text(encoding="utf-8"))
    return {
        "checked_on": vendors_data["checked_on"],
        "currency": vendors_data["currency"],
        "scenarios": [
            compute_scenario(s, vendors_data) for s in scenarios_data["scenarios"]
        ],
    }


def render_markdown(data: dict) -> str:
    cols = [
        ("gregale_free", "Gregale Free"),
        ("gregale_hobby", "Gregale Hobby"),
        ("fly_auto_stop", "Fly Auto-Stop"),
        ("fly_always_on", "Fly Always-On"),
        ("railway_hobby_serverless", "Railway Serverless"),
        ("railway_hobby_always_on", "Railway Always-On"),
        ("render_free", "Render Free"),
        ("render_paid", "Render Paid"),
        ("heroku_paid", "Heroku Paid"),
        ("cloud_run_compute_only", "Cloud Run (compute only)"),
    ]
    header = "| Scenario | " + " | ".join(label for _, label in cols) + " |"
    sep = "|---|" + "|".join("---:" for _ in cols) + "|"
    rows = [header, sep]
    for s in data["scenarios"]:
        cells = []
        for key, _ in cols:
            o = s["offers"][key]
            if not o["eligible"]:
                cells.append("—")
            elif o.get("postgres_excluded"):
                cells.append(f"${o['monthly_usd']}*")
            else:
                cells.append(f"${o['monthly_usd']}")
        rows.append(f"| {s['label']} | " + " | ".join(cells) + " |")
    return "\n".join(rows)


def main() -> int:
    default_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory", nargs="?", type=Path, default=default_dir)
    parser.add_argument("--verify", action="store_true", help="Verify against summary.json")
    parser.add_argument("--markdown", action="store_true", help="Print Markdown table")
    args = parser.parse_args()

    result = compute_all(args.directory)
    if args.verify:
        expected = json.loads((args.directory / "summary.json").read_text(encoding="utf-8"))
        if result != expected:
            parser.exit(1, "Recomputed cost model differs from summary.json.\n")
        print(
            f"Verified published cost model. {len(result['scenarios'])} scenarios across "
            f"6 platforms (checked {result['checked_on']})."
        )
        return 0
    if args.markdown:
        print(render_markdown(result))
        return 0
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
