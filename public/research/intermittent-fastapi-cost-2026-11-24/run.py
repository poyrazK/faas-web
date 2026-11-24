"""Collect traffic, instance state, and billable usage for an isolated fixture."""

import argparse
from concurrent.futures import ThreadPoolExecutor
import csv
from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import time
from urllib.error import HTTPError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


PHASES = ("spread", "burst", "burst", "spread")
CONTROL_SECONDS = 60
WINDOW_SECONDS = 120
RESET_SECONDS = 60
SAMPLE_SECONDS = 10
OFFSETS = {
    "spread": (5, 35, 65, 95),
    "burst": (5, 5.5, 6, 6.5),
}
FIELDS = (
    "window", "pattern", "request", "scheduled_seconds", "sent_at", "status", "wake",
)


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def cli(*args):
    result = subprocess.run(
        ["gregale", "--non-interactive", "--json", *args],
        capture_output=True,
        text=True,
        check=True,
        timeout=30,
    )
    # Instance listings can be newline-delimited JSON instead of a JSON array.
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return [json.loads(line) for line in result.stdout.splitlines() if line.strip()]


def timestamp(seconds):
    return datetime.fromtimestamp(seconds, timezone.utc).isoformat().replace("+00:00", "Z")


def history(slug):
    rows = cli("app", "instances", slug, "--all")
    return [rows] if isinstance(rows, dict) else rows


def idle(slug):
    return instance_state(slug) == "no_resident"


def instance_state(slug):
    states = {
        row["state"] for row in history(slug)
        if row.get("resident") or row["state"] == "waking"
    }
    return ",".join(sorted(states)) if states else "no_resident"


def sample_states(slug, window, number):
    samples = []
    for offset in range(0, WINDOW_SECONDS, SAMPLE_SECONDS):
        wait_until(window + offset)
        before = timestamp(time.time())
        state = instance_state(slug)
        samples.append((number, offset, before, timestamp(time.time()), state))
    return samples


def ledger(slug, since, until):
    start, end = timestamp(since), timestamp(until)
    data = cli("api", "route", "activity", slug, "--since", start, "--until", end)
    if data["from"] != start or data["until"] != end:
        raise RuntimeError("The ledger returned a different window")
    sample = next(
        (row for row in data["routes"] if row["method"] == "GET" and row["route"] == "/sample"),
        {},
    )
    keys = (
        "from", "until", "window_seconds", "idle_timeout_seconds", "mb_seconds",
        "gb_hours", "awake_seconds", "wakes", "unattributed_seconds",
    )
    return {
        **{key: data[key] for key in keys},
        "sample_requests": sample.get("requests", 0),
        "sample_wakes": sample.get("wakes", 0),
    }


def wait_until(target):
    while (remaining := target - time.time()) > 0:
        time.sleep(remaining)


def send(opener, url):
    request = Request(url + "/sample", headers={"User-Agent": "Gregale-Research-Fixture/1"})
    try:
        with opener.open(request, timeout=15) as response:
            if json.load(response) != {"fixture": "intermittent-fastapi"}:
                raise RuntimeError("Unexpected fixture response")
            return response.status, response.headers.get("x-faas-wake", "")
    except HTTPError as error:
        return error.code, error.headers.get("x-faas-wake", "")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("slug", help="A disposable, idle app running this benchmark fixture")
    parser.add_argument("output", type=Path, help="A new directory for evidence files")
    args = parser.parse_args()
    args.output.mkdir(mode=0o700)
    app = cli("app", "get", args.slug)
    if (
        app["slug"] != args.slug
        or app["deployment_availability"] != "live"
        or app["ram_mb"] != 256
        or app["cpu_millicores"] != 500
        or app["idle_timeout_s"] != 15
        or app["max_concurrency"] != 1
        or app["min_instances"] != 0
        or app.get("require_authn")
        or app["manifest"].get("pause") != "between_requests"
    ):
        raise SystemExit("Deploy the fixture with the documented resource and lifecycle settings")
    url = (app.get("canonical_url") or app["url"]).rstrip("/")
    if urlsplit(url).scheme != "https":
        raise SystemExit("Expected the fixture to have a public HTTPS URL")

    deadline = time.monotonic() + 180
    while not idle(args.slug):
        if time.monotonic() > deadline:
            raise SystemExit("The fixture did not settle into a nonresident state")
        time.sleep(10)

    control_start = (int(time.time()) // 60 + 1) * 60
    start = control_start + CONTROL_SECONDS
    starts = [start + index * (WINDOW_SECONDS + RESET_SECONDS) for index in range(len(PHASES))]
    finish = starts[-1] + WINDOW_SECONDS
    print("Control starts", timestamp(control_start), "traffic ends", timestamp(finish), flush=True)
    opener = build_opener(NoRedirect)
    states = []
    with (
        (args.output / "traffic.csv").open("w", newline="") as output,
        ThreadPoolExecutor(max_workers=1) as sampler,
    ):
        writer = csv.writer(output)
        writer.writerow(FIELDS)
        for index, (pattern, window) in enumerate(zip(PHASES, starts), 1):
            wait_until(window)
            state_samples = sampler.submit(sample_states, args.slug, window, index)
            for number, offset in enumerate(OFFSETS[pattern], 1):
                wait_until(window + offset)
                sent_at = timestamp(time.time())
                status, wake = send(opener, url)
                writer.writerow((index, pattern, number, offset, sent_at, status, wake))
                output.flush()
                if status != 200:
                    raise RuntimeError(f"Window {index} request {number} returned HTTP {status}")
            samples = state_samples.result()
            first_sample_completed = datetime.fromisoformat(samples[0][-2]).timestamp()
            if samples[0][-1] != "no_resident" or first_sample_completed >= window + 5:
                raise RuntimeError(f"Window {index} did not verify a nonresident start")
            states.extend(samples)
            print(f"Completed window {index} ({pattern})", flush=True)
            if index < len(PHASES):
                wait_until(window + WINDOW_SECONDS + 5)
                cli("app", "park", args.slug)
                if not idle(args.slug):
                    raise RuntimeError(f"Fixture did not park after window {index}")
    with (args.output / "states.csv").open("w", newline="") as output:
        writer = csv.writer(output)
        writer.writerow(("window", "offset_seconds", "read_started_at", "read_completed_at", "state"))
        writer.writerows(states)

    # Ask for the same minute-aligned windows twice after the metering flush.
    evidence = []
    for settle_seconds in (120, 180):
        wait_until(finish + settle_seconds)
        windows = [ledger(args.slug, control_start, start)]
        for since in starts:
            windows.append(ledger(args.slug, since, since + WINDOW_SECONDS))
        evidence.append({"collected_at": timestamp(time.time()), "windows": windows})
        (args.output / "ledger.json").write_text(json.dumps(evidence, indent=2) + "\n")


if __name__ == "__main__":
    main()
