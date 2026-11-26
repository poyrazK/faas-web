**Write durable workflows with retries, multi-day sleeps, and external event waits as ordinary async functions without keeping a VM running.** On Gregale, code-first workflows park runs between steps—for seconds or months—while holding zero running compute, then replay your function deterministically on resume using recorded step outputs.

> **Preview:** Workflow execution is a preview capability on the **Hobby, Pro, and Scale** plans.

## Why multi-day workflows normally require extra infrastructure

Multi-step onboarding flows, trial follow-ups, billing dunning, or manual refund approvals outlive HTTP timeouts and single worker restarts. On most platforms, teams end up operating Temporal clusters, wiring a separate workflow SaaS such as Inngest or Trigger.dev, or hand-rolling Postgres polling crons and idempotency state machines.

## Declare and write a code-first workflow

Declare the entry endpoint in `gregale.yaml`:

```yaml
workflows:
  - name: order_followup
    trigger:
      type: manual
    code:
      run: order_followup
      timeout: 60s
      retry:
        max_attempts: 3
        backoff: exponential
```

Write the workflow as standard async code using the Node SDK (`@gregale/sdk-node/workflows`), Python SDK (`faas_sdk.workflows`), or Go SDK (`github.com/gregale-dev/gregale-go`):

```js
import http from 'node:http';
import { defineWorkflow, serveWorkflows, toNodeListener } from '@gregale/sdk-node/workflows';

const orderFollowup = defineWorkflow('order_followup', async (order, wf) => {
  const charge = await wf.step('charge', ({ idempotencyKey }) =>
    payments.charge(order.id, { idempotencyKey })
  );
  await wf.sleep('delivery_delay', '3d');
  const delivery = await wf.step('check_delivery', () => shipping.status(order.id));
  if (delivery.state !== 'delivered') {
    const approval = await wf.waitForEvent('refund_approval', { event: 'approved', timeout: '7d' });
    if (!approval) return { outcome: 'expired' };
    await wf.step('refund', () => payments.refund(charge.id));
    return { outcome: 'refunded' };
  }
  return { outcome: 'delivered' };
});

const workflows = serveWorkflows([orderFollowup]);
http
  .createServer((req, res) => {
    if (req.url === '/order_followup') return toNodeListener(workflows)(req, res);
  })
  .listen(Number(process.env.PORT ?? 8080));
```

`serveWorkflows` mounts directly in Node HTTP servers, Hono, Next.js route handlers, or Bun, and `faas_sdk.workflows` mounts as an ASGI app in FastAPI.

## Operations, sleep durations, and deterministic replay

When `wf.sleep` or `wf.waitForEvent` is reached, Gregale suspends the run and parks any idle app compute. When the timer fires or an event arrives (`gregale workflow events RUN_ID approved --payload '{...}'`), Gregale replays the workflow function from the top: completed `step` calls return their recorded JSON results immediately instead of re-executing.

- **`step(name, fn, { retry })`:** Retries failures under the step policy (default `3` attempts with exponential back-off) and passes a stable `idempotencyKey` (`workflow/<run-id>/<step-name>`) unchanged across attempts. Throw `NonRetryableError` (`faas.NonRetryable` in Go) to fail immediately.
- **`sleep(name, duration)`:** Parks the run from `1 s` up to your plan's maximum wait (**30 days on Hobby, 90 on Pro, 365 on Scale**).
- **`waitForEvent(name, { event, timeout })`:** Resumes with the event payload or `null` after `timeout`. Avoid passing the exact object `{"timeout":true}` as customer event data, as that shape is reserved for internal timeouts.
- **`call(function, input, { name })`:** Calls another permitted function or app asynchronously and parks the run while waiting for its response with no VM held.
- **Concurrency and loops:** `Promise.all` (Node), `asyncio.gather` (Python), and `faas.WorkflowParallel` (Go) run steps concurrently; repeated step names in loops automatically number themselves (`poll`, `poll#2`, `poll#3`, ...).

Because replay relies on deterministic structure, read clocks, random values, environment variables, and network APIs strictly inside `step` functions, and never rename or reorder operations for deployments that still have in-flight runs.

## Local testing and execution limits

Test workflows in-process with `runWorkflowLocally` (`run_workflow_locally` in Python, `faas.RunWorkflowLocally` in Go), which completes sleeps immediately and feeds test events without deploying:

| Limit                                               | Value   |
| --------------------------------------------------- | ------- |
| Operations per run                                  | 1,000   |
| Recorded results, payloads and errors per run       | 1.5 MiB |
| Results reported by one call (parallel steps share) | 960 KiB |
| Workflow output                                     | 960 KiB |

Store payloads larger than `960 KiB` in [object storage](/docs/object-storage) and pass their object keys between steps.

## When another option fits better

- **Workloads past 1,000 steps per run or needing GA maturity today:** Code-first workflows are currently in Preview on Hobby and up, and runs exceeding 1,000 operations hit the per-run cap (`dead`). For massive long-lived workflows needing continue-as-new or GA stability guarantees today, a dedicated engine like Temporal fits better.
- **Stored workflow tooling:** Unlike declarative stored workflows, code-first runs cannot be resumed with `gregale workflow resume`, linked to Operations, or run in the stored-workflow simulator; start a new run when recovering a broken code change.

See [Code-first workflows](/docs/code-workflows), [Build stored workflows](/docs/stored-workflows), [SDKs](/docs/sdks), [Object storage](/docs/object-storage), and [Gregale pricing](/pricing).
