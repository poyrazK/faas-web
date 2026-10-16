import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Select, Textarea } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  AI_PROVIDERS,
  HTTP_METHODS,
  useCreateOutboundIntegration,
  type AIProvider,
  type CreateOutboundIntegration,
  type HttpMethod,
  type OutboundIntegration,
} from '@/lib/api/outbound';
import { AI_PROVIDER_LABELS } from './outbound-format';

const NAME_RULE = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

function createError(error: unknown) {
  if (error instanceof ApiError) {
    if (error.code === 'conflict') return 'An integration with this name already exists.';
    if (error.code === 'outbound_integration_limit')
      return 'Your account has reached its integration limit. Delete one you no longer use first.';
    if (error.code === 'plan_feature_gated')
      return 'Your plan does not include the AI gateway. Create it without an AI provider, or upgrade.';
  }
  return errorMessage(error);
}

/**
 * A new customer-owned integration: a fixed public HTTPS origin and the
 * methods and path prefixes apps may call on it. The provider credential is
 * a separate write, so a successful create hands straight over to it.
 */
export function CreateIntegrationDialog({
  open,
  accountId,
  aiAvailable,
  onClose,
  onCreated,
}: {
  open: boolean;
  accountId: string;
  aiAvailable: boolean;
  onClose: () => void;
  onCreated: (created: OutboundIntegration) => void;
}) {
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New integration"
      description="A fixed HTTPS destination your apps call through the outbound gateway. You add the provider credential next."
      width="max-w-xl"
    >
      {open && (
        <CreateBody
          accountId={accountId}
          aiAvailable={aiAvailable}
          onClose={onClose}
          onCreated={onCreated}
        />
      )}
    </Modal>
  );
}

function CreateBody({
  accountId,
  aiAvailable,
  onClose,
  onCreated,
}: {
  accountId: string;
  aiAvailable: boolean;
  onClose: () => void;
  onCreated: (created: OutboundIntegration) => void;
}) {
  const [name, setName] = useState('');
  const [origin, setOrigin] = useState('https://');
  const [methods, setMethods] = useState<HttpMethod[]>(['GET']);
  const [prefixes, setPrefixes] = useState('/');
  const [limit, setLimit] = useState('');
  const [provider, setProvider] = useState<AIProvider | ''>('');
  const [tokenLimit, setTokenLimit] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const create = useCreateOutboundIntegration(accountId);
  const { toast } = useToast();

  const prefixList = [
    ...new Set(
      prefixes
        .split('\n')
        .map((p) => p.trim())
        .filter(Boolean)
    ),
  ];
  const errors = {
    name: NAME_RULE.test(name)
      ? undefined
      : 'Lowercase letters, digits, and hyphens; up to 63 characters.',
    origin: /^https:\/\/[^/\s]+$/.test(origin.trim())
      ? undefined
      : 'An https:// origin with no path, such as https://api.example.com.',
    methods: methods.length ? undefined : 'Allow at least one method.',
    prefixes:
      prefixList.length === 0
        ? 'Add at least one path prefix.'
        : prefixList.length > 32
          ? 'At most 32 prefixes.'
          : prefixList.some((p) => !p.startsWith('/'))
            ? 'Each prefix starts with /.'
            : undefined,
    limit:
      limit.trim() === '' ||
      (Number.isInteger(Number(limit)) && Number(limit) >= 1 && Number(limit) <= 100_000_000)
        ? undefined
        : 'A whole number from 1 to 100,000,000, or empty.',
    tokenLimit:
      tokenLimit.trim() === '' || (Number.isInteger(Number(tokenLimit)) && Number(tokenLimit) >= 1)
        ? undefined
        : 'A whole number of tokens, or empty.',
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    setFailure(null);
    if (Object.values(errors).some(Boolean)) return;
    const body: CreateOutboundIntegration = {
      name,
      origin: origin.trim(),
      allowed_methods: methods,
      allowed_path_prefixes: prefixList,
      ...(limit.trim() ? { daily_request_limit: Number(limit) } : {}),
      ...(provider
        ? {
            ai_provider: provider,
            ...(tokenLimit.trim() ? { ai_daily_token_limit: Number(tokenLimit) } : {}),
          }
        : {}),
    };
    try {
      const created = await create.mutateAsync(body);
      toast({ kind: 'success', title: `Created ${created.name}` });
      onCreated(created);
    } catch (error) {
      setFailure(createError(error));
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-4" noValidate>
      <div className="grid gap-3 sm:grid-cols-2">
        <FormField id="integration-name" label="Name" error={errors.name} showError={attempted}>
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(e) => setName(e.target.value)}
              spellCheck={false}
              autoComplete="off"
              placeholder="payments-api"
            />
          )}
        </FormField>
        <FormField
          id="integration-origin"
          label="Origin"
          error={errors.origin}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              value={origin}
              onChange={(e) => setOrigin(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          )}
        </FormField>
      </div>
      <fieldset className="flex flex-col gap-2">
        <legend className="text-sm font-medium">Allowed methods</legend>
        <div className="flex flex-wrap gap-3">
          {HTTP_METHODS.map((m) => (
            <label key={m} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={methods.includes(m)}
                onChange={(e) =>
                  setMethods(e.target.checked ? [...methods, m] : methods.filter((x) => x !== m))
                }
              />
              {m}
            </label>
          ))}
        </div>
        {attempted && errors.methods && (
          <p role="alert" className="text-[13px] text-destructive">
            {errors.methods}
          </p>
        )}
      </fieldset>
      <FormField
        id="integration-prefixes"
        label="Allowed path prefixes"
        hint="One per line. Apps can only call paths under these."
        error={errors.prefixes}
        showError={attempted}
      >
        {(props) => (
          <Textarea
            {...props}
            value={prefixes}
            onChange={(e) => setPrefixes(e.target.value)}
            rows={3}
            spellCheck={false}
            className="font-mono text-xs"
          />
        )}
      </FormField>
      <FormField
        id="integration-limit"
        label="Daily request limit (optional)"
        hint="Your plan's per-integration ceiling still applies."
        error={errors.limit}
        showError={attempted}
      >
        {(props) => (
          <Input
            {...props}
            inputMode="numeric"
            value={limit}
            onChange={(e) => setLimit(e.target.value)}
            className="max-w-48"
          />
        )}
      </FormField>
      {aiAvailable && (
        <div className="grid gap-3 sm:grid-cols-2">
          <FormField
            id="integration-ai"
            label="AI provider (optional)"
            hint="Turns on token accounting for this provider's responses."
          >
            {(props) => (
              <Select
                {...props}
                value={provider}
                onChange={(e) => setProvider(e.target.value as AIProvider | '')}
              >
                <option value="">None</option>
                {AI_PROVIDERS.map((p) => (
                  <option key={p} value={p}>
                    {AI_PROVIDER_LABELS[p]}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {provider && (
            <FormField
              id="integration-ai-tokens"
              label="Daily token limit (optional)"
              error={errors.tokenLimit}
              showError={attempted}
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  value={tokenLimit}
                  onChange={(e) => setTokenLimit(e.target.value)}
                />
              )}
            </FormField>
          )}
        </div>
      )}
      {failure && (
        <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
          {failure}
        </p>
      )}
      <div className="flex justify-end gap-2 border-t border-border pt-4">
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" size="sm" disabled={create.isPending}>
          Create integration
        </Button>
      </div>
    </form>
  );
}
