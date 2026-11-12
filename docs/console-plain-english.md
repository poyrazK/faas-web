# Plain English first

How every console section reads. A developer should know what is going on and
what to do within one glance, without decoding system vocabulary.

## The five rules

1. **Answer first.** A section opens with one plain sentence, set larger than
   everything else, that says the state and whether anything needs doing:
   "Healthy — api-gateway is serving traffic normally. Nothing needs your
   attention." Badges, counts and timestamps come after it, smaller.
2. **One obvious action.** When something can be done, there is one primary
   button named as a verb for the person's goal: "Upgrade plan", "Roll back",
   "Upload files", "Restore database". Secondary actions are quieter. Per-row
   actions live behind a `⋯` menu or appear on the row, not as four text links.
3. **Plain words first, the technical term second.** Say "Sleeps when idle",
   not "scales to zero"; "Replaced", not "superseded"; "Paused because its size
   isn't included in your plan", not "suspended · class not in plan"; "built in
   4 min", not "247.0s". Keep the exact term in a `title` or a `?` tip for people
   who search for it.
4. **Detail on request.** Ids, digests, thresholds, raw codes, scope caveats and
   full histories go behind "Show…" or a `HelpTip`. They stay one click away;
   they are never deleted.
5. **Change over time as a picture.** A run of state changes becomes a strip or
   a timeline (healthy / degraded / unhealthy / not checked as colour bands),
   with the list of transitions behind "Show every change".

## Honesty still wins

Every sentence is built from fields the API returns. Never invent a timing ("in
about 4 minutes") or a cause the API does not state; when the API does not say,
the sentence says less. Unknown stays unknown, never zero.

## Reference designs

The four worked examples — app Health, Deployments, Databases and Object
storage — are on the redesign canvas (page "Plain English (UX)"). Status colours
come from tokens: brand/`--status-good` for healthy, `--status-warning` for
degraded or attention, `--status-critical` for down or blocked, a hollow ring for
"not running" or "not checked".
