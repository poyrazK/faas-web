import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Code, Github, ArrowRight } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { ConfirmProvider } from '@/components/ui/confirm';
import { NewAppWizard } from '@/components/dashboard/new-app-wizard';
import { newAppPath, type NewAppSearch } from '@/components/dashboard/new-app-source';
import { beginOnboardingGitHubConnect, useAuth } from '@/lib/auth';
import { useOnboardingWorkspace } from './use-onboarding-workspace';
import { useOnboardingInventory } from '@/lib/api/onboarding';
import {
  readOnboarding,
  sampleVersion,
  writeOnboarding,
  type OnboardingDraft,
  type OnboardingOwner,
  type OnboardingRecord,
} from '@/lib/onboarding-draft';
import { OnboardingRecovery } from './onboarding-recovery';
import { onboardingEvent } from '@/lib/onboarding-events';

export function OnboardingFlow({
  search,
  onSearchChange,
}: {
  search: NewAppSearch;
  onSearchChange: (search: NewAppSearch, options?: { replace?: boolean }) => void;
}) {
  const { account, user, loading, refreshAccount, sessionError, apiReachable } = useAuth();
  const confirmed =
    account?.id && user?.email?.toLowerCase() === account.email?.toLowerCase() ? account.id : '';
  const workspace = useOnboardingWorkspace(confirmed);
  const [retrying, setRetrying] = useState(false);
  const [error, setError] = useState(false);
  if (
    loading ||
    Boolean(sessionError) ||
    apiReachable === false ||
    !account?.id ||
    !user ||
    account.email?.toLowerCase() !== user.email?.toLowerCase() ||
    !workspace.ready
  )
    return (
      <div className="mx-auto flex max-w-xl flex-col gap-5 px-5 py-16">
        <h1 className="text-2xl font-semibold">Prepare your workspace</h1>
        <p
          role={error || sessionError || apiReachable === false ? 'alert' : 'status'}
          className="text-sm text-muted-foreground"
        >
          {error || sessionError || apiReachable === false
            ? 'We could not confirm your account. Your setup has not changed.'
            : 'Confirming your account and workspace before deployment…'}
        </p>
        <Button
          busy={retrying}
          variant="outline"
          onClick={async () => {
            setRetrying(true);
            setError(false);
            try {
              await refreshAccount();
            } catch {
              setError(true);
            } finally {
              setRetrying(false);
            }
          }}
        >
          Retry account check
        </Button>
        <Link
          to="/login"
          search={{ next: newAppPath(search, true) }}
          className="text-sm text-brand underline"
        >
          Sign in again
        </Link>
      </div>
    );
  return (
    <ScopedOnboarding
      key={JSON.stringify([account.id, workspace.org])}
      owner={{ account: account.id, workspace: workspace.org }}
      plan={account.plan}
      label={workspace.label}
      search={search}
      onSearchChange={onSearchChange}
    />
  );
}

function ScopedOnboarding({
  owner,
  plan,
  label,
  search,
  onSearchChange,
}: {
  owner: OnboardingOwner;
  plan: string;
  label: string;
  search: NewAppSearch;
  onSearchChange: (search: NewAppSearch, options?: { replace?: boolean }) => void;
}) {
  const navigate = useNavigate();
  useEffect(() => {
    onboardingEvent('start', { plan }, { owner });
  }, [owner, plan]);
  const [record, setRecord] = useState<OnboardingRecord>(() => {
    const saved = readOnboarding(owner);
    if (search.recovery) {
      const r = search.recovery;
      return {
        ...saved,
        draft: {
          kind: 'git',
          app: r.app,
          repo: r.repo,
          ref: r.ref,
          ...(r.deployment ? { deployment: r.deployment } : {}),
          phase: r.phase ?? 'accepted',
        } as OnboardingDraft,
      };
    }
    if (!saved.draft && search.source === 'function')
      return {
        ...saved,
        draft: {
          kind: 'sample',
          starter: sampleVersion(),
          phase: 'preparing',
          name: `hello-${crypto.randomUUID().slice(0, 8)}`,
        } as OnboardingDraft,
      };
    return saved;
  });
  const recordRef = useRef(record);
  const active = useRef(true);
  const inventory = useOnboardingInventory(owner);
  const inventoryRef = useRef(inventory);
  useEffect(() => {
    inventoryRef.current = inventory;
  }, [inventory]);
  const [ownsSubmission, setOwnsSubmission] = useState(false);
  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);
  const update = useCallback((next: OnboardingRecord) => {
    if (!active.current) return;
    if (JSON.stringify(next) === JSON.stringify(recordRef.current)) return;
    recordRef.current = next;
    writeOnboarding(next);
    setRecord(next);
  }, []);
  const draftChanged = useCallback(
    (draft: OnboardingDraft) => {
      if (recordRef.current.draft && recordRef.current.draft.phase !== 'preparing') return;
      update({ ...recordRef.current, draft });
    },
    [update]
  );
  const progressChanged = useCallback(
    (draft: OnboardingDraft) => {
      if (!active.current) return;
      update({ ...recordRef.current, draft });
      setOwnsSubmission(draft.phase === 'creating' || draft.phase === 'submitting');
      if (draft.phase === 'creating')
        onboardingEvent('deployment_requested', { source: draft.kind, plan });
      if (draft.phase === 'rejected')
        onboardingEvent('deployment_failed', { source: draft.kind, plan });
      if (['accepted', 'rejected', 'unknown'].includes(draft.phase)) inventoryRef.current.refresh();
    },
    [update, plan]
  );
  const recoveryChanged = useCallback(
    (draft: OnboardingDraft) => update({ ...recordRef.current, draft }),
    [update]
  );
  const explicit = Boolean(search.source || search.repo || search.recovery || search.step);
  const draft = record.draft;
  const hasRecovery = !ownsSubmission && Boolean(draft?.app || draft?.phase === 'unknown');
  const selected =
    ownsSubmission && draft
      ? draft.kind
      : search.source === 'function'
        ? 'sample'
        : search.source === 'git' || search.repo
          ? 'git'
          : undefined;
  const live = inventory.apps.some((app) =>
    inventory.deployments.some((d) => d.app_id === app.id && d.status === 'live')
  );
  useEffect(() => {
    if (explicit || hasRecovery || inventory.pending || inventory.error) return;
    if (draft?.phase === 'preparing') {
      onSearchChange(
        {
          source: draft.kind === 'git' ? 'git' : 'function',
          step: 'configure',
          ...(draft.kind === 'git' ? { repo: draft.repo, ref: draft.ref } : {}),
        },
        { replace: true }
      );
    } else if (record.dismissed || live) {
      void navigate({ to: '/dashboard', replace: true });
    } else onSearchChange({ step: 'source' }, { replace: true });
  }, [
    explicit,
    hasRecovery,
    inventory.pending,
    inventory.error,
    draft,
    record.dismissed,
    live,
    navigate,
    onSearchChange,
  ]);
  useEffect(() => {
    if (search.recovery && !recordRef.current.draft) {
      const r = search.recovery;
      update({
        ...recordRef.current,
        draft: {
          kind: 'git',
          app: r.app,
          repo: r.repo,
          ref: r.ref,
          ...(r.deployment ? { deployment: r.deployment } : {}),
          phase: r.phase ?? 'accepted',
        },
      });
    }
  }, [search.recovery, update]);
  useEffect(() => {
    const heading = document.querySelector<HTMLElement>('#main h1');
    if (heading) {
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
    }
  }, [selected, hasRecovery]);

  function choose(kind: 'sample' | 'git') {
    onboardingEvent('path_selected', { source: kind, plan });
    const name = `hello-${crypto.randomUUID().slice(0, 8)}`;
    const next: OnboardingDraft =
      kind === 'sample'
        ? { kind, starter: sampleVersion(), name, phase: 'preparing' }
        : { kind, repo: search.repo ?? '', ref: search.ref ?? 'main', phase: 'preparing' };
    update({ ...record, draft: next });
    onSearchChange({
      source: kind === 'sample' ? 'function' : 'git',
      step: kind === 'sample' ? 'configure' : 'setup',
      ...(kind === 'git'
        ? { repo: next.kind === 'git' ? next.repo : undefined, ref: search.ref }
        : {}),
    });
  }
  function explore() {
    onboardingEvent('setup_dismissed', { plan });
    update({ ...recordRef.current, dismissed: true });
    void navigate({ to: '/dashboard' });
  }
  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 border-b border-border px-5 py-4">
        <Link to="/" aria-label="Gregale home">
          <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
        </Link>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground sm:inline">{label}</span>
          <Button variant="ghost" size="sm" onClick={explore}>
            Explore the console
          </Button>
        </div>
      </header>
      <main id="main" className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-5 py-10 sm:py-14">
        <ol
          aria-label="Getting started"
          className="flex items-center gap-3 text-xs text-muted-foreground"
        >
          <li>1. Choose</li>
          <li aria-hidden>→</li>
          <li>2. Deploy</li>
          <li aria-hidden>→</li>
          <li>3. Open your app</li>
        </ol>
        {inventory.error && (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border p-4">
            <p role="alert" className="flex-1 text-sm">
              We could not read your saved apps. Your setup is unchanged.
            </p>
            <Button variant="outline" size="sm" onClick={inventory.refresh}>
              Retry app lookup
            </Button>
          </div>
        )}
        {hasRecovery && draft ? (
          <ConfirmProvider>
            {search.repo &&
              (draft.kind !== 'git' || draft.repo !== search.repo || draft.ref !== search.ref) && (
                <p className="text-sm text-muted-foreground">
                  Your saved deployment is below.{' '}
                  <Link
                    to="/dashboard/apps/new"
                    search={{ source: 'git', repo: search.repo, ref: search.ref, step: 'setup' }}
                    className="text-brand underline"
                  >
                    Continue with the selected repository
                  </Link>
                </p>
              )}
            <OnboardingRecovery
              owner={owner}
              draft={draft}
              plan={plan}
              apps={inventory.apps}
              inventoryUnavailable={inventory.pending || Boolean(inventory.error)}
              onChange={recoveryChanged}
              onRefresh={inventory.refresh}
            />
          </ConfirmProvider>
        ) : selected && selected !== 'existing' ? (
          <ConfirmProvider>
            <NewAppWizard
              key={selected}
              onboarding
              quickstart
              deploymentDisabled={inventory.pending || Boolean(inventory.error)}
              search={
                ownsSubmission && draft
                  ? { ...search, source: draft.kind === 'git' ? 'git' : 'function' }
                  : search
              }
              suggestedName={
                draft?.name ??
                (selected === 'sample'
                  ? `hello-${owner.account
                      .replace(/[^a-z0-9]/gi, '')
                      .slice(0, 8)
                      .toLowerCase()}`
                  : undefined)
              }
              onDraftChange={draftChanged}
              onProgress={progressChanged}
              onSearchChange={onSearchChange}
              onConnectGitHub={beginOnboardingGitHubConnect}
            />
          </ConfirmProvider>
        ) : (
          <>
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Get your first app live</h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-muted-foreground">
                Try a working sample, or bring a repository. Follow the real build, then open your
                app's URL.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-4 rounded-xl border border-brand/40 bg-card p-6">
                <Code className="size-7 text-brand" />
                <h2 className="text-lg font-semibold">Try a sample</h2>
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                  Deploy a small Node.js function in your account. No repository or GitHub
                  connection needed.
                </p>
                <Button onClick={() => choose('sample')}>
                  Try a sample
                  <ArrowRight className="size-4" />
                </Button>
              </div>
              <div className="flex flex-col gap-4 rounded-xl border border-border bg-card p-6">
                <Github className="size-7" />
                <h2 className="text-lg font-semibold">Deploy my repository</h2>
                <p className="flex-1 text-sm leading-relaxed text-muted-foreground">
                  Choose your code and branch. Connect GitHub only when you are ready to grant
                  repository access.
                </p>
                <Button variant="outline" onClick={() => choose('git')}>
                  Choose a repository
                </Button>
              </div>
            </div>
            {inventory.pending && (
              <p role="status" className="text-sm text-muted-foreground">
                Checking for apps you can resume…
              </p>
            )}
            {!inventory.pending && !inventory.error && inventory.apps.length > 0 && (
              <section className="flex flex-col gap-3">
                <h2 className="text-sm font-medium">Continue an existing app</h2>
                {inventory.apps.slice(0, 5).map((app) => {
                  const deployment = inventory.deployments.find((d) => d.app_id === app.id);
                  return (
                    <div
                      key={app.id}
                      className="flex items-center justify-between gap-3 rounded-lg border border-border p-4"
                    >
                      <span className="break-all font-mono text-sm">{app.slug}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          update({
                            ...record,
                            draft: {
                              kind: 'existing',
                              app: app.slug,
                              ...(deployment
                                ? { deployment: deployment.id, phase: 'accepted' as const }
                                : { phase: 'unknown' as const }),
                            },
                          })
                        }
                      >
                        Continue
                      </Button>
                    </div>
                  );
                })}
              </section>
            )}
          </>
        )}
        {selected && !hasRecovery && !ownsSubmission && (
          <Button
            variant="ghost"
            className="self-start"
            onClick={() => onSearchChange({ step: 'source' })}
          >
            Choose a different starting point
          </Button>
        )}
      </main>
    </div>
  );
}
