import { useState } from 'react';
import { Plus, Refresh, Trash } from 'iconoir-react';
import { useMfa } from '@/components/auth/mfa-provider';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import { FIELD, Select } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { OneTimeSecret, useOneTimeSecret } from '@/components/ui/one-time-secret';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useCreateDeployToken,
  useDeployTokens,
  useRevokeDeployToken,
  useRotateDeployToken,
  type DeployToken,
} from '@/lib/api/deploy-tokens';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill } from './resource-table';

/** Days on offer. 90 is the server default and is sent as "no expiry". */
const EXPIRY_DAYS = ['30', '90', '180', '365'] as const;
const DEFAULT_DAYS = '90';
const DAY_MS = 86_400_000;

type StepUpCode = 'step_up_required' | 'mfa_required';
type Shown = { value: string; title: string };

function when(value: string | undefined): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toLocaleDateString();
}

/** The server keeps `status` at `active` after expiry; the clock decides. */
function stateOf(token: DeployToken): 'active' | 'expired' | 'revoked' | 'grace' {
  if (token.status === 'revoked') return 'revoked';
  if (token.expires_at && Date.parse(token.expires_at) <= Date.now()) return 'expired';
  return token.status === 'grace' ? 'grace' : 'active';
}

const STATE_LABEL = { active: 'Active', grace: 'Grace', expired: 'Expired', revoked: 'Revoked' };
const STATE_COLOR: Record<string, string | undefined> = {
  active: 'var(--status-good)',
  grace: 'var(--status-warning)',
  expired: 'var(--status-critical)',
};

function nameOf(token: DeployToken): string {
  return token.label || `token ${token.id.slice(0, 8)}`;
}

/** Turns a refusal into the sentence the toast leads with. */
function refusal(err: unknown): string {
  if (err instanceof ApiError && err.code === 'api_key_expired')
    return 'This token has already expired; create a new one instead.';
  return errorMessage(err);
}

/**
 * CI credentials that can deploy this app and nothing else.
 *
 * apid mints them with `deploy:write` only and accepts them only on this app's
 * routes. Creating and rotating sit behind an MFA step-up from the last five
 * minutes (`requireStepUp(5*time.Minute)`); revoking does not. Rotation has no
 * grace window: the predecessor is revoked in the same transaction.
 */
export function DeployTokensPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { openMfa } = useMfa();
  const tokens = useDeployTokens(slug);
  const create = useCreateDeployToken(slug);
  const rotate = useRotateDeployToken(slug);
  const revoke = useRevokeDeployToken(slug);
  const evidence = useOneTimeSecret<Shown>();
  const [label, setLabel] = useState('');
  const [days, setDays] = useState<string>(DEFAULT_DAYS);
  const [stepUpMissed, setStepUpMissed] = useState<StepUpCode | null>(null);

  const list = tokens.data?.tokens ?? [];
  const phase = queryPhase({
    error: tokens.error,
    loading: tokens.isPending,
    isEmpty: list.length === 0,
  });
  const command = `gregale deploy --name ${slug}`;

  const stepUp = (code: StepUpCode) =>
    new Promise<boolean>((resolve) => {
      // Enrolment also stamps the session, so both codes resolve the same way.
      openMfa(code === 'mfa_required' ? 'choose' : 'verify', {
        onVerified: () => resolve(true),
        onDismissed: () => resolve(false),
      });
    });

  /**
   * Runs a minting call, asking for a step-up once when the API wants one.
   * Resolves to null when the person closed the MFA prompt instead.
   */
  const minting = async <T,>(op: () => Promise<T>): Promise<T | null> => {
    setStepUpMissed(null);
    try {
      return await op();
    } catch (err) {
      if (
        err instanceof ApiError &&
        (err.code === 'step_up_required' || err.code === 'mfa_required')
      ) {
        const code = err.code;
        if (await stepUp(code)) return op();
        setStepUpMissed(code);
        return null;
      }
      throw err;
    }
  };

  const submit = () => {
    if (create.isPending || rotate.isPending) return;
    const trimmed = label.trim();
    const body: { label?: string; expires_at?: string } = {};
    if (trimmed) body.label = trimmed;
    if (days !== DEFAULT_DAYS) {
      // A year is the ceiling; stay a few minutes inside it so a fast client
      // clock is not refused as "more than 365 days in the future".
      const margin = days === '365' ? 5 * 60_000 : 0;
      body.expires_at = new Date(Date.now() + Number(days) * DAY_MS - margin).toISOString();
    }
    const receive = evidence.capture();
    void minting(() => create.mutateAsync(body))
      .then((token) => {
        if (!token?.plaintext) return;
        if (receive({ value: token.plaintext, title: 'New deploy token' })) {
          setLabel('');
          setDays(DEFAULT_DAYS);
        }
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not create token', description: refusal(err) })
      )
      .finally(() => create.reset());
  };

  const rotateToken = async (token: DeployToken, origin: HTMLElement) => {
    if (
      !(await confirm({
        title: `Rotate ${nameOf(token)}?`,
        description:
          'A replacement is minted and shown once. The old token stops working immediately, so CI fails until FAAS_TOKEN holds the new one. The replacement keeps the label and expires in 90 days.',
        confirmLabel: 'Rotate token',
      }))
    )
      return;
    const receive = evidence.capture(() => origin.focus());
    void minting(() => rotate.mutateAsync(token.id))
      .then((result) => {
        if (!result) return;
        receive({ value: result.token_plaintext, title: 'Deploy token rotated' });
        toast({
          kind: 'success',
          title: 'Token rotated',
          description: 'The old token is revoked.',
        });
      })
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not rotate token', description: refusal(err) })
      )
      .finally(() => rotate.reset());
  };

  const revokeToken = async (token: DeployToken) => {
    if (
      !(await confirm({
        title: `Revoke ${nameOf(token)}?`,
        description:
          'Any CI job using it fails on its next deploy. A revoked token cannot be restored; create a new one instead.',
        confirmLabel: 'Revoke token',
        destructive: true,
      }))
    )
      return;
    void revoke
      .mutateAsync(token.id)
      .then(() => toast({ kind: 'success', title: 'Token revoked' }))
      .catch((err: unknown) =>
        toast({ kind: 'error', title: 'Could not revoke token', description: refusal(err) })
      );
  };

  return (
    <Panel
      title="Deploy tokens"
      description="Credentials for CI that can deploy this app and nothing else. Creating or rotating one asks for an authenticator code from the last 5 minutes."
    >
      <div className="flex flex-col gap-5">
        {stepUpMissed && (
          <p role="alert" className="text-sm text-[color:var(--status-critical)]">
            {stepUpMissed === 'mfa_required'
              ? 'Set up two-factor authentication to create or rotate a deploy token, then try again.'
              : 'Verify with your authenticator to create or rotate a deploy token: the API asks for a code from the last 5 minutes. No authenticator yet? Set one up under Settings, then try again.'}
          </p>
        )}

        {evidence.secret && (
          <OneTimeSecret
            key={evidence.version}
            value={evidence.secret.value}
            title={evidence.secret.title}
            description="You won't see it again. Store it as FAAS_TOKEN in your CI secret store."
            onDismiss={evidence.dismiss}
          />
        )}

        <form
          noValidate
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Label</span>
            <input
              value={label}
              maxLength={100}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="github-actions"
              spellCheck={false}
              className={FIELD}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Expires in</span>
            <Select value={days} onChange={(e) => setDays(e.target.value)}>
              {EXPIRY_DAYS.map((d) => (
                <option key={d} value={d}>
                  {d === '365' ? '1 year' : `${d} days`}
                </option>
              ))}
            </Select>
          </label>
          <Button
            type="submit"
            size="sm"
            className="gap-1.5"
            busy={create.isPending}
            disabled={rotate.isPending}
          >
            <Plus className="h-3.5 w-3.5" />
            Create token
          </Button>
        </form>

        {phase !== 'ready' ? (
          <InlinePhase
            phase={phase}
            error={tokens.error}
            loadingMessage="Reading deploy tokens…"
            emptyMessage="No deploy tokens yet."
            onRetry={() => void tokens.refetch()}
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border border-t border-border">
            {list.map((token) => {
              const state = stateOf(token);
              const name = nameOf(token);
              const lastUsed = when(token.last_used_at);
              const meta = [
                `Created ${when(token.created_at) ?? '—'}`,
                lastUsed ? `Last used ${lastUsed}` : 'Never used',
                state === 'revoked'
                  ? `Revoked ${when(token.revoked_at) ?? ''}`.trim()
                  : `${state === 'expired' ? 'Expired' : 'Expires'} ${when(token.expires_at) ?? '—'}`,
              ];
              return (
                <li
                  key={token.id}
                  aria-label={name}
                  className={`flex flex-wrap items-center gap-x-3 gap-y-1 py-3 ${
                    state === 'revoked' ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium">{name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {token.prefix}…
                      </span>
                      <Pill label={STATE_LABEL[state]} color={STATE_COLOR[state]} />
                    </span>
                    <span className="text-xs text-muted-foreground">{meta.join(' · ')}</span>
                  </div>
                  {state !== 'revoked' && (
                    <span className="flex items-center gap-1">
                      {state !== 'expired' && (
                        <IconButton
                          aria-label={`Rotate ${name}`}
                          // One reveal serves both: never mint two secrets at once.
                          disabled={rotate.isPending || create.isPending}
                          onClick={(event) => void rotateToken(token, event.currentTarget)}
                          className="text-muted-foreground transition-colors hover:text-foreground"
                        >
                          <Refresh className="h-3.5 w-3.5" />
                        </IconButton>
                      )}
                      <IconButton
                        aria-label={`Revoke ${name}`}
                        disabled={revoke.isPending}
                        onClick={() => void revokeToken(token)}
                        className="text-muted-foreground transition-colors hover:text-foreground"
                      >
                        <Trash className="h-3.5 w-3.5" />
                      </IconButton>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}

        <div className="flex flex-col gap-2 rounded-lg border border-border p-4">
          <p className="text-sm font-medium">Use it in CI</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Store the token as <code className="font-mono">FAAS_TOKEN</code> in the CI secret store;
            the CLI reads it from the environment before any saved login. It can deploy only{' '}
            <span className="font-mono">{slug}</span>.
          </p>
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-1.5">
            <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap font-mono text-xs">
              {command}
            </code>
            <CopyIconButton text={command} label={command} />
          </div>
        </div>
      </div>
    </Panel>
  );
}
