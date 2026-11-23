import { useState, type FormEvent } from 'react';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { errorMessage } from '@/lib/api/errors';
import {
  useAITagLimits,
  useOutboundAIUsages,
  useOutboundIntegrations,
  useOutboundUsages,
  useSetAITagLimits,
  type AITagLimit,
  type OutboundIntegration,
} from '@/lib/api/outbound';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import { integrationLimitRows, integrationsSummary } from '@/lib/integration-limits';
import { parseUsdMillicents } from '@/lib/money';
import { InlinePhase, Panel, queryPhase } from '../primitives';
import { LimitRow } from './limit-row';

/** `stored` is the saved amount, kept exactly while its text is untouched. */
type Draft = { tag: string; dollars: string; stored?: { text: string; millicents: number } };
/** apid's tag pattern (OutboundAITagLimit.tag) and list cap. */
const TAG = /^[a-z][a-z0-9_.-]{0,31}=[A-Za-z0-9._:@+/-]{1,64}$/;
const MAX_TAGS = 20;
/** Dollars with cents, or up to five decimals for a limit below a cent. */
const dollarsText = (millicents: number) =>
  millicents % 1000 === 0
    ? (millicents / 100_000).toFixed(2)
    : (millicents / 100_000).toFixed(5).replace(/0+$/, '');
const toDraft = (limit: AITagLimit): Draft => {
  const text = dollarsText(limit.daily_cost_limit_millicents);
  return {
    tag: limit.tag,
    dollars: text,
    stored: { text, millicents: limit.daily_cost_limit_millicents },
  };
};

/** Per-tag daily cost limits for one AI integration, saved as a whole list. */
function TagLimitsEditor({
  accountId,
  integration,
  onClose,
}: {
  accountId: string;
  integration: OutboundIntegration;
  onClose: () => void;
}) {
  const limits = useAITagLimits(accountId, integration.id);
  const save = useSetAITagLimits(accountId, integration.id);
  const [draft, setDraft] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string>();
  const rows = draft ?? limits.data?.map(toDraft);
  if (!rows)
    return (
      <InlinePhase
        phase={queryPhase({ loading: limits.isPending, error: limits.error })}
        error={limits.error}
        loadingMessage="Reading tag limits…"
        onRetry={() => void limits.refetch()}
      />
    );
  const change = (index: number, patch: Partial<Draft>) => {
    setError(undefined);
    setDraft(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const next: AITagLimit[] = [];
    const seen = new Set<string>();
    for (const row of rows) {
      const tag = row.tag.trim();
      if (!tag && !row.dollars.trim()) continue;
      if (!TAG.test(tag)) {
        setError('Write each tag as key=value, such as feature=search.');
        return;
      }
      if (seen.has(tag)) {
        setError('Use each tag once.');
        return;
      }
      seen.add(tag);
      // An untouched saved amount goes back exactly, even below a cent, which
      // the dollars field can't express.
      const millicents =
        row.stored && row.dollars === row.stored.text
          ? row.stored.millicents
          : parseUsdMillicents(row.dollars);
      if (!millicents) {
        setError(`Give ${tag} a dollar amount above $0, such as 12.50.`);
        return;
      }
      next.push({ tag, daily_cost_limit_millicents: millicents });
    }
    try {
      await save.mutateAsync(next);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  return (
    <form
      aria-label={`Per-tag cost limits for ${integration.name}`}
      onSubmit={(event) => void submit(event)}
      className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3"
    >
      <p className="text-xs text-muted-foreground">
        A tag is the key=value your app sends in X-Gregale-AI-Tags. A call carrying a tag is refused
        with 429 once that tag’s cost today would pass its limit.
      </p>
      {rows.length === 0 && <p className="text-sm text-muted-foreground">No tag has a limit.</p>}
      {rows.map((row, index) => (
        <div key={index} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs">
            Tag
            <Input
              value={row.tag}
              placeholder="feature=search"
              onChange={(e) => change(index, { tag: e.target.value })}
            />
          </label>
          <label className="flex w-32 flex-col gap-1 text-xs">
            Dollars a day
            <Input
              inputMode="decimal"
              value={row.dollars}
              onChange={(e) => change(index, { dollars: e.target.value })}
            />
          </label>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            aria-label={`Remove ${row.tag.trim() || 'empty tag'}`}
            onClick={() => setDraft(rows.filter((_, i) => i !== index))}
          >
            Remove
          </Button>
        </div>
      ))}
      {error && (
        <p role="alert" className="text-sm text-[color:var(--status-critical)]">
          {error}
        </p>
      )}
      <div className="flex flex-wrap justify-between gap-2">
        <Button
          type="button"
          size="xs"
          variant="outline"
          disabled={rows.length >= MAX_TAGS}
          onClick={() => setDraft([...rows, { tag: '', dollars: '' }])}
        >
          Add a tag
        </Button>
        <div className="flex gap-2">
          <Button type="button" size="xs" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" size="xs" busy={save.isPending}>
            Save tag limits
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * Spending limits › Integrations and AI: each outbound integration's daily
 * request limit and, for AI integrations, its token and cost limits, with
 * per-tag cost limits edited here. Folded by default; shown only when the
 * account has integrations. Integrations belong to the signed-in account, so a
 * company workspace never shows them.
 */
export function IntegrationsSection() {
  const workspace = useWorkspaceTarget();
  const accountId = useAuth().account?.id ?? '';
  const on = useCapabilityAccess('outbound-integrations').access === 'on';
  const aiOn = useCapabilityAccess('ai-gateway').access === 'on';
  const personal = workspace.ready && !workspace.org;
  const list = useOutboundIntegrations(on && personal ? accountId : '');
  const integrations = list.data ?? [];
  // Usage and AI usage need session MFA (the list doesn't), so they're read
  // only once the section is opened, never on page load.
  const [open, setOpen] = useState(false);
  const usages = useOutboundUsages(accountId, open ? integrations.map((i) => i.id) : []);
  const aiIntegrations = aiOn ? integrations.filter((i) => i.ai_provider) : [];
  const aiUsages = useOutboundAIUsages(accountId, open ? aiIntegrations.map((i) => i.id) : []);
  const [editing, setEditing] = useState<string | null>(null);
  if (!on || !personal) return null;
  if (list.error)
    return (
      <div id="integrations" className="scroll-mt-24">
        <Panel title="Integrations and AI">
          <InlinePhase
            phase={queryPhase({ error: list.error })}
            error={list.error}
            onRetry={() => void list.refetch()}
          />
        </Panel>
      </div>
    );
  if (integrations.length === 0) return null;
  const reads = integrations.map((integration, index) => {
    const ai = aiIntegrations.indexOf(integration);
    const usage = usages[index];
    const aiUsage = ai >= 0 ? aiUsages[ai] : undefined;
    return {
      rows: integrationLimitRows(integration, usage?.data, aiUsage?.data),
      failed: Boolean(usage?.error || aiUsage?.error),
    };
  });
  const rows = reads.map((read) => read.rows);
  return (
    <div id="integrations" className="scroll-mt-24">
      <Panel
        title="Integrations and AI"
        help="Limits on calls your apps make through Gregale’s gateway. At a limit the gateway refuses the call with 429; nothing else stops. Each app’s own limits are on its Integrations tab."
      >
        <details onToggle={(event) => setOpen(event.currentTarget.open)}>
          <summary className="w-fit cursor-pointer text-sm text-muted-foreground underline-offset-4 hover:underline">
            {integrationsSummary(rows)}
          </summary>
          <div className="mt-3 flex flex-col gap-5">
            {integrations.map((integration, index) => (
              <section key={integration.id} aria-label={integration.name} className="flex flex-col">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">{integration.name}</h3>
                  {aiOn && integration.ai_provider && editing !== integration.id && (
                    <Button size="xs" variant="ghost" onClick={() => setEditing(integration.id)}>
                      Per-tag limits
                    </Button>
                  )}
                </div>
                {rows[index].map((row) => (
                  <LimitRow
                    key={row.key}
                    name={row.name}
                    sentence={row.sentence}
                    meter={row.meter}
                    tone={reads[index].failed && !row.meter ? 'neutral' : undefined}
                    note={
                      reads[index].failed && !row.meter ? 'Couldn’t read today’s use.' : undefined
                    }
                    action={
                      row.key === 'requests' ? (
                        <Button asChild size="xs" variant="outline">
                          <Link to="/dashboard/integrations">Change</Link>
                        </Button>
                      ) : undefined
                    }
                  />
                ))}
                {editing === integration.id && (
                  <TagLimitsEditor
                    accountId={accountId}
                    integration={integration}
                    onClose={() => setEditing(null)}
                  />
                )}
              </section>
            ))}
          </div>
        </details>
      </Panel>
    </div>
  );
}
