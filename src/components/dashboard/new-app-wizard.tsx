import { useEffect, useState } from 'react';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, Github, Package, Page, Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { DeploymentProgress } from '@/components/dashboard/deployment-progress';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import {
  isValidGitHubRepo,
  isValidGitRef,
  type AppSource,
  type NewAppSearch,
} from '@/components/dashboard/new-app-source';
import { TemplateCatalog } from '@/components/dashboard/template-catalog';
import { ProjectImport } from '@/components/dashboard/project-import';
import { CopyIconButton } from '@/components/ui/copy-button';
import { templateBySlug } from '@/lib/templates';
import { type Runtime } from '@/lib/mock-data';
import { errorMessage } from '@/lib/api/errors';
import { useData } from '@/lib/store';
import {
  useBindRepoFor,
  useDeployFromRefFor,
  useTemplates,
  useUpdateAppFor,
} from '@/lib/api/queries';
import { useAuth } from '@/lib/auth';
import {
  appQuotaExceeded,
  appQuotaRemaining,
  memoryAllowed,
  residentInstancesAllowed,
} from '@/lib/plan';
import { cn } from '@/lib/utils';

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const STEPS = ['Source', 'Configure', 'Review'] as const;

/** Git deploys immediately; empty/template apps await CLI deployment.
 * Import keeps the existing project scan/apply contract inside this flow. */
const SOURCES = [
  {
    id: 'git',
    name: 'Git repository',
    desc: 'Build the ref right after the app is created.',
    icon: Github,
  },
  {
    id: 'empty',
    name: 'Empty app',
    desc: 'Set up the app now and deploy it from the CLI or CI later.',
    icon: Package,
  },
  {
    id: 'template',
    name: 'Template',
    desc: 'Choose a starter, create the app, then deploy its scaffold with the CLI.',
    icon: Page,
  },
  {
    id: 'import',
    name: 'Import',
    desc: 'Scan a repository archive and apply its project plan to create apps.',
    icon: Upload,
  },
] as const;

/** The set `apid` accepts on `POST /v1/apps`; anything else is a 400. */
const RUNTIMES: { id: Runtime; label: string }[] = [
  { id: 'node22', label: 'Node 22' },
  { id: 'node24', label: 'Node 24' },
  { id: 'python312', label: 'Python 3.12' },
  { id: 'python313', label: 'Python 3.13' },
  { id: 'go124', label: 'Go 1.24' },
  { id: 'go124-alpine', label: 'Go 1.24 (Alpine)' },
];

const APP_TYPES: { id: 'function' | 'app'; label: string; desc: string }[] = [
  { id: 'function', label: 'Function', desc: 'Source built against a managed runtime.' },
  { id: 'app', label: 'App', desc: 'Your own container image.' },
];

const MEMORY = [128, 256, 512, 1024, 2048];

interface NewAppWizardProps {
  search?: NewAppSearch;
  onSearchChange?: (search: NewAppSearch, options?: { replace?: boolean }) => void;
  /** Existing direct template launches remain supported alongside URL search state. */
  templateSlug?: string;
  /** Removes dashboard chrome and keeps onboarding focused on a real Git deployment. */
  onboarding?: boolean;
  /** Called after the first source-ref deployment has been accepted. */
  onDeploymentAccepted?: () => void;
  /** Allows onboarding to make a deliberate hand-off to the account connection screen. */
  onConnectGitHub?: () => void;
}

export function NewAppWizard({
  templateSlug: initialTemplateSlug,
  search: urlSearch,
  onSearchChange,
  onboarding = false,
  onDeploymentAccepted,
  onConnectGitHub,
}: NewAppWizardProps) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { addWorkflow } = useData();
  const { account, loading: authLoading } = useAuth();
  const reduce = useReducedMotion();
  const [localSearch, setLocalSearch] = useState<NewAppSearch>({
    source: onboarding ? 'git' : undefined,
    template: initialTemplateSlug,
  });
  // After submission, completion and retries describe the app we actually
  // created even if browser history moves to an earlier source selection.
  const [submittedSearch, setSubmittedSearch] = useState<NewAppSearch | null>(null);
  const search = submittedSearch ?? urlSearch ?? localSearch;
  const changeSearch = onSearchChange ?? setLocalSearch;
  const source = search.source ?? (search.template ? 'template' : undefined);
  const templateSlug = source === 'template' ? search.template : undefined;
  const setSource = (next: AppSource) =>
    changeSearch({
      ...search,
      source: next,
      template: next === 'template' ? templateSlug : undefined,
      step: undefined,
    });
  const setStep = (next: number) =>
    changeSearch({ ...search, step: next === 2 ? 'review' : next === 1 ? 'configure' : undefined });
  // A template prefills runtime, memory and name; its scaffold is deployed
  // from the CLI once the app exists.
  const template = templateBySlug(templateSlug);
  // The API's starter catalog and the local scaffolds share no names, so a
  // catalog pick prefills what it can and hands the scaffold to the CLI. Only
  // the per-runtime starters name a runtime; the rest keep the default and the
  // customer chooses, rather than the wizard guessing.
  const catalog = useTemplates();
  const catalogTemplate = (catalog.data ?? []).find((t) => t.name === templateSlug);
  const picked = Boolean(template || catalogTemplate);
  const initialName = template?.slug ?? catalogTemplate?.name ?? '';
  const catalogRuntime: Runtime | null = /-node$/.test(templateSlug ?? '')
    ? 'node24'
    : /-python$/.test(templateSlug ?? '')
      ? 'python313'
      : /-go$/.test(templateSlug ?? '')
        ? 'go124'
        : null;

  const [createdId, setCreatedId] = useState<string | null>(null);
  // The endpoint the API assigned. Constructing one from the slug would be a
  // guess about the platform's hostname scheme; this is the real value.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [nameDraft, setName] = useState<string | null>(null);
  const name = nameDraft ?? initialName;
  const bindRepo = useBindRepoFor();
  const deployFromRef = useDeployFromRefFor();
  const updateApp = useUpdateAppFor();
  const [appType, setAppType] = useState<'function' | 'app'>('function');
  const [runtimeDraft, setRuntime] = useState<Runtime | null>(null);
  const runtime = runtimeDraft ?? template?.runtime ?? (picked ? catalogRuntime : null) ?? 'node22';
  // Start at the platform floor. The previous 512 MB default guaranteed a
  // failed Free-plan submission before the customer had seen the limit.
  const [memoryDraft, setMemoryMb] = useState<number | null>(null);
  const memoryMb = memoryDraft ?? template?.memoryMb ?? 128;
  const [scaleToZero, setScaleToZero] = useState(true);
  const githubConnected = Boolean(account?.github_install_id);
  const canKeepResident = residentInstancesAllowed(account);
  const effectiveScaleToZero = scaleToZero || !canKeepResident;

  const [deploying, setDeploying] = useState(false);
  const [deploymentId, setDeploymentId] = useState<string | null>(null);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // A half-filled wizard asks before it is discarded. Once the app exists
  // (or nothing was typed) leaving is free. A template's prefilled name is
  // not the user's typing — only their own edits arm the guard.
  useUnsavedGuard(
    !createdId && Boolean(repo.trim() || (name.trim() && name !== initialName)),
    undefined,
    '/dashboard/workflows/new'
  );

  const nameValid = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(name);
  const normalizedRef = ref.trim() || 'main';
  const repoValid = isValidGitHubRepo(repo);
  const refValid = isValidGitRef(normalizedRef);
  const gitSourceValid = source !== 'git' || (repoValid && refValid);
  const sourceValid =
    Boolean(source) &&
    source !== 'import' &&
    (source !== 'template' || picked) &&
    gitSourceValid &&
    (source !== 'git' || githubConnected);
  // Reloaded URLs restore the source; missing in-memory fields return to the
  // earliest incomplete step instead of exposing an invalid review/create.
  const step = !sourceValid ? 0 : search.step === 'review' && nameValid ? 2 : search.step ? 1 : 0;
  const normalizedStep = step === 2 ? 'review' : step === 1 ? 'configure' : undefined;
  const sourcePending =
    (source === 'template' && catalog.isPending) || (source === 'git' && authLoading);
  // Replace an incomplete restored step, rather than leaving a review URL
  // armed to advance as soon as typing makes the missing fields valid.
  useEffect(() => {
    if (
      urlSearch &&
      onSearchChange &&
      !submittedSearch &&
      !sourcePending &&
      urlSearch.step !== normalizedStep
    ) {
      onSearchChange({ ...urlSearch, step: normalizedStep }, { replace: true });
    }
  }, [urlSearch, onSearchChange, submittedSearch, sourcePending, normalizedStep]);
  const maxMemoryMb = account?.limits.ram_mb ?? 128;
  const selectedMemoryMb = Math.min(memoryMb, maxMemoryMb);
  const quotaRemaining = appQuotaRemaining(account);
  const quotaExceeded = appQuotaExceeded(account);
  const limitsLoading = authLoading && !account;
  const deployBlocked = limitsLoading || quotaExceeded || !memoryAllowed(account, selectedMemoryMb);

  async function submitGitSource(slug: string) {
    const installationId = Number(account?.github_install_id);
    if (!Number.isSafeInteger(installationId) || installationId <= 0) {
      throw new Error('Connect GitHub before deploying from a repository.');
    }

    await bindRepo.mutateAsync({
      slug,
      installationId,
      repo: repo.trim(),
      branch: normalizedRef,
    });
    return deployFromRef.mutateAsync({
      slug,
      repo: repo.trim(),
      ref: normalizedRef,
      format: 'tarball',
    });
  }

  async function retrySourceDeploy() {
    if (!createdId || source !== 'git' || !gitSourceValid || retrying) return;
    setRetrying(true);
    setSubmissionError(null);
    try {
      const deployment = await submitGitSource(createdId);
      setDeploymentId(deployment.id);
      onDeploymentAccepted?.();
      toast({
        kind: 'success',
        title: 'Build accepted',
        description: `${repo.trim()}@${normalizedRef} is queued for build.`,
      });
    } catch (err) {
      setSubmissionError(errorMessage(err));
    } finally {
      setRetrying(false);
    }
  }

  async function createFunction() {
    if (deployBlocked || !nameValid || !sourceValid) {
      return;
    }
    setDeploying(true);
    setSubmittedSearch(search);
    setSubmissionError(null);
    try {
      // App creation is the durable first step. The UI only advances to build
      // status after the API returns the actual deployment id.
      const created = await addWorkflow({
        name,
        runtime,
        memoryMb: selectedMemoryMb,
        type: appType,
      });
      setCreatedId(created.id);
      setCreatedUrl(created.url);

      const scalePromise: Promise<unknown> = !effectiveScaleToZero
        ? updateApp.mutateAsync({ slug: created.id, min_instances: 1 })
        : Promise.resolve();
      const deploymentPromise =
        source === 'git' && gitSourceValid ? submitGitSource(created.id) : Promise.resolve(null);

      const [scaleResult, deploymentResult] = await Promise.allSettled([
        scalePromise,
        deploymentPromise,
      ]);

      if (scaleResult.status === 'rejected') {
        toast({
          kind: 'error',
          title: 'App created, but configuration failed',
          description: errorMessage(scaleResult.reason),
        });
      }

      if (deploymentResult.status === 'fulfilled' && deploymentResult.value) {
        setDeploymentId(deploymentResult.value.id);
        onDeploymentAccepted?.();
        toast({
          kind: 'success',
          title: 'Build accepted',
          description: `${repo.trim()}@${normalizedRef} is queued for build.`,
        });
      } else if (deploymentResult.status === 'rejected') {
        setSubmissionError(errorMessage(deploymentResult.reason));
        toast({
          kind: 'error',
          title: 'App created, but build was not submitted',
          description: errorMessage(deploymentResult.reason),
        });
      } else {
        toast({
          kind: 'success',
          title: 'App ready',
          description: `${name} is ready. Deploy it with gregale deploy when you are.`,
        });
      }
    } catch (err) {
      setDeploying(false);
      setSubmittedSearch(null);
      toast({
        kind: 'error',
        title: 'Could not create the app',
        description: errorMessage(err),
      });
    }
  }

  function renderCompletion() {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader
          title={onboarding ? 'Your first deployment' : 'New app'}
          description="Track the app and its first deployment from the platform state."
        />

        {source === 'git' ? (
          <DeploymentProgress
            appCreated={Boolean(createdId)}
            appName={name}
            deploymentId={deploymentId}
            repo={repo}
            sourceRef={ref}
            submissionError={submissionError}
          />
        ) : !template && catalogTemplate ? (
          <Panel
            title={`${catalogTemplate.name} scaffold`}
            description="The app exists — the CLI writes this template's files into an empty directory, then deploys them."
          >
            <p className="text-xs text-muted-foreground">{catalogTemplate.description}</p>
            <div className="mt-3 flex items-center justify-between gap-3 rounded-lg border border-border bg-background p-3">
              <code className="font-mono text-xs text-foreground">
                gregale init --template {catalogTemplate.name} && gregale deploy --app {name}
              </code>
              <CopyIconButton
                text={`gregale init --template ${catalogTemplate.name} && gregale deploy --app ${name}`}
                label="Copy the CLI commands"
              />
            </div>
          </Panel>
        ) : template ? (
          <Panel
            title={`${template.name} scaffold`}
            description="The app exists — this code is its first deployment."
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-xs text-muted-foreground">{template.filename}</p>
              <CopyIconButton text={template.code} label={`Copy ${template.filename}`} />
            </div>
            <pre className="mt-2 max-h-72 overflow-auto rounded-lg border border-border bg-background p-3 font-mono text-xs leading-relaxed text-foreground">
              {template.code}
            </pre>
            <ol className="mt-4 flex list-decimal flex-col gap-1.5 pl-5 text-sm text-muted-foreground">
              {template.steps.map((s) => (
                <li key={s}>
                  {s === 'gregale deploy --app' ? (
                    <code className="rounded bg-background px-1.5 py-0.5 font-mono text-xs text-foreground">
                      gregale deploy --app {name}
                    </code>
                  ) : (
                    s
                  )}
                </li>
              ))}
            </ol>
          </Panel>
        ) : (
          <Panel title="App ready" description="No deployment was started.">
            <p className="text-sm text-muted-foreground">
              The app is ready for its first deployment from the CLI or CI.
            </p>
            <code className="mt-4 block overflow-x-auto rounded-lg border border-border bg-background p-3 font-mono text-xs text-foreground">
              gregale deploy --app {name}
            </code>
          </Panel>
        )}

        {submissionError && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[color:var(--status-critical)]/35 bg-card p-4">
            <p className="text-xs text-muted-foreground">
              The app exists, so you can retry the source deployment without creating a second app.
            </p>
            <Button
              variant="outline"
              size="sm"
              disabled={retrying}
              onClick={() => void retrySourceDeploy()}
            >
              {retrying ? 'Retrying…' : 'Try again'}
            </Button>
          </div>
        )}

        {createdId && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.3, ease: EASE }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">
                {source === 'git' && deploymentId ? 'Endpoint' : 'App endpoint'}
              </p>
              <a
                href={createdUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                {createdUrl ?? 'Waiting for the endpoint…'}
              </a>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/dashboard/workflows' })}
              >
                All apps
              </Button>
              <Button
                variant="cta"
                size="sm"
                className="gap-1.5 rounded-md"
                onClick={() =>
                  navigate({
                    to: '/dashboard/workflows/$workflowId',
                    params: { workflowId: createdId },
                  })
                }
              >
                View app
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  const form = (
    <div
      className={cn(
        'mx-auto flex w-full flex-col gap-6',
        source === 'template' || source === 'import' ? 'max-w-5xl' : 'max-w-2xl'
      )}
    >
      {!onboarding && (
        <Link
          to="/dashboard/workflows"
          className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" />
          All apps
        </Link>
      )}

      <PageHeader
        title={onboarding ? 'Deploy your first app' : 'New app'}
        description={
          onboarding
            ? 'Choose a Git repository, configure its runtime, and watch the real build go live.'
            : template
              ? `Starting from the ${template.name} template — source, runtime, and memory are prefilled; the scaffold arrives once the app exists.`
              : 'Choose a source to create your app.'
        }
      />

      {/* Step rail */}
      {source !== 'import' && (
        <ol aria-label="App creation steps" className="flex items-center gap-2">
          {STEPS.map((label, i) => (
            <li
              key={label}
              aria-current={i === step ? 'step' : undefined}
              className="flex items-center gap-2"
            >
              <span
                className={cn(
                  'flex h-6 w-6 items-center justify-center rounded-full border text-[11px]',
                  i < step && 'border-transparent text-black',
                  i === step && 'border-brand text-brand',
                  i > step && 'border-border text-muted-foreground'
                )}
                style={i < step ? { background: 'var(--status-good)' } : undefined}
              >
                {i < step ? <Check className="h-3 w-3" /> : i + 1}
              </span>
              <span
                className={cn('text-sm', i === step ? 'text-foreground' : 'text-muted-foreground')}
              >
                {label}
              </span>
              {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
            </li>
          ))}
        </ol>
      )}

      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && (
          <motion.div
            key="source"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              {SOURCES.filter((sourceOption) => !onboarding || sourceOption.id === 'git').map(
                (s) => {
                  const Icon = s.icon;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setSource(s.id)}
                      aria-pressed={source === s.id}
                      className={cn(
                        'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand',
                        source === s.id
                          ? 'border-brand bg-brand/5'
                          : 'border-border bg-card hover:border-border-secondary'
                      )}
                    >
                      <Icon className="mt-0.5 h-4 w-4 shrink-0 text-brand" />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium">{s.name}</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">{s.desc}</span>
                      </span>
                    </button>
                  );
                }
              )}
            </div>

            {source === 'git' && !githubConnected ? (
              <div
                role="status"
                className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-brand/30 bg-brand/5 p-4"
              >
                <div>
                  <p className="text-sm font-medium">Connect GitHub first</p>
                  <p className="mt-1 max-w-md text-xs text-muted-foreground">
                    Gregale uses your GitHub App installation to list repositories and fetch the
                    exact ref you deploy.
                  </p>
                </div>
                <form method="post" action="/dashboard/install/connect" onSubmit={onConnectGitHub}>
                  <Button type="submit" size="sm" variant="cta" className="gap-1.5">
                    <Github className="h-3.5 w-3.5" />
                    Connect GitHub
                  </Button>
                </form>
              </div>
            ) : source === 'git' ? (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Repository</span>
                  <RepoPicker
                    value={repo}
                    onChange={(nextRepo, defaultBranch) => {
                      setRepo(nextRepo);
                      if (defaultBranch) setRef(defaultBranch);
                    }}
                    className="h-10 rounded-lg bg-card"
                  />
                </label>
                <label className="flex flex-col gap-1.5 sm:w-40">
                  <span className="label-mono text-muted-foreground">Ref</span>
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="main"
                    maxLength={200}
                    spellCheck={false}
                    aria-invalid={!refValid || undefined}
                    className="h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                  {!refValid && (
                    <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                      Use a valid branch, tag, or commit SHA of at most 200 characters.
                    </span>
                  )}
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  The repository has to be reachable by the GitHub installation from{' '}
                  <span className="font-mono">gregale connect</span>.
                </p>
              </div>
            ) : null}

            {source === 'template' && (
              <>
                {picked && (
                  <p role="status" className="text-sm text-muted-foreground">
                    Selected template: <strong>{template?.name ?? catalogTemplate?.name}</strong>.
                    Create the app, then deploy the scaffold from the CLI.
                  </p>
                )}
                {templateSlug && !picked && !catalog.isPending && (
                  <p role="status" className="text-sm text-muted-foreground">
                    This template is unavailable. Choose a starter below or another source.
                  </p>
                )}
                <TemplateCatalog
                  selected={templateSlug}
                  onSelect={(slug) =>
                    changeSearch({ ...search, source: 'template', template: slug, step: undefined })
                  }
                />
              </>
            )}

            {source !== 'import' && (
              <div className="flex justify-end">
                <Button
                  variant="cta"
                  disabled={!sourceValid}
                  onClick={() => setStep(1)}
                  className="h-10 gap-2 rounded-lg"
                >
                  Continue
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </div>
            )}
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="configure"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
            className="flex flex-col gap-5"
          >
            <Panel>
              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="new-app-name" className="label-mono text-muted-foreground">
                    App name
                  </label>
                  <input
                    id="new-app-name"
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase())}
                    aria-invalid={!nameValid || undefined}
                    aria-describedby={!nameValid ? 'new-app-name-error' : undefined}
                    className={cn(
                      'h-10 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/25',
                      nameValid
                        ? 'border-border focus:border-brand'
                        : 'border-[color:var(--status-critical)]'
                    )}
                  />
                  {!nameValid && (
                    <span
                      id="new-app-name-error"
                      className="text-xs"
                      style={{ color: 'var(--status-critical)' }}
                    >
                      Lowercase letters, numbers, and dashes.
                    </span>
                  )}
                </div>

                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Type</span>
                  <select
                    value={appType}
                    onChange={(e) => setAppType(e.target.value as 'function' | 'app')}
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                  >
                    {APP_TYPES.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-muted-foreground">
                    {APP_TYPES.find((t) => t.id === appType)?.desc}
                  </span>
                </label>

                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Runtime</span>
                  <select
                    value={runtime}
                    onChange={(e) => setRuntime(e.target.value as Runtime)}
                    className="h-10 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand"
                  >
                    {RUNTIMES.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.label}
                      </option>
                    ))}
                  </select>
                </label>

                {/* No region picker: this is a one-box platform and the API
                    exposes no region to choose. */}
              </div>

              <div className="mt-6">
                <span className="label-mono text-muted-foreground">Memory</span>
                <div className="mt-2 flex flex-wrap gap-2">
                  {MEMORY.map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={m > maxMemoryMb}
                      onClick={() => setMemoryMb(m)}
                      aria-pressed={selectedMemoryMb === m}
                      aria-disabled={m > maxMemoryMb}
                      title={m > maxMemoryMb ? `Requires a plan with ${m} MB per app` : undefined}
                      className={cn(
                        'rounded-md border px-3 py-1.5 font-mono text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40',
                        selectedMemoryMb === m
                          ? 'border-brand bg-brand/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {m} MB
                    </button>
                  ))}
                </div>
                {account ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {account.plan} plan · up to {account.limits.ram_mb} MB per app
                  </p>
                ) : limitsLoading ? (
                  <p className="mt-2 text-xs text-muted-foreground" role="status">
                    Checking plan limits…
                  </p>
                ) : null}
              </div>

              <div className="mt-6 flex items-start justify-between gap-6 border-t border-border pt-5">
                <div>
                  <p className="text-sm font-medium">Scale to zero</p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                    Snapshot the microVM after 60s idle. Wakes in under 350ms on the next request.
                  </p>
                  {account && !canKeepResident && (
                    <p id="scale-to-zero-plan-note" className="mt-1 text-xs text-muted-foreground">
                      Keeping an instance resident requires a paid plan.
                    </p>
                  )}
                </div>
                <Switch
                  checked={effectiveScaleToZero}
                  disabled={!canKeepResident}
                  onCheckedChange={setScaleToZero}
                  aria-label="Scale to zero"
                  aria-describedby={!canKeepResident ? 'scale-to-zero-plan-note' : undefined}
                  className="mt-1 data-[state=checked]:bg-brand"
                />
              </div>
            </Panel>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(0)} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                variant="cta"
                disabled={!nameValid}
                onClick={() => setStep(2)}
                className="h-10 gap-2 rounded-lg"
              >
                Review
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {step === 2 && (
          <motion.div
            key="review"
            initial={reduce ? false : { opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 1 } : { opacity: 0, y: -10 }}
            transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
            className="flex flex-col gap-5"
          >
            <Panel title="Review">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {[
                  ['Name', name],
                  ['Source', SOURCES.find((option) => option.id === source)?.name ?? ''],
                  ['Type', APP_TYPES.find((t) => t.id === appType)?.label ?? ''],
                  [
                    'First deploy',
                    source === 'git'
                      ? `${repo}@${normalizedRef}, right after create`
                      : 'Later, from the CLI',
                  ],
                  ['Runtime', runtime],
                  ['Memory', `${selectedMemoryMb} MB`],
                  [
                    'Scale to zero',
                    effectiveScaleToZero ? 'Parks when idle' : 'One instance kept resident',
                  ],
                  // Assigned by the API on create, so it is not known until then.
                  ['Endpoint', createdUrl ?? 'Assigned on create'],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-1 border-b border-border pb-3">
                    <dt className="label-mono text-muted-foreground">{label}</dt>
                    <dd className="font-mono text-sm">{value}</dd>
                  </div>
                ))}
              </dl>

              {account && (
                <div
                  role={quotaExceeded ? 'alert' : 'status'}
                  className={cn(
                    'mt-5 rounded-lg border px-3 py-2 text-xs',
                    quotaExceeded
                      ? 'border-[color:var(--status-critical)]/35 text-muted-foreground'
                      : 'border-border text-muted-foreground'
                  )}
                >
                  {quotaExceeded ? (
                    <>
                      You have reached the {account.plan} plan limit of{' '}
                      {account.limits.deployed_apps} app
                      {account.limits.deployed_apps === 1 ? '' : 's'}.{' '}
                      <Link to="/dashboard/plans" className="text-brand hover:underline">
                        Upgrade your plan
                      </Link>{' '}
                      to deploy another app.
                    </>
                  ) : (
                    <>
                      {account.plan} plan · {quotaRemaining} app
                      {quotaRemaining === 1 ? '' : 's'} available · up to {account.limits.ram_mb} MB
                      per app.
                    </>
                  )}
                </div>
              )}

              <p className="mt-5 text-xs text-muted-foreground">
                Estimated cost at 100k invocations/month:{' '}
                <span className="text-foreground">
                  ${((selectedMemoryMb / 1024) * 0.05 * 100).toFixed(2)}
                </span>{' '}
                — billed only for time spent running.
              </p>
            </Panel>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                variant="cta"
                disabled={
                  deployBlocked ||
                  !nameValid ||
                  !gitSourceValid ||
                  (source === 'git' && !githubConnected)
                }
                onClick={() => void createFunction()}
                className="h-10 gap-2 rounded-lg px-6"
              >
                {source === 'git' ? 'Deploy app' : 'Create app'}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {deploying ? renderCompletion() : form}
      {/* Keep the archive and plan mounted through source switches and
          submission/completion, including a failed attempt from another source. */}
      {!onboarding && (
        <div hidden={deploying || source !== 'import'} className="mx-auto mt-6 w-full max-w-5xl">
          <ProjectImport initialSlug={search.slug} initialBranch={search.branch} />
        </div>
      )}
    </>
  );
}
