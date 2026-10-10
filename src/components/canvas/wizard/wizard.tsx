import { useEffect, useRef, type ReactNode, type Ref } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { ArrowLeft } from 'iconoir-react';
import { StepStart } from './step-start';
import { StepSource } from './step-source';
import { StepGit } from './step-git';
import { StepCli } from './step-cli';
import type { CreateKind } from '../create';

export type WizardStep = 'start' | 'source' | 'git' | 'cli';
export type LaunchSeed = {
  slug: string;
  source: 'git' | 'cli';
  repo?: string;
  ref?: string;
  deploymentId?: string;
  submitError?: string;
  /** Bumped by each retry, so a retry that fails the same way still restarts tracking. */
  attempt?: number;
};

const BACK: Record<WizardStep, WizardStep | undefined> = {
  start: undefined,
  source: 'start',
  git: 'source',
  cli: 'source',
};
const CRUMB: Record<WizardStep, string | undefined> = {
  start: undefined,
  source: 'Build your backend',
  git: 'Where does your code live?',
  cli: 'Where does your code live?',
};

export function Wizard({
  step,
  mode,
  apps,
  onStep,
  onLaunched,
  onPickExisting,
  cardRef,
}: {
  step: WizardStep;
  mode: 'empty' | 'new';
  apps: string[];
  onStep: (step: WizardStep | undefined) => void;
  onLaunched: (launch: LaunchSeed) => void;
  onPickExisting: (slug: string, kind: CreateKind) => void;
  cardRef?: Ref<HTMLDivElement>;
}) {
  const reduce = useReducedMotion();
  const latest = useRef({ step, mode, onStep });
  useEffect(() => {
    latest.current = { step, mode, onStep };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const { step, mode, onStep } = latest.current;
      const back = BACK[step];
      if (back) onStep(back);
      else if (mode === 'new') onStep(undefined);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const body: Record<WizardStep, ReactNode> = {
    start: (
      <StepStart
        mode={mode}
        apps={apps}
        onDeploy={() => onStep('source')}
        onPickExisting={onPickExisting}
      />
    ),
    source: <StepSource onPick={(s) => onStep(s)} />,
    git: <StepGit onLaunched={onLaunched} />,
    cli: <StepCli onLaunched={onLaunched} />,
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
      <div
        ref={cardRef}
        role="dialog"
        aria-modal={mode === 'empty'}
        aria-label="Build your backend"
        className="pointer-events-auto relative w-[440px] rounded-2xl border border-canvas-glass-border bg-canvas-glass p-6 shadow-elevation-3 backdrop-blur-xl"
      >
        <span
          aria-hidden
          className="absolute inset-x-6 top-0 h-px bg-[linear-gradient(90deg,transparent,var(--brand),transparent)] opacity-80"
        />
        {CRUMB[step] && (
          <button
            type="button"
            onClick={() => onStep(BACK[step])}
            className="-mt-1 mb-3 -ml-2 inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ArrowLeft aria-hidden className="size-3" /> {CRUMB[step]}
          </button>
        )}
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={reduce ? { opacity: 0 } : { opacity: 0, x: 8, y: -8 }}
            animate={{ opacity: 1, x: 0, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0.15 : 0.24, ease: [0.16, 1, 0.3, 1] }}
          >
            {body[step]}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}
