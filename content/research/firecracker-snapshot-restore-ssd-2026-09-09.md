## Results

The scheduler recorded 100 distinct snapshot restores. The platform wake interval had a p95 of **137.756 ms**.

| Interval (ms) |    Min |   Mean |    p50 |     p90 |     p95 |     p99 |     Max |
| ------------- | -----: | -----: | -----: | ------: | ------: | ------: | ------: |
| Platform wake | 73.094 | 99.011 | 94.795 | 131.502 | 137.756 | 148.229 | 149.067 |

Zero platform samples reached the run’s 350 ms acceptance threshold. All three required artifacts were cache hits for every wake. The scheduler recorded zero concurrent wakes and zero queued requests at admission.

## Test environment

| Component        | Configuration                                                       |
| ---------------- | ------------------------------------------------------------------- |
| Gregale release  | `v0.1.18-rc.94`, commit `86968d3d8d39670cc553f397358b70938bed49bc`  |
| Compute          | One compute node. Reference inventory lists 4 vCPUs and 16 GiB RAM. |
| Artifact storage | SSD, recorded as `pd-ssd` in the run archive                        |
| Workload         | Go 1.24 Alpine HTTP fixture, 256 MiB, a single allowed instance     |
| Idle timeout     | 10 seconds, using the normal idle reaper                            |

## Methodology

Each cycle sent one request after the idle reaper parked the only running instance. The **platform wake** interval is the elapsed time between the scheduler’s `wake.boot_started` and `wake.boot_completed` events for the same wake ID. All 100 matched timelines recorded snapshot restores. The distribution uses nearest-rank percentiles.

## Data and reproduction

Download the [complete reproduction kit](/research/firecracker-snapshot-restore-ssd-2026-09-09/reproduction.tar.gz) and run this command in the extracted directory. It recomputes the wake distribution and compares it with the published summary using Python 3.11 or later and its standard library.

```sh
python3 analyze.py --verify
```

- [Per-request samples (CSV)](/research/firecracker-snapshot-restore-ssd-2026-09-09/samples.csv)
- [Computed distributions (JSON)](/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json)
- [Offline analysis script (Python)](/research/firecracker-snapshot-restore-ssd-2026-09-09/analyze.py)
- [Kit instructions (Markdown)](/research/firecracker-snapshot-restore-ssd-2026-09-09/README.md)

Or run `python3 analyze.py samples.csv` to print the recomputed JSON summary. The CSV gives both scheduler timestamps as microsecond offsets from the first recorded wake, along with the restore method and admission conditions for each sample.

For a fresh run, use an instrumented test deployment with the same workload, memory, instance limit, idle timeout, and storage class. Verify that the instance parks between requests and that each timeline records a restore on the selected host. Use the same scheduler events and percentile method.

## Limits

This historical acceptance run covers the scheduler wake interval for one Gregale release on one SSD node, with warm artifact caches and sequential traffic. Concurrent wakes, cache misses, fresh boots, and current production performance require separate measurements. See the [current scale-to-zero documentation](/docs/scale-to-zero) for the platform target and measurement boundaries.
