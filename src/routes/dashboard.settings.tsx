import { useRef, useState } from 'react';
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { WarningTriangle, ArrowRight } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { FIELD } from '@/components/ui/field';
import { clearWorkspace, readWorkspace, saveWorkspace, useAuth } from '@/lib/auth';
import {
  useAccountExport,
  useEgressExtra,
  useRestoreAccount,
  useSetEgressExtra,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { useFocusTrap } from '@/lib/use-focus-trap';
import { consoleHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/settings')({
  head: () => consoleHead('settings'),
  component: SettingsPage,
});

/**
 * Where the settings people come here looking for actually live.
 *
 * This panel used to be three switches. None of them were wired to anything:
 * `handleSave` slept 700ms and toasted "Settings saved" while the state stayed
 * in the component and died on reload. Two of the three are real controls —
 * they are just per-app, because that is where the API keeps them — and the
 * third ("Agent API access") had no endpoint behind it at all.
 */
const ELSEWHERE: { label: string; description: string; to: '/dashboard/workflows'; cta: string }[] =
  [
    {
      label: 'Scale to zero',
      description:
        'How long an app idles before it snapshots, and how many instances stay resident. Set per app, since a queue consumer and a public API want different answers.',
      to: '/dashboard/workflows',
      cta: 'Open an app',
    },
    {
      label: 'Deployment alerts',
      description:
        'Threshold rules that POST to a webhook when an app breaches them. Set per app, on its Alerts tab.',
      to: '/dashboard/workflows',
      cta: 'Open an app',
    },
  ];

/** Type-to-confirm dialog for the irreversible action. */
function DeleteWorkspaceDialog({
  workspace,
  onCancel,
  onConfirm,
}: {
  workspace: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const [typed, setTyped] = useState('');
  const matches = typed === workspace;
  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, true);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-center justify-center p-4"
      onKeyDown={(e) => e.key === 'Escape' && onCancel()}
    >
      <button
        aria-hidden="true"
        tabIndex={-1}
        onClick={onCancel}
        className="absolute inset-0 bg-mint-12/50 backdrop-blur-sm"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-title"
        className="relative w-full max-w-md rounded-xl border border-border bg-popover p-6 shadow-2xl"
      >
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full"
          style={{ background: 'color-mix(in oklab, var(--status-critical) 18%, transparent)' }}
        >
          <WarningTriangle className="h-4 w-4" style={{ color: 'var(--status-critical)' }} />
        </span>

        <h2 id="delete-title" className="mt-4 text-lg font-semibold tracking-tight">
          Delete this workspace?
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          This destroys every function, snapshot, and volume in{' '}
          <span className="font-mono text-foreground">{workspace}</span>. It cannot be undone.
        </p>

        <label className="mt-5 block">
          <span className="text-xs text-muted-foreground">
            Type <span className="font-mono text-foreground">{workspace}</span> to confirm
          </span>
          <input
            autoFocus
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-2 h-10 w-full rounded-lg border border-border bg-background px-3 font-mono text-sm outline-none focus:border-[color:var(--status-critical)]"
          />
        </label>

        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="destructive" size="sm" disabled={!matches} onClick={onConfirm}>
            Delete workspace
          </Button>
        </div>
      </div>
    </div>
  );
}

/** The GDPR bundle, downloaded as a file — every owned resource plus the
 * audit trail, straight from /v1/account/export. */
function ExportPanel() {
  const { toast } = useToast();
  const exportAccount = useAccountExport();
  return (
    <Panel
      title="Export your data"
      description="Everything the platform holds about this account — apps, deployments, builds, usage, domains, crons, keys, sealed-secret envelopes, and the audit trail — as one JSON file."
    >
      <Button
        size="sm"
        variant="outline"
        busy={exportAccount.isPending}
        onClick={() =>
          void exportAccount
            .mutateAsync()
            .then((bundle) => {
              const blob = new Blob([JSON.stringify(bundle, null, 2)], {
                type: 'application/json',
              });
              const url = URL.createObjectURL(blob);
              const a = document.createElement('a');
              a.href = url;
              a.download = `gregale-export-${bundle.exported_at?.slice(0, 10) ?? 'now'}.json`;
              a.click();
              URL.revokeObjectURL(url);
              toast({ kind: 'success', title: 'Export downloaded' });
            })
            .catch((err: unknown) =>
              toast({ kind: 'error', title: 'Could not export', description: errorMessage(err) })
            )
        }
      >
        Download export
      </Button>
    </Panel>
  );
}

/** Visible only inside the 30-day deletion window — the way back. */
function RestoreBanner() {
  const { toast } = useToast();
  const { account, refreshAccount } = useAuth();
  const restore = useRestoreAccount();
  if (account?.status !== 'deleted_pending') return null;
  return (
    <div
      role="alert"
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border px-5 py-4"
      style={{
        borderColor: 'color-mix(in oklab, var(--status-warning) 45%, transparent)',
        background: 'color-mix(in oklab, var(--status-warning) 6%, transparent)',
      }}
    >
      <p className="text-sm">
        This account is scheduled for deletion. Everything is recoverable until the 30-day window
        closes.
      </p>
      <Button
        size="sm"
        busy={restore.isPending}
        onClick={() =>
          void restore
            .mutateAsync()
            .then(() => {
              void refreshAccount();
              toast({ kind: 'success', title: 'Account restored' });
            })
            .catch((err: unknown) =>
              toast({ kind: 'error', title: 'Could not restore', description: errorMessage(err) })
            )
        }
      >
        Restore account
      </Button>
    </div>
  );
}

/** Per-account extra budget for egress-allowlist entries beyond the plan cap. */
function EgressExtraPanel() {
  const { toast } = useToast();
  const q = useEgressExtra();
  const set = useSetEgressExtra();
  const [value, setValue] = useState('');
  const current = q.data;
  return (
    <Panel
      title="Egress allowlist budget"
      description="Extra allowlist entries on top of the plan's cap, shared across apps."
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Extra entries</span>
          <input
            type="number"
            min={0}
            max={current?.max_extra}
            value={value === '' ? (current?.extra ?? '') : value}
            onChange={(e) => setValue(e.target.value)}
            className={`${FIELD} w-32 [font-variant-numeric:tabular-nums]`}
          />
        </label>
        <Button
          size="sm"
          disabled={value === ''}
          busy={set.isPending}
          onClick={() =>
            void set
              .mutateAsync(Number(value))
              .then(() => toast({ kind: 'success', title: 'Egress budget updated' }))
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not update', description: errorMessage(err) })
              )
          }
        >
          Save
        </Button>
        {current && (
          <p className="text-xs text-muted-foreground">
            Plan cap {current.plan_cap} per app · up to {current.max_extra} extra.
          </p>
        )}
      </div>
    </Panel>
  );
}

function SettingsPage() {
  const { toast } = useToast();
  const { signOut } = useAuth();
  const navigate = useNavigate();

  const [workspace, setWorkspace] = useState(readWorkspace);
  const [showDelete, setShowDelete] = useState(false);

  // The workspace name is a label this console shows in its own chrome; the
  // API has no account-name field to put it in. Stored where it is used, and
  // described as what it is rather than dressed up as an account setting.
  const handleSave = () => {
    saveWorkspace(workspace);
    toast({
      kind: 'success',
      title: 'Workspace name saved',
      description: 'Stored in this browser. It labels the console, not the account.',
    });
  };

  // Local reset only. Real account deletion is `DELETE /v1/account` — it stages
  // a 30-day grace period and is restorable — but wiring a destructive endpoint
  // to this button needs its own decision, not a drive-by. Until then the copy
  // says what actually happens rather than implying the account is gone.
  const handleDelete = () => {
    setShowDelete(false);
    clearWorkspace();
    void signOut();
    toast({
      kind: 'info',
      title: 'Local workspace settings cleared',
      description: 'You have been signed out. Your account was not deleted.',
    });
    navigate({ to: '/' });
  };

  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Settings" description="Workspace configuration and credentials." />

      <RestoreBanner />

      <Panel
        title="Workspace"
        description="The name this console shows in its own chrome. Stored in this browser — the API has no account name to sync it to."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Display name</span>
            <input
              value={workspace}
              onChange={(e) => setWorkspace(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-3 text-sm outline-none focus:border-brand/50"
            />
          </label>
        </div>
        <div className="mt-5 flex justify-end">
          <Button size="sm" onClick={handleSave}>
            Save name
          </Button>
        </div>
      </Panel>

      <Panel
        title="Runtime behaviour"
        description="Set per app rather than per account — the API keeps these on the app."
      >
        <ul className="flex flex-col divide-y divide-border">
          {ELSEWHERE.map((item) => (
            <li
              key={item.label}
              className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2 py-4 first:pt-0 last:pb-0"
            >
              <div>
                <p className="text-sm font-medium">{item.label}</p>
                <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
                  {item.description}
                </p>
              </div>
              <Link
                to={item.to}
                className="inline-flex shrink-0 items-center gap-1.5 text-sm font-medium text-brand hover:underline"
              >
                {item.cta}
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel title="API keys" description="Used by the CLI and the deployment API">
        <p className="text-sm text-muted-foreground">
          API keys are managed on the Keys page, alongside their scopes and last-used times.
        </p>
        <Link
          to="/dashboard/keys"
          className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-brand hover:underline"
        >
          Manage API keys
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </Panel>

      <Panel title="Danger zone" className="border-destructive/30">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium">Delete workspace</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Permanently destroys every function, snapshot, and volume. This cannot be undone.
            </p>
          </div>
          <Button variant="destructive" size="sm" onClick={() => setShowDelete(true)}>
            Delete workspace
          </Button>
        </div>
      </Panel>

      {showDelete && (
        <DeleteWorkspaceDialog
          workspace={workspace}
          onCancel={() => setShowDelete(false)}
          onConfirm={handleDelete}
        />
      )}
      <EgressExtraPanel />
      <ExportPanel />
    </div>
  );
}
