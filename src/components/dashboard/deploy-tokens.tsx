import { useEffect, useRef, useState } from 'react';
import { MoreHoriz, Plus } from 'iconoir-react';
import { useMfa } from '@/components/auth/mfa-provider';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { CopyIconButton } from '@/components/ui/copy-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { FIELD, Select } from '@/components/ui/field';
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
import { HelpTip } from './kit/help-tip';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill } from './resource-table';
import { Disclosure } from './settings-kit';
import {
  TOKEN_STATE,
  tokenDetail,
  tokenLine,
  tokenName,
  tokensLine,
  tokenState,
} from './source-access-words';

/** Days on offer. 90 is the server default and is sent as "no expiry". */
const EXPIRY_DAYS = ['30', '90', '180', '365'] as const;
const DEFAULT_DAYS = '90';
const DAY_MS = 86_400_000;

type StepUpCode = 'step_up_required' | 'mfa_required';
type Shown = { value: string; title: string };

/** A minute clock, so a token's expiry and "last used today" move on screen. */
function useMinuteClock() {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
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
  const [creating, setCreating] = useState(false);
  const createButton = useRef<HTMLButtonElement>(null);

  const list = tokens.data?.tokens ?? [];
  const now = useMinuteClock();
  const current = list.filter((token) => token.status !== 'revoked');
  const revoked = list.filter((token) => token.status === 'revoked');
  const line = tokensLine(list, slug, now);
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
    // The form closes on success, so dismissing the reveal returns focus to
    // the button that opened it.
    const receive = evidence.capture(() => createButton.current?.focus());
    void minting(() => create.mutateAsync(body))
      .then((token) => {
        if (!token?.plaintext) return;
        if (receive({ value: token.plaintext, title: 'New deploy token' })) {
          setLabel('');
          setDays(DEFAULT_DAYS);
          setCreating(false);
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
        title: `Rotate ${tokenName(token)}?`,
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
        title: `Revoke ${tokenName(token)}?`,
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

  const row = (token: DeployToken) => (
    <TokenRow
      key={token.id}
      token={token}
      now={now}
      // One reveal serves both: never mint two secrets at once.
      rotateDisabled={rotate.isPending || create.isPending}
      revokeDisabled={revoke.isPending}
      onRotate={(origin) => void rotateToken(token, origin)}
      onRevoke={() => void revokeToken(token)}
    />
  );

  return (
    <Panel
      title="Deploy tokens"
      help="Can deploy this app and nothing else. Creating or rotating one needs an authenticator code from the last 5 minutes."
      actions={
        creating ? undefined : (
          <Button
            ref={createButton}
            size="sm"
            className="gap-1.5"
            disabled={rotate.isPending}
            onClick={() => setCreating(true)}
          >
            <Plus className="h-3.5 w-3.5" />
            Create token
          </Button>
        )
      }
    >
      <div className="flex flex-col gap-4">
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

        {creating && (
          <form
            noValidate
            aria-label="Create a deploy token"
            className="well flex flex-wrap items-end gap-3 rounded-xl bg-muted/40 p-4"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <label className="flex min-w-48 flex-1 flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Label</span>
              <input
                value={label}
                maxLength={100}
                autoFocus
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
            <div className="flex items-center gap-2">
              <Button type="submit" size="sm" busy={create.isPending} disabled={rotate.isPending}>
                Create token
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                disabled={create.isPending}
                onClick={() => {
                  setCreating(false);
                  setStepUpMissed(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        )}

        {phase === 'ready' || phase === 'empty' ? (
          <p className="text-base text-foreground/90">{line.sentence}</p>
        ) : (
          <InlinePhase
            phase={phase}
            error={tokens.error}
            loadingMessage="Reading deploy tokens…"
            onRetry={() => void tokens.refetch()}
          />
        )}

        {phase === 'ready' && (
          <>
            {current.length > 0 && (
              <ul
                aria-label="Deploy tokens"
                className="well flex flex-col divide-y divide-border rounded-xl bg-muted/40"
              >
                {current.map(row)}
              </ul>
            )}
            {revoked.length > 0 && (
              <Disclosure label={`Show ${revoked.length} revoked`} className="gap-3">
                <ul
                  aria-label="Revoked deploy tokens"
                  className="flex flex-col divide-y divide-border"
                >
                  {revoked.map(row)}
                </ul>
              </Disclosure>
            )}
          </>
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted-foreground">
            <span className="text-sm font-medium text-foreground">Use it in CI</span>
            <span>
              Store it as <code className="font-mono text-foreground">FAAS_TOKEN</code>, then run:
            </span>
            <HelpTip label="About using a deploy token in CI">
              The CLI reads FAAS_TOKEN from the environment before any saved login. The token can
              deploy only {slug}.
            </HelpTip>
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

/** One token: its name and state, one quiet line, and its actions behind ⋯. */
function TokenRow({
  token,
  now,
  rotateDisabled,
  revokeDisabled,
  onRotate,
  onRevoke,
}: {
  token: DeployToken;
  now: number;
  rotateDisabled: boolean;
  revokeDisabled: boolean;
  onRotate: (origin: HTMLElement) => void;
  onRevoke: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const state = tokenState(token, now);
  const shown = TOKEN_STATE[state];
  const name = tokenName(token);
  const line = tokenLine(token, now);
  return (
    <li
      aria-label={name}
      className={`flex items-center gap-3 px-3 py-2.5 ${state === 'revoked' ? 'text-muted-foreground' : ''}`}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="truncate text-sm font-medium">{name}</span>
          <span title={shown.term}>
            <Pill label={shown.label} color={shown.color} />
          </span>
        </span>
        <span
          title={tokenDetail(token)}
          className={`text-xs ${
            line.soon ? 'text-[color:var(--status-warning)]' : 'text-muted-foreground'
          }`}
        >
          {line.text}
        </span>
      </div>
      {state !== 'revoked' && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={trigger}
              variant="ghost"
              size="icon-sm"
              aria-label={`Actions for ${name}`}
              className="text-muted-foreground"
            >
              <MoreHoriz aria-hidden className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {state !== 'expired' && (
              <DropdownMenuItem
                disabled={rotateDisabled}
                onSelect={() => trigger.current && onRotate(trigger.current)}
              >
                Rotate token
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              disabled={revokeDisabled}
              onSelect={onRevoke}
              className="text-[color:var(--status-critical)] data-[highlighted]:text-[color:var(--status-critical)]"
            >
              Revoke token
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </li>
  );
}
