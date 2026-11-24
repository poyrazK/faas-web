## Results

All 100 timed requests were associated with distinct snapshot restores. The platform interval had a p95 of **137.756 ms**, while the public request had a p95 of **502.180 ms**. The two measurements have different start and end points.

| Interval (ms)  |     Min |    Mean |     p50 |     p90 |     p95 |     p99 |     Max |
| -------------- | ------: | ------: | ------: | ------: | ------: | ------: | ------: |
| Platform wake  |  73.094 |  99.011 |  94.795 | 131.502 | 137.756 | 148.229 | 149.067 |
| Public request | 244.770 | 433.529 | 424.506 | 475.346 | 502.180 | 555.937 | 811.678 |

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

The client issued requests sequentially to the public endpoint. Before each timed request, the only instance had parked through the normal idle reaper. Each request was joined to its scheduler wake timeline by wake ID. The start and end of the **platform wake** interval were the scheduler’s `wake.boot_started` and `wake.boot_completed` events. **Public request** time is the total elapsed time recorded by the client.

One request returned a warm response header. Its newly created instance and wake timeline confirmed a distinct restore, which was matched through the instance’s wake ID. The distributions include all 100 matched rows and use nearest-rank percentiles.

## Data and reproduction

- [Per-request samples (CSV)](/research/firecracker-snapshot-restore-ssd-2026-09-09/samples.csv)
- [Computed distributions (JSON)](/research/firecracker-snapshot-restore-ssd-2026-09-09/summary.json)
- [Offline analysis script (Python)](/research/firecracker-snapshot-restore-ssd-2026-09-09/analyze.py)

Download the CSV and script into the same directory and run the command below. It uses the Python standard library and prints the distributions in the report. The CSV preserves the public durations and both scheduler timestamps as microsecond offsets from the first recorded wake. Infrastructure identifiers and unrelated event fields were removed without changing the measured intervals.

```sh
python3 analyze.py samples.csv
```

For a fresh run, use an instrumented test deployment with the same workload, memory, instance limit, idle timeout, and storage class. Verify that the instance parks between requests and that each timeline records a restore on the selected host. Record the public client location and reuse the same timing boundaries and percentile method.

## Limits

This historical acceptance run covers one Gregale release, one SSD node, warm artifact caches, and sequential traffic. The run archive leaves the client location, compute location, and network route unverified. The client records give total elapsed times. Hop-by-hop network timings are unavailable. Concurrent wakes, cache misses, fresh boots, and current production performance require separate measurements. See the [current scale-to-zero documentation](/docs/scale-to-zero) for the platform target and measurement boundaries.
