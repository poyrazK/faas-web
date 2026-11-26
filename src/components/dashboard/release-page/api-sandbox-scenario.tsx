import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { CopyableId } from '@/components/ui/copyable-id';
import { useCopy } from '@/components/ui/copy-button';
import { Input } from '@/components/ui/input';
import { FIELD } from '@/components/ui/field';
import { cn } from '@/lib/utils';
import {
  type APISandboxScenario,
  type APISandboxScenarioDraft,
  type APISandboxScenarioInput,
  type APISandboxScenarioResponse,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';

const notesExample: APISandboxScenarioInput = {
  name: 'Create a note',
  seed: { notes: [{ id: 42, body: 'A note for integration testing' }] },
  seeded_ids: { 'Sample note': '42' },
  requests: [
    {
      title: 'Find the sample note',
      method: 'GET',
      path: '/notes',
      expected_status: 200,
      assertions: [{ pointer: '/notes/0/id', equals: 42 }],
    },
    {
      title: 'Create another note',
      method: 'POST',
      path: '/notes',
      body: { body: 'My integration test' },
      expected_status: 201,
    },
  ],
};

const stripeWebhookExample: APISandboxScenarioInput = {
  name: 'Apply a paid Stripe invoice once',
  seed: { subscriptions: [{ id: 'sub_demo', status: 'pending' }] },
  stripe_webhook: {
    delivery_path: '/internal/stripe',
    event_type: 'invoice.paid',
    data_object: { id: 'in_demo', object: 'invoice', subscription: 'sub_demo', paid: true },
  },
  requests: [
    {
      title: 'Check subscription and entitlements',
      method: 'GET',
      path: '/subscriptions/sub_demo',
      expected_status: 200,
      assertions: [
        { pointer: '/status', equals: 'active' },
        { pointer: '/entitlement_count', equals: 1 },
      ],
    },
  ],
};

const outboundWebhookExample: APISandboxScenarioInput = {
  name: 'Retry the export completion webhook',
  seed: {},
  requests: [
    {
      title: 'Start a test export',
      method: 'POST',
      path: '/exports',
      body: { export_id: 'export_demo' },
      expected_status: 202,
    },
  ],
  outbound_webhook: {
    retry_once: true,
    assertions: [{ pointer: '/export_id', equals: 'export_demo' }],
  },
};

function scenarioDraft(scenario?: APISandboxScenarioInput, revision = '') {
  return {
    revision,
    name: scenario?.name ?? '',
    definition: JSON.stringify(
      {
        seed: scenario?.seed ?? {},
        seeded_ids: scenario?.seeded_ids ?? {},
        requests: scenario?.requests ?? [],
        stripe_webhook: scenario?.stripe_webhook,
        outbound_webhook: scenario?.outbound_webhook,
      },
      null,
      2
    ),
  };
}

export function SandboxScenarioEditor({
  scenario,
  sourceRequestId,
  fromRequest,
  library = false,
  startEditing = false,
  saveScenario,
  onSave,
  onCancel,
}: {
  scenario: APISandboxScenario | null;
  sourceRequestId?: string;
  fromRequest?: APISandboxScenarioDraft;
  library?: boolean;
  startEditing?: boolean;
  saveScenario: (
    input: APISandboxScenarioInput,
    revision: string
  ) => Promise<APISandboxScenarioResponse>;
  onSave: (response: APISandboxScenarioResponse) => void;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState(() =>
    fromRequest
      ? scenarioDraft({
          name: 'Request regression',
          seed: {},
          requests: [
            {
              title: 'Check the expected response',
              method: fromRequest.method,
              path: fromRequest.route_template ?? '',
              expected_status: 0,
            },
          ],
        })
      : startEditing
        ? scenarioDraft(scenario ?? undefined, scenario?.revision)
        : undefined
  );
  const [invalidJSON, setInvalidJSON] = useState(false);
  const clipboard = useCopy();
  const [copyError, setCopyError] = useState(false);
  const save = useMutation({
    mutationFn: ({ input, revision }: { input: APISandboxScenarioInput; revision: string }) =>
      saveScenario(input, revision),
    onSuccess: (data) => {
      if (data.scenario) onSave(data);
      setDraft(undefined);
    },
  });
  const edit = (value?: APISandboxScenarioInput) => {
    save.reset();
    setInvalidJSON(false);
    setDraft(scenarioDraft(value, scenario?.revision));
  };

  return (
    <section className="grid max-w-lg gap-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            {fromRequest
              ? 'Sandbox scenario draft'
              : library
                ? 'Library scenario'
                : 'Sandbox scenario'}
          </h3>
          <p className="text-sm text-muted-foreground">
            {fromRequest
              ? 'Add synthetic fixtures, a concrete path, and the expected response.'
              : (scenario?.name ??
                (library
                  ? 'Save a reusable scenario for this app.'
                  : 'Save synthetic fixtures and example requests for this release.'))}
          </p>
          {sourceRequestId ? (
            <p className="flex items-center gap-1 text-xs text-muted-foreground">
              Source request <CopyableId value={sourceRequestId} label="source request ID" />
            </p>
          ) : null}
        </div>
        {!draft ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => edit(scenario ?? undefined)}
          >
            {scenario ? 'Edit scenario' : 'Define scenario'}
          </Button>
        ) : null}
      </div>
      {!draft && scenario && !fromRequest ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={async () =>
              setCopyError(!(await clipboard.copy(scenarioDraft(scenario).definition)))
            }
          >
            {clipboard.copied ? 'Scenario JSON copied' : 'Copy scenario JSON'}
          </Button>
          {copyError ? (
            <p role="alert" className="text-xs text-destructive">
              Could not copy scenario JSON.
            </p>
          ) : null}
        </div>
      ) : null}
      {draft ? (
        <form
          className="grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (save.isPending) return;
            try {
              const parsed: unknown = JSON.parse(draft.definition);
              if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                setInvalidJSON(true);
                return;
              }
              setInvalidJSON(false);
              const input = parsed as APISandboxScenarioInput;
              save.mutate({
                revision: draft.revision,
                input: {
                  name: draft.name.trim(),
                  seed: input.seed,
                  seeded_ids: input.seeded_ids,
                  requests: input.requests,
                  stripe_webhook: input.stripe_webhook,
                  outbound_webhook: input.outbound_webhook,
                },
              });
            } catch {
              setInvalidJSON(true);
            }
          }}
        >
          <label className="grid gap-1.5 text-sm">
            Scenario name
            <Input
              value={draft.name}
              required
              maxLength={100}
              disabled={save.isPending}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
            />
          </label>
          {fromRequest ? (
            <p className="text-xs text-muted-foreground">
              {fromRequest.route_template
                ? 'Replace any route placeholders with synthetic values.'
                : 'Enter a path for your synthetic request.'}{' '}
              Set <code>expected_status</code> to the HTTP status you want to verify.
            </p>
          ) : null}
          <label className="grid gap-1.5 text-sm">
            Scenario JSON
            <textarea
              value={draft.definition}
              spellCheck={false}
              rows={11}
              maxLength={24576}
              disabled={save.isPending}
              className={cn(FIELD, 'min-h-48 w-full py-2 font-mono text-xs')}
              onChange={(event) => setDraft({ ...draft, definition: event.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            The release command reads <code>GREGALE_API_SANDBOX_SEED</code>. Invitees see{' '}
            <code>seeded_ids</code> and <code>requests</code>. Add JSON checks to a request with
            <code> assertions</code> using a JSON Pointer and an expected scalar. Use synthetic data
            throughout.
          </p>
          <p className="text-xs text-muted-foreground">
            To test a Stripe webhook, add <code>stripe_webhook</code> and one GET with JSON
            assertions. Set <code>delivery_path</code> to your app’s Gregale inbound webhook
            handler.
          </p>
          <p className="text-xs text-muted-foreground">
            To check an async job’s callback, add <code>outbound_webhook</code> and one POST job
            with expected HTTP 202. Put assertions for the returned job result under{' '}
            <code>outbound_webhook</code>.
          </p>
          {invalidJSON || save.error ? (
            <p role="alert" className="text-sm text-destructive">
              {invalidJSON ? 'Enter a valid JSON object.' : errorMessage(save.error)}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" busy={save.isPending}>
              {library && !scenario ? 'Save to library' : 'Save scenario'}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={save.isPending}
              onClick={onCancel ?? (() => setDraft(undefined))}
            >
              Cancel
            </Button>
            {!scenario && !fromRequest ? (
              <>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => edit(notesExample)}
                >
                  Load Notes example
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => edit(stripeWebhookExample)}
                >
                  Load Stripe example
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => edit(outboundWebhookExample)}
                >
                  Load outbound webhook example
                </Button>
              </>
            ) : null}
          </div>
        </form>
      ) : null}
    </section>
  );
}
