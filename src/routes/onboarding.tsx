import { useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useSweepNavigate } from '@/components/sweep-link';
import { ArrowLeft, ArrowRight, Check } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { ToastProvider, useToast } from '@/components/ui/toast';
import { PixelBeams } from '@/components/landing/shaders/pixel-beams';
import { INSTALL_COMMAND } from '@/components/landing/install-command';
import { CopyIconButton } from '@/components/ui/copy-button';
import {
  AuthProvider,
  DEFAULT_WORKSPACE,
  markOnboarded,
  readSession,
  saveWorkspace,
  useAuth,
} from '@/lib/auth';
import { cn } from '@/lib/utils';
import { pageHead } from '@/lib/seo';

export const Route = createFileRoute('/onboarding')({
  head: () => pageHead({ title: 'Get started' }),
  beforeLoad: () => {
    if (!readSession()) throw redirect({ to: '/login' });
  },
  component: OnboardingPage,
});

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

const STEPS = ['Workspace', 'First app'] as const;

/* Every command here is one the CLI documents (`content/docs/cli.md`) — the
 * same script the dashboard's first-run panel shows. Regions and templates
 * used to be offered here; the API has neither, so onboarding stopped
 * pretending. */
const CLI_STEPS: { command: string; caption: string }[] = [
  { command: INSTALL_COMMAND, caption: 'Install the CLI. Homebrew on macOS and Linux.' },
  {
    command: 'gregale connect',
    caption: 'Link your GitHub account once, in a browser.',
  },
  {
    command: 'gregale deploy --repo <owner>/<repo> --ref main',
    caption: 'Build and deploy. The app appears in the console as the build starts.',
  },
];

function StepRail({ current }: { current: number }) {
  return (
    <ol className="flex items-center gap-2">
      {STEPS.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex items-center gap-2">
            <span
              className={cn(
                'flex h-6 w-6 items-center justify-center rounded-full border text-[11px] transition-colors',
                done && 'border-transparent text-black',
                active && 'border-brand text-brand',
                !done && !active && 'border-border text-muted-foreground'
              )}
              style={done ? { background: 'var(--status-good)' } : undefined}
            >
              {done ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={cn(
                'hidden text-sm sm:block',
                active ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border sm:w-10" />}
          </li>
        );
      })}
    </ol>
  );
}

function OnboardingPage() {
  return (
    <AuthProvider>
      <ToastProvider>
        <OnboardingContent />
      </ToastProvider>
    </AuthProvider>
  );
}

function OnboardingContent() {
  const sweepNavigate = useSweepNavigate();
  const { toast } = useToast();
  const { user } = useAuth();

  const [step, setStep] = useState(0);
  const [workspace, setWorkspace] = useState(DEFAULT_WORKSPACE);

  const slugValid = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(workspace);

  // Everything onboarding actually persists: the workspace slug, locally.
  // The first app is created by the CLI or the New app wizard — both real.
  const finish = (to: '/dashboard' | '/dashboard/workflows/new') => {
    saveWorkspace(workspace);
    markOnboarded();
    toast({ kind: 'success', title: 'Workspace ready', description: workspace });
    // The biggest context switch in the product — setup handing off to the app.
    sweepNavigate(to);
  };

  const beamIntensity = step === 1 ? 0.55 : 0.22;

  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <PixelBeams className="inset-0" intensity={beamIntensity} />

      {/* Veils the centre column the content occupies, leaving the beams
          legible down both margins. Paper rather than ink now that onboarding
          sits on the light side of the split. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'linear-gradient(to right, rgba(251,252,251,0.28) 0%, rgba(251,252,251,0.91) 26%, rgba(251,252,251,0.91) 74%, rgba(251,252,251,0.28) 100%)',
        }}
      />

      <header className="relative flex items-center justify-between border-b border-border px-5 py-4 sm:px-8">
        <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
        <span className="text-xs text-muted-foreground">{user?.email}</span>
      </header>

      <div className="relative mx-auto max-w-2xl px-5 py-10 sm:py-16">
        <StepRail current={step} />

        <div className="mt-10">
          <AnimatePresence mode="wait" initial={false}>
            {/* ---------- Step 1: workspace ---------- */}
            {step === 0 && (
              <motion.div
                key="workspace"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <h1 className="text-2xl font-semibold tracking-tight">Name your workspace</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  This becomes the namespace for every app you deploy.
                </p>

                <label htmlFor="workspace" className="label-mono mt-8 block text-muted-foreground">
                  Workspace slug
                </label>
                <div className="mt-2 flex items-center rounded-lg border border-border bg-card focus-within:border-brand focus-within:ring-2 focus-within:ring-brand/25">
                  <span className="pl-3.5 font-mono text-sm text-muted-foreground">
                    gregale.run/
                  </span>
                  <input
                    id="workspace"
                    autoFocus
                    value={workspace}
                    onChange={(e) => setWorkspace(e.target.value.toLowerCase())}
                    className="h-11 flex-1 bg-transparent pr-3.5 font-mono text-sm outline-none"
                  />
                </div>
                <p
                  className="mt-2 text-xs"
                  style={{ color: slugValid ? undefined : 'var(--status-critical)' }}
                >
                  {slugValid
                    ? 'Lowercase letters, numbers, and dashes.'
                    : 'Must be 3–32 characters: lowercase letters, numbers, and dashes.'}
                </p>

                <div className="mt-8 flex justify-end">
                  <Button
                    variant="cta"
                    disabled={!slugValid}
                    onClick={() => setStep(1)}
                    className="h-10 gap-2 rounded-lg"
                  >
                    Continue
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ---------- Step 2: first app, the honest version ---------- */}
            {step === 1 && (
              <motion.div
                key="first-app"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.25, ease: EASE }}
              >
                <h1 className="text-2xl font-semibold tracking-tight">Deploy your first app</h1>
                <p className="mt-2 text-sm text-muted-foreground">
                  Three commands in a terminal, or the guided flow in the console. Both end with an
                  app that is live and scaled to zero.
                </p>

                <ol className="mt-8 flex flex-col rounded-xl border border-border bg-card">
                  {CLI_STEPS.map((cliStep, i) => (
                    <li
                      key={cliStep.command}
                      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-4 last:border-0"
                    >
                      <span
                        aria-hidden
                        className="label-mono flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground"
                      >
                        {i + 1}
                      </span>
                      <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-center gap-2">
                          <span aria-hidden className="font-mono text-sm text-brand">
                            $
                          </span>
                          <code className="truncate font-mono text-sm text-foreground">
                            {cliStep.command}
                          </code>
                          <CopyIconButton text={cliStep.command} label={cliStep.command} />
                        </div>
                        <p className="text-xs text-muted-foreground">{cliStep.caption}</p>
                      </div>
                    </li>
                  ))}
                </ol>

                <div className="mt-8 flex items-center justify-between">
                  <Button variant="ghost" onClick={() => setStep(0)} className="gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back
                  </Button>
                  <div className="flex items-center gap-2">
                    <Button variant="ghost" onClick={() => finish('/dashboard')}>
                      Go to dashboard
                    </Button>
                    <Button
                      variant="cta"
                      onClick={() => finish('/dashboard/workflows/new')}
                      className="h-10 gap-2 rounded-lg"
                    >
                      Create an app in the console
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
