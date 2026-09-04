import { useState, type ReactNode } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Eye,
  EyeClosed,
  MailOpen,
  WarningCircle,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { Panel } from '@/components/dashboard/primitives';
import { EASE } from '@/components/dashboard/motion';
import { MIN_PASSWORD_LENGTH, useAuth } from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { setAccountPassword } from '@/lib/api/password';
import { cn } from '@/lib/utils';

/**
 * Email sign-in for an account that reached the console through Google or
 * GitHub.
 *
 * The API exposes exactly one write here — set a password — and no way to ask
 * whether the account already has one. So the wizard does not pretend to know:
 * the idle state offers both doors, and the reset link is the honest route for
 * someone who wants to *change* a password, since that is the only server path
 * that re-verifies anything. A "current password" step would be theatre.
 */

type Step = 'idle' | 'choose' | 'confirm' | 'done' | 'reset-sent';

const STEPS: { key: Step; label: string }[] = [
  { key: 'choose', label: 'Choose' },
  { key: 'confirm', label: 'Confirm' },
  { key: 'done', label: 'Done' },
];

const FIELD =
  'h-9 w-full rounded-md border border-border bg-background pl-3 pr-10 text-sm outline-none transition-colors focus:border-brand/50';

function StepRail({ current }: { current: Step }) {
  const at = STEPS.findIndex((s) => s.key === current);
  return (
    <ol className="mb-5 flex items-center gap-2" aria-label="Progress">
      {STEPS.map((s, i) => {
        const reached = i <= at;
        return (
          <li key={s.key} className="flex items-center gap-2">
            <span
              aria-current={i === at ? 'step' : undefined}
              className={cn(
                'flex h-5 min-w-5 items-center justify-center rounded-full border px-1 font-mono text-[10px] transition-colors ease-console',
                reached
                  ? 'border-brand/40 bg-brand/10 text-brand'
                  : 'border-border text-muted-foreground'
              )}
            >
              {i < at ? <Check className="h-3 w-3" /> : i + 1}
            </span>
            <span
              className={cn(
                'label-mono transition-colors ease-console',
                reached ? 'text-foreground' : 'text-muted-foreground'
              )}
            >
              {s.label}
            </span>
            {i < STEPS.length - 1 && <span className="mx-1 h-px w-6 bg-border" aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  onBlur,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur?: () => void;
  autoComplete: string;
  invalid?: boolean;
  describedBy?: string;
}) {
  const [reveal, setReveal] = useState(false);
  return (
    <div className="flex max-w-sm flex-col gap-1.5">
      <label htmlFor={id} className="label-mono text-muted-foreground">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          type={reveal ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          autoComplete={autoComplete}
          autoFocus
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className={cn(FIELD, invalid && 'border-[color:var(--status-critical)]')}
        />
        <button
          type="button"
          onClick={() => setReveal((v) => !v)}
          aria-label={reveal ? 'Hide password' : 'Show password'}
          className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
        >
          {reveal ? <EyeClosed className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}

function Refusal({ message }: { message: string }) {
  return (
    <p
      role="alert"
      key={message}
      className="animate-shake flex max-w-sm items-start gap-2 rounded-md border px-3 py-2 text-xs"
      style={{
        color: 'var(--status-critical)',
        borderColor: 'color-mix(in oklab, var(--status-critical) 35%, transparent)',
      }}
    >
      <WarningCircle className="mt-px h-3.5 w-3.5 shrink-0" />
      {message}
    </p>
  );
}

function BackLink({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="h-3.5 w-3.5" />
      {children}
    </button>
  );
}

export function PasswordWizard({
  email,
  setPassword,
  requestReset,
  onSet,
}: {
  email: string;
  /** Rejects with an `ApiError`; a 400 is the length rule. */
  setPassword: (password: string) => Promise<void>;
  /** Always resolves — the server answers identically for an unknown address. */
  requestReset: (email: string) => Promise<void>;
  /** Fired once the password has landed, for the page-level toast. */
  onSet?: () => void;
}) {
  const reduce = useReducedMotion();
  const [step, setStep] = useState<Step>('idle');
  const [chosen, setChosen] = useState('');
  const [retyped, setRetyped] = useState('');
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longEnough = chosen.length >= MIN_PASSWORD_LENGTH;
  const tooShort = chosen.length > 0 && !longEnough;
  const matches = retyped === chosen;
  const mismatch = touched && retyped.length > 0 && !matches;

  const go = (next: Step) => {
    setError(null);
    setStep(next);
  };
  const reset = () => {
    setChosen('');
    setRetyped('');
    setTouched(false);
    go('idle');
  };

  const submit = async () => {
    if (!matches || !longEnough || pending) return;
    setPending(true);
    setError(null);
    try {
      await setPassword(chosen);
      setChosen('');
      setRetyped('');
      setTouched(false);
      setStep('done');
      onSet?.();
    } catch (err) {
      // The length rule is the one refusal worth restating as a rule rather
      // than a rejection. Branch on the code: a 400 can also be a stale CSRF
      // token, and that one wants the server's "reload and try again".
      if (err instanceof ApiError && err.code === 'password_too_weak') {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setPending(false);
    }
  };

  const sendReset = async () => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await requestReset(email);
      setStep('reset-sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const slide = reduce
    ? { initial: false as const, animate: {}, exit: {} }
    : {
        initial: { opacity: 0, x: 12 },
        animate: { opacity: 1, x: 0 },
        exit: { opacity: 0, x: -12 },
        transition: { duration: 0.28, ease: EASE },
      };

  return (
    <Panel
      title="Email sign-in"
      description="Accounts created through Google or GitHub have no password. Adding one lets you sign in with email as well, without touching the provider link."
    >
      <AnimatePresence mode="wait" initial={false}>
        {step === 'idle' && (
          <motion.div key="idle" {...slide} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" className="gap-1.5" onClick={() => go('choose')}>
                Set a password
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={() => void sendReset()}
                disabled={pending}
                className="text-sm text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
              >
                Already have one? Email me a reset link
              </button>
            </div>
            {error && <Refusal message={error} />}
          </motion.div>
        )}

        {step === 'choose' && (
          <motion.form
            key="choose"
            {...slide}
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              if (longEnough) go('confirm');
            }}
          >
            <StepRail current="choose" />
            <PasswordField
              id="password-new"
              label="New password"
              value={chosen}
              onChange={setChosen}
              autoComplete="new-password"
              invalid={tooShort}
              describedBy="password-rule"
            />
            <p
              id="password-rule"
              className="text-xs"
              style={tooShort ? { color: 'var(--status-critical)' } : undefined}
            >
              <span className={tooShort ? undefined : 'text-muted-foreground'}>
                At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule.
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="sm" className="gap-1.5" disabled={!longEnough}>
                Continue
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
              <BackLink onClick={reset}>Cancel</BackLink>
            </div>
          </motion.form>
        )}

        {step === 'confirm' && (
          <motion.form
            key="confirm"
            {...slide}
            className="flex flex-col gap-4"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
          >
            <StepRail current="confirm" />
            <PasswordField
              id="password-confirm"
              label="Confirm password"
              value={retyped}
              onChange={setRetyped}
              onBlur={() => setTouched(true)}
              autoComplete="new-password"
              invalid={mismatch}
              describedBy={mismatch ? 'password-mismatch' : undefined}
            />
            {mismatch && (
              <p
                id="password-mismatch"
                className="text-xs"
                style={{ color: 'var(--status-critical)' }}
              >
                The two passwords do not match.
              </p>
            )}
            {error && <Refusal message={error} />}
            <div className="flex flex-wrap items-center gap-3">
              <Button
                type="submit"
                size="sm"
                variant="cta"
                className="gap-1.5"
                disabled={!matches || retyped.length === 0}
                busy={pending}
              >
                Set password
                <Check className="h-3.5 w-3.5" />
              </Button>
              <BackLink
                onClick={() => {
                  setRetyped('');
                  setTouched(false);
                  go('choose');
                }}
              >
                Back
              </BackLink>
            </div>
          </motion.form>
        )}

        {step === 'done' && (
          <motion.div key="done" {...slide} className="flex flex-col gap-4">
            <StepRail current="done" />
            <div className="flex items-start gap-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
                style={{
                  color: 'var(--status-good)',
                  borderColor: 'color-mix(in oklab, var(--status-good) 35%, transparent)',
                }}
              >
                <Check className="h-4 w-4" />
              </span>
              <div>
                <p className="text-sm">Email sign-in is on.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  You can now sign in as <span className="text-foreground">{email}</span> with this
                  password. Google and GitHub still work too.
                </p>
              </div>
            </div>
            <div>
              <Button size="sm" variant="outline" onClick={reset}>
                Done
              </Button>
            </div>
          </motion.div>
        )}

        {step === 'reset-sent' && (
          <motion.div key="reset-sent" {...slide} className="flex flex-col gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background">
                <MailOpen className="h-4 w-4 text-brand" />
              </span>
              <div>
                <p className="text-sm">Check your email.</p>
                {/* The server answers identically for an unregistered address,
                    so this must not promise that an email is definitely coming. */}
                <p className="mt-1 text-xs text-muted-foreground">
                  If <span className="text-foreground">{email}</span> is registered, a link to set a
                  new password is on its way.
                </p>
              </div>
            </div>
            <div>
              <BackLink onClick={reset}>Back</BackLink>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Panel>
  );
}

/** The wizard wired to the session — what the account page renders. */
export function PasswordPanel() {
  const { account, user, requestPasswordReset } = useAuth();
  const { toast } = useToast();
  const email = account?.email ?? user?.email ?? '';
  return (
    <PasswordWizard
      email={email}
      setPassword={setAccountPassword}
      requestReset={requestPasswordReset}
      onSet={() =>
        toast({
          kind: 'success',
          title: 'Password set',
          description: 'Email sign-in now works too.',
        })
      }
    />
  );
}
