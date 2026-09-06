import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Pill } from '@/components/dashboard/resource-table';
import { InlinePhase, queryPhase } from '@/components/dashboard/primitives';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAlertPresets, useEnableAlertPreset, useTestAlertPreset } from '@/lib/api/queries';

/**
 * The seeded alert-preset catalog: the rules worth having, already written.
 *
 * Enabling one is a real rule creation, so it needs the same webhook and secret
 * the hand-rolled form asks for — the preset supplies the metric, threshold and
 * window, not the destination.
 *
 * Nothing here tries to show whether a preset is already enabled: a rule
 * carries no back-reference to the preset that made it, so any such badge would
 * be a guess. The test action asks the server instead, and a 404 is the honest
 * answer that it was never enabled here.
 */

const COMPARISON: Record<string, string> = { gt: '>', gte: '≥', lt: '<', lte: '≤' };

const CATEGORY_COLOR: Record<string, string> = {
  availability: 'var(--status-critical)',
  reliability: 'var(--status-serious)',
  cost: 'var(--status-warning)',
  deployment: 'var(--status-good)',
  infrastructure: 'var(--status-idle)',
};

function EnableForm({
  slug,
  name,
  minimumPlan,
  onDone,
}: {
  slug: string;
  name: string;
  minimumPlan: string;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const enable = useEnableAlertPreset();
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const ready = /^https:\/\//.test(url.trim()) && secret.trim().length > 0;

  return (
    <div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-border p-3">
      <label className="flex min-w-56 flex-1 flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Webhook URL</span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://hooks.example.com/alerts"
          className="h-9 rounded-md border border-border bg-background px-2 text-sm outline-none focus:border-brand/50"
        />
      </label>
      <label className="flex min-w-40 flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Secret</span>
        <input
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          type="password"
          className="h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
        />
      </label>
      <Button
        size="sm"
        disabled={!ready}
        busy={enable.isPending}
        onClick={() => {
          void enable
            .mutateAsync({
              slug,
              name,
              body: { webhook_url: url.trim(), webhook_secret: secret, enabled: true },
            })
            .then(() => {
              toast({ kind: 'success', title: 'Preset enabled' });
              onDone();
            })
            .catch((err: unknown) => {
              if (err instanceof ApiError && err.status === 402) {
                // The catalog already says which plan this preset needs, so
                // name it rather than leaving the customer to go and look.
                toast({
                  kind: 'error',
                  title: 'Not on your plan',
                  description: `This preset needs the ${minimumPlan} plan or higher.`,
                });
                return;
              }
              toast({ kind: 'error', title: 'Could not enable', description: errorMessage(err) });
            });
        }}
      >
        Enable preset
      </Button>
    </div>
  );
}

export function AlertPresets({ slug }: { slug: string }) {
  const { toast } = useToast();
  const { data, isPending, error } = useAlertPresets();
  const test = useTestAlertPreset();
  const [enabling, setEnabling] = useState<string | null>(null);

  const phase = queryPhase({ error, loading: isPending, isEmpty: (data ?? []).length === 0 });
  if (phase !== 'ready') {
    return (
      <InlinePhase
        phase={phase}
        error={error}
        loadingMessage="Reading the catalog…"
        emptyMessage="No presets are published."
      />
    );
  }

  const onTest = (name: string) => {
    void test
      .mutateAsync({ slug, name })
      .then(() => toast({ kind: 'success', title: 'Test alert sent' }))
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.isNotFound) {
          toast({
            kind: 'info',
            title: 'Nothing to test yet',
            description: 'Enable this preset on the app first.',
          });
          return;
        }
        if (err instanceof ApiError && err.status === 502) {
          toast({
            kind: 'error',
            title: 'The webhook refused it',
            description: err.detail ?? 'The rule exists, but its endpoint did not accept the test.',
          });
          return;
        }
        toast({ kind: 'error', title: 'Could not send test', description: errorMessage(err) });
      });
  };

  return (
    <ul className="flex flex-col divide-y divide-border">
      {(data ?? []).map((p) => (
        <li key={p.id} className="py-4 first:pt-0 last:pb-0">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium">{p.display_name}</span>
                <Pill label={p.category} color={CATEGORY_COLOR[p.category]} />
                {p.minimum_plan !== 'free' && (
                  <span className="label-mono text-muted-foreground">{p.minimum_plan}+</span>
                )}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
              <p className="mt-1 font-mono text-xs text-muted-foreground">
                {`${p.metric} ${COMPARISON[p.comparison] ?? p.comparison} ${p.threshold} over ${p.window_spec}`}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Button
                size="xs"
                variant="outline"
                onClick={() => setEnabling((cur) => (cur === p.name ? null : p.name))}
              >
                Enable
              </Button>
              <Button size="xs" variant="secondary" onClick={() => onTest(p.name)}>
                Send test
              </Button>
            </div>
          </div>

          {enabling === p.name && (
            <EnableForm
              slug={slug}
              name={p.name}
              minimumPlan={p.minimum_plan}
              onDone={() => setEnabling(null)}
            />
          )}
        </li>
      ))}
    </ul>
  );
}
