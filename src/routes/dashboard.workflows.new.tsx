import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, ArrowRight, Check, Github, Package } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';
import { BuildLog } from '@/components/dashboard/build-log';
import { PageHeader, Panel } from '@/components/dashboard/primitives';
import { type Runtime } from '@/lib/mock-data';
import { errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { useData } from '@/lib/store';
import { useDeployFromRefFor, useUpdateAppFor } from '@/lib/api/queries';
import { cn } from '@/lib/utils';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/dashboard/workflows/new')({
  head: () => pageHead({ title: 'New workflow' }),
  component: NewFunctionPage,
});

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];
const STEPS = ['Source', 'Configure', 'Review'] as const;

/**
 * Two sources, both real. The earlier list offered a template and an upload
 * alongside Git, and all three were decoration: the choice was collected,
 * shown on the review screen, and never sent anywhere. Now Git means a
 * source-ref deploy fires the moment the app exists, and Empty means exactly
 * that — an app waiting for its first `gregale deploy`.
 */
const SOURCES = [
  {
    id: 'git',
    name: 'Deploy from Git',
    desc: 'Build the ref right after the app is created.',
    icon: Github,
  },
  {
    id: 'empty',
    name: 'Create empty',
    desc: 'Set up the app now and deploy it from the CLI or CI later.',
    icon: Package,
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

function NewFunctionPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { account } = useAuth();
  const { addWorkflow } = useData();

  const [createdId, setCreatedId] = useState<string | null>(null);
  // The endpoint the API assigned. Constructing one from the slug would be a
  // guess about the platform's hostname scheme; this is the real value.
  const [createdUrl, setCreatedUrl] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [source, setSource] = useState('git');
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [name, setName] = useState('');
  const deployFromRef = useDeployFromRefFor();
  const updateApp = useUpdateAppFor();
  const [appType, setAppType] = useState<'function' | 'app'>('function');
  const [runtime, setRuntime] = useState<Runtime>('node22');
  const [memoryMb, setMemoryMb] = useState(512);
  const [scaleToZero, setScaleToZero] = useState(true);
  const githubConnected = Boolean(account?.github_install_id);

  const [deploying, setDeploying] = useState(false);
  const [deployed, setDeployed] = useState(false);

  const nameValid = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(name);

  if (deploying) {
    return (
      <div className="mx-auto flex max-w-2xl flex-col gap-6">
        <PageHeader
          title={deployed ? 'Deployed' : 'Deploying'}
          description={
            deployed
              ? `${name} is live and already scaled to zero.`
              : `Building ${name} and capturing its snapshot.`
          }
        />

        <BuildLog
          onComplete={() => {
            // `addWorkflow` is a real `POST /v1/apps` now, so it can fail —
            // most often 409 on a slug already in use, or 403 when the plan's
            // app limit is reached.
            void addWorkflow({ name, runtime, memoryMb, type: appType })
              .then(async (created) => {
                // What the wizard promised, now actually done: a Git source
                // kicks off the first build, and "scale to zero" off pins one
                // instance resident. Both used to be shown and discarded.
                const followUps: Promise<unknown>[] = [];
                if (!scaleToZero)
                  followUps.push(updateApp.mutateAsync({ slug: created.id, min_instances: 1 }));
                if (source === 'git' && repo.includes('/'))
                  followUps.push(
                    deployFromRef.mutateAsync({
                      slug: created.id,
                      repo: repo.trim(),
                      ref: ref.trim() || 'main',
                      format: 'tarball',
                    })
                  );
                const results = await Promise.allSettled(followUps);
                const failed = results.find((r) => r.status === 'rejected') as
                  PromiseRejectedResult | undefined;
                setCreatedId(created.id);
                setCreatedUrl(created.url);
                setDeployed(true);
                if (failed) {
                  toast({
                    kind: 'error',
                    title: 'App created, but not every step landed',
                    description: errorMessage(failed.reason),
                  });
                } else {
                  toast({
                    kind: 'success',
                    title: 'App created',
                    description:
                      source === 'git' && repo.includes('/')
                        ? `${repo.trim()}@${ref.trim() || 'main'} is building. It goes live when the build succeeds.`
                        : `${name} is ready. Deploy it with gregale deploy when you are.`,
                  });
                }
              })
              .catch((err: unknown) => {
                setDeploying(false);
                toast({
                  kind: 'error',
                  title: 'Could not create the app',
                  description: errorMessage(err),
                });
              });
          }}
        />

        {deployed && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
            className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4"
          >
            <a
              href={createdUrl ?? undefined}
              target="_blank"
              rel="noopener noreferrer"
              className="font-mono text-xs text-muted-foreground transition-colors hover:text-foreground"
            >
              {createdUrl ?? 'Waiting for the endpoint…'}
            </a>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate({ to: '/dashboard/workflows' })}
              >
                All workflows
              </Button>
              <Button
                variant="cta"
                size="sm"
                className="gap-1.5 rounded-md"
                onClick={() =>
                  createdId
                    ? navigate({
                        to: '/dashboard/workflows/$workflowId',
                        params: { workflowId: createdId },
                      })
                    : navigate({ to: '/dashboard' })
                }
              >
                View function
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
          </motion.div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link
        to="/dashboard/workflows"
        className="inline-flex w-fit items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3 w-3" />
        All workflows
      </Link>

      <PageHeader title="New function" description="Deploy a function to bare metal." />

      {/* Step rail */}
      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex items-center gap-2">
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

      <AnimatePresence mode="wait" initial={false}>
        {step === 0 && (
          <motion.div
            key="source"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex flex-col gap-4"
          >
            <div className="flex flex-col gap-2">
              {SOURCES.map((s) => {
                const Icon = s.icon;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setSource(s.id)}
                    aria-pressed={source === s.id}
                    className={cn(
                      'flex items-start gap-3 rounded-lg border p-4 text-left transition-colors',
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
              })}
            </div>

            {source === 'git' && (
              <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Repository</span>
                  <input
                    value={repo}
                    onChange={(e) => setRepo(e.target.value)}
                    placeholder="owner/repo"
                    spellCheck={false}
                    className="h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                </label>
                <label className="flex flex-col gap-1.5 sm:w-40">
                  <span className="label-mono text-muted-foreground">Ref</span>
                  <input
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                    placeholder="main"
                    spellCheck={false}
                    className="h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/25"
                  />
                </label>
                <p className="text-xs text-muted-foreground sm:col-span-2">
                  The repository has to be reachable by the GitHub installation from{' '}
                  <span className="font-mono">gregale connect</span>.
                </p>
              </div>
            )}

            <div className="flex justify-end">
              <Button
                variant="cta"
                disabled={source === 'git' && !repo.includes('/')}
                onClick={() => setStep(1)}
                className="h-10 gap-2 rounded-lg"
              >
                Continue
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}

        {step === 1 && (
          <motion.div
            key="configure"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex flex-col gap-5"
          >
            <Panel>
              <div className="grid gap-5 sm:grid-cols-2">
                <label className="flex flex-col gap-1.5">
                  <span className="label-mono text-muted-foreground">Function name</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value.toLowerCase())}
                    aria-invalid={!nameValid || undefined}
                    className={cn(
                      'h-10 rounded-lg border bg-background px-3 font-mono text-sm outline-none focus:ring-2 focus:ring-brand/25',
                      nameValid
                        ? 'border-border focus:border-brand'
                        : 'border-[color:var(--status-critical)]'
                    )}
                  />
                  {!nameValid && (
                    <span className="text-xs" style={{ color: 'var(--status-critical)' }}>
                      Lowercase letters, numbers, and dashes.
                    </span>
                  )}
                </label>

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
                      onClick={() => setMemoryMb(m)}
                      aria-pressed={memoryMb === m}
                      className={cn(
                        'rounded-md border px-3 py-1.5 font-mono text-xs transition-colors',
                        memoryMb === m
                          ? 'border-brand bg-brand/10 text-foreground'
                          : 'border-border text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {m} MB
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6 flex items-start justify-between gap-6 border-t border-border pt-5">
                <div>
                  <p className="text-sm font-medium">Scale to zero</p>
                  <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">
                    Snapshot the microVM after 60s idle. Wakes in under 350ms on the next request.
                  </p>
                </div>
                <Switch
                  checked={scaleToZero}
                  onCheckedChange={setScaleToZero}
                  aria-label="Scale to zero"
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
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: EASE }}
            className="flex flex-col gap-5"
          >
            <Panel title="Review">
              <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
                {[
                  ['Name', name],
                  ['Type', APP_TYPES.find((t) => t.id === appType)?.label ?? ''],
                  [
                    'First deploy',
                    source === 'git'
                      ? `${repo}@${ref || 'main'}, right after create`
                      : 'Later, from the CLI',
                  ],
                  ['Runtime', runtime],
                  ['Memory', `${memoryMb} MB`],
                  ['Scale to zero', scaleToZero ? 'Parks when idle' : 'One instance kept resident'],
                  // Assigned by the API on create, so it is not known until then.
                  ['Endpoint', createdUrl ?? 'Assigned on create'],
                ].map(([label, value]) => (
                  <div key={label} className="flex flex-col gap-1 border-b border-border pb-3">
                    <dt className="label-mono text-muted-foreground">{label}</dt>
                    <dd className="font-mono text-sm">{value}</dd>
                  </div>
                ))}
              </dl>

              <p className="mt-5 text-xs text-muted-foreground">
                Estimated cost at 100k invocations/month:{' '}
                <span className="text-foreground">
                  ${((memoryMb / 1024) * 0.05 * 100).toFixed(2)}
                </span>{' '}
                — billed only for time spent running.
              </p>

              {source === 'git' && !githubConnected && (
                <div
                  role="alert"
                  className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-brand/30 bg-brand/5 px-3 py-2.5 text-xs"
                >
                  <span className="text-muted-foreground">
                    Connect GitHub before deploying from a repository. This keeps the app from being
                    created without its first deployment.
                  </span>
                  <Link
                    to="/dashboard/account"
                    className="shrink-0 font-medium text-brand hover:underline"
                  >
                    Connect GitHub
                  </Link>
                </div>
              )}
            </Panel>

            <div className="flex items-center justify-between">
              <Button variant="ghost" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" />
                Back
              </Button>
              <Button
                variant="cta"
                disabled={source === 'git' && !githubConnected}
                onClick={() => setDeploying(true)}
                className="h-10 gap-2 rounded-lg px-6"
              >
                Deploy function
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
