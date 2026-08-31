# Billing and spend caps

Plans, what you actually used, the invoices that follow, the card they charge, and the cap that keeps an incident from becoming a bill.

## Plans

Four self-serve tiers — `free`, `hobby`, `pro`, `scale` — plus Enterprise. The plan lives on the organisation; switching (`gregale plan <plan>`, or **Plans** in the console) changes the subscription server-side and can bill immediately, which is why both surfaces confirm first. A switch that needs a payment method answers with a checkout link.

## Usage

Compute is metered in GB-hours — memory × time, counted while instances are resident. An app parked at zero costs zero compute.

```
gregale usage                 # this month
gregale usage daily --day 2026-08-30
gregale usage storage
gregale usage summary
```

In the console: **Usage**, with the per-app daily bars, and the account-wide service-level panel on the overview.

## The overage cap

Usage past the plan's included allowance bills as overage — unless you cap it:

```
gregale overage-cap 5000     # cap overage at $50.00
gregale overage-cap --clear
```

The cap is in cents, account-wide. With a cap set, the platform stops serving overage-billable work rather than billing past it — the trade you choose for a side project that must never surprise you. In the console: the spend-cap control on the **Usage** page.

## Invoices and the card on file

`gregale invoices` lists billing history; the console's **Invoices** page adds the payment-method summary — brand, last four digits, expiry — and warns when the card is inside 60 days of expiring, which is how invoices start failing quietly.

```
gregale billing payment-method   # show the card on file
gregale billing portal           # open the provider portal (update card, download PDFs)
gregale billing retry            # retry the latest failed invoice payment
gregale billing cancel           # cancel at period end
gregale billing status           # subscription state
```

Card changes and PDFs happen in the provider's portal — the platform never holds the PAN.

## When payment fails

A failed invoice moves the organisation to `past_due`; `gregale billing retry` re-attempts after you fix the card. Cancelling keeps the subscription alive until the period ends, then drops to the free tier.
