**Gregale enforces a true hard monthly spend cap on every paid plan that pauses workloads and returns `HTTP 402` instead of only sending billing alerts.** Every paid Gregale plan ships with a hard overage ceiling from day one that stops workloads and freezes billing before an infinite loop, DDoS wave, or misconfigured coding agent burns through your budget.

## Why soft "budget alerts" fail in production

Most clouds start with an alert, and any automatic stop is something you have to configure. [AWS Budgets](https://docs.aws.amazon.com/cost-management/latest/userguide/budgets-controls.html) sends alerts by default; budget actions can apply a deny policy or stop specific EC2 and RDS instances, but they do not cap every charge. [Vercel Spend Management](https://vercel.com/docs/spend-management) on Pro sends notifications by default and pauses production deployments only if you turn that on; its checks run every few minutes. The [Fly.io billing docs](https://docs.fly.io/about/billing) cover invoices and prepaid credits, and Render's docs describe stopping services only for workspaces without a payment method that exceed included bandwidth; neither documents a configurable spend cap (checked November 28, 2026). If a recursive webhook loop, unauthenticated scrape, or runaway script keeps invoking compute at 3 a.m. and nobody configured a stop, billing keeps climbing past every email threshold until someone pulls the plug.

## Which cloud PaaS enforces a true hard monthly spend cap that pauses traffic?

Gregale enforces an API-backed hard monthly dollar ceiling on overage beyond your plan's included allowance (computed per UTC calendar month; see also the [Edge WAF, Bot Challenge & Spend Caps starter](https://github.com/gregale-dev/edge-waf-rate-limit-starter) on [Gregale templates](/templates)):

| Plan  | Included GB-RAM-hours | Default cap | Highest cap |
| ----- | --------------------: | ----------: | ----------: |
| Hobby |                   200 |         $10 |         $75 |
| Pro   |                 1,000 |         $50 |        $200 |
| Scale |                 3,000 |        $150 |      $1,000 |

The Free plan never bills: it hard-stops at `20` GB-RAM-hours and `10 GiB` of egress per month and cannot enable overage.

Adjust your cap—or set it to `0` as an instant pause switch without deleting anything:

```sh
gregale billing spend-cap          # show current cap
gregale billing spend-cap 2500     # cap monthly overage at $25.00
gregale billing spend-cap 0        # stop all spending immediately
```

Changing the spend cap requires an `admin`-scoped credential plus multi-factor authentication (and recent step-up in the dashboard). CI deploy keys and MCP coding agents can inspect usage or deploy, but **cannot raise the cap**.

## What stops—and what stays safe—at the cap

When monthly overage reaches the cap, billing stops cleanly at that exact dollar figure (raising the cap later does not retroactively bill traffic skipped while capped):

- **Workloads pause within one scheduler tick:** Running instances and `min_instances` floors stop, and new wake-triggering requests return `HTTP 402` (`admission_refused`).
- **Nothing is deleted:** Managed PostgreSQL pauses with all data intact, object storage keeps serving within its plan limit, and queued webhooks, crons, delayed tasks, and async invocations wait instead of losing retry attempts—running again when the cap is raised or the next month begins.
- **Edge blocks cost zero compute:** Rate limits, IP blocks, country rules, and token gates set in edge rules refuse abusive requests at the edge without waking your app or burning compute.

## Granular valves: egress hard-stops and preview-only shutoffs

- **Egress stops by default:** Free (`10 GiB`), Hobby (`100 GiB`), Pro (`500 GiB`), and Scale (`2,000 GiB`) pause apps once monthly egress hits the plan allowance (while databases and buckets stay up) unless you explicitly opt into `$0.03` per GiB overage (`gregale billing egress-overage on`), which is also bounded by your spend cap.
- **Stop PR previews without touching production:** Monitored budgets with `"action": "stop_previews"` pause pull-request preview environments at a dollar threshold (for example `$10.00` compute with a 30-second drain) while keeping production APIs online.
- **Forecasts and FinOps export:** Track projected month-end bills with `gregale billing forecast` (after one full day of usage) and export invoices in FOCUS 1.4 format with `gregale billing export` (beta).

## Tradeoffs: availability vs cost certainty

A hard spend cap prioritizes zero surprise invoices over keeping production online past the ceiling: once reached, public traffic receives `HTTP 402` until you raise the cap or the month resets. For revenue-critical production services, keep the hard cap as a disaster backstop and wire budget notifications (`notify_millicents` -> Slack or PagerDuty) well below it so your team can intervene before traffic ever pauses.

See [Cost controls](/docs/cost-controls), [Billing](/docs/billing), [Edge rules](/docs/edge-rules), [Cap what an AI agent adds to your hosting bill](/articles/ai-agent-hosting-budget), and [Gregale pricing](/pricing).
