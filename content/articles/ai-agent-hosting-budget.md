**On Gregale, every AI agent has a monthly budget for the always-on capacity
it adds to your bill.** An agent can raise what you pay without any traffic,
for example by keeping instances warm, adding workers or giving warm
instances more RAM. Gregale prices each such change before it is made. Within
the budget it goes through; past it, the change waits for your approval, and
the review page shows what it adds per month.

## What the budget counts

The always-on cost the agent's changes keep running:

- warm instances (`min_instances`, a scaling policy's floor or schedule),
- services and workers, whose replicas run whatever the traffic,
- more RAM on warm instances,
- prewarming.

Each change is priced by how much it adds at the overage rate, before it is
made. Traffic-driven usage is not counted: your account's spend cap still
bounds that. Lowering cost never asks, and gives the budget back.

The default is half your plan's default spend cap. Set one per agent:

```sh
gregale mcp connection budget <id>             # budget and the always-on cost in use
gregale mcp connection budget <id> --set 40    # $40 a month
gregale mcp connection budget <id> --unlimited
gregale mcp connection budget <id> --default
```

An organization can cap every agent acting in it; the lower of the agent's
budget and the ceiling applies:

```sh
gregale org agent policy set --org acme --agents allow --max-budget 100
```

## The agent can check the cost first

An agent reads its own budget with `gregale mcp connection budget --self`
(MCP: `gregale_agent_budget`) and can price a change before it makes it:
`gregale app <slug> scale --plan` or the MCP tool `gregale_plan_scale` shows
the added cost, the budget left and whether a person would be asked. The
header `Gregale-Agent-Preview: budget` does the same for any client; Gregale
prices it as the real request and changes nothing.

## How other setups compare

Cloud spend caps and budget alerts work on a whole account or project. They
tell you after the money is spent, or stop everything when the cap is hit,
and they don't say which agent added the cost. Gregale prices each agent's
change before it happens and stops only that change.

## Related

- [Human approval before an AI agent changes production](/articles/ai-agent-production-approval)
- [Undo what an AI agent changed](/articles/undo-ai-agent-changes)
- Reference: [Limit what an agent adds to your bill](/docs/agents#limit-what-an-agent-adds-to-your-bill)
