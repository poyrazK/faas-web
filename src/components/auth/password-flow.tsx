import { useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { Link } from '@tanstack/react-router';
import { useSweepNavigate } from '@/components/sweep-link';
import {
  WarningCircle,
  ArrowLeft,
  ArrowRight,
  Eye,
  EyeClosed,
  RefreshDouble,
  MailOpen,
} from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import {
  hasOnboarded,
  isValidEmail,
  markOAuthPending,
  MIN_PASSWORD_LENGTH,
  useAuth,
} from '@/lib/auth';
import { ApiError, errorMessage } from '@/lib/api/errors';

/**
 * Email + password against `POST /login` and `POST /signup`.
 *
 * This replaced a mock one-time-code flow. The real API has no OTP endpoint —
 * the code path it does expose (`/v1/account/mfa/*`) is step-up MFA for an
 * account that already exists, not a way to sign in.
 *
 * The sign-in and sign-up errors are deliberately indistinguishable here
 * because they are indistinguishable on the server: unbound email, wrong
 * password, and an OAuth-only account all answer 401 `invalid_credentials`, so
 * the surface cannot be used to enumerate accounts. Do not "improve" this by
 * telling the user which half was wrong — the server does not tell us.
 */

const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

type Step = 'credentials' | 'forgot' | 'forgot-sent';

const COPY = {
  signin: {
    title: 'Sign in to Gregale',
    subtitle: 'Use your email and password to reach the console.',
    cta: 'Sign in',
    pendingLabel: 'Signing in…',
    switchText: 'New to Gregale?',
    switchLabel: 'Create an account',
    switchTo: '/signup' as const,
    passwordAutoComplete: 'current-password',
  },
  signup: {
    title: 'Create your workspace',
    subtitle: 'Start with 1M invocations free every month. No credit card.',
    cta: 'Create account',
    pendingLabel: 'Creating account…',
    switchText: 'Already have an account?',
    switchLabel: 'Sign in',
    switchTo: '/login' as const,
    passwordAutoComplete: 'new-password',
  },
};

/**
 * OAuth consent is a full-page navigation, not a fetch — the provider sets its
 * own cookies and redirects back to `/v1/auth/<provider>/callback`, which lands
 * the session cookie. `window.location` rather than the router for that reason.
 *
 * Both buttons render unconditionally. `GET /v1/auth/capabilities` reports
 * which providers the box has configured, but it sits behind the session
 * cookie and 302s to `/login` when signed out — so it cannot be consulted from
 * the sign-in screen. A provider that is switched off answers the consent route
 * with 503 `oauth_provider_unavailable`, which surfaces as a normal error.
 */
function ssoHref(provider: 'google' | 'github'): string {
  return `/v1/auth/${provider}`;
}

function SsoButton({ label, provider }: { label: string; provider: 'google' | 'github' }) {
  return (
    <a
      href={ssoHref(provider)}
      onClick={markOAuthPending}
      className="flex h-10 flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card text-sm transition-colors hover:border-border-secondary hover:bg-muted"
    >
      {label}
    </a>
  );
}

function FormError({ message }: { message: string }) {
  return (
    <p
      role="alert"
      // Keyed by message where rendered, so a repeated refusal shakes again —
      // the box saying "no" physically. Reduced motion lands it still.
      key={message}
      className="animate-shake mt-3 flex items-start gap-2 rounded-lg border px-3 py-2 text-xs"
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

export function PasswordFlow({
  mode,
  redirectTo,
}: {
  mode: 'signin' | 'signup';
  redirectTo?: string;
}) {
  const copy = COPY[mode];
  const sweepNavigate = useSweepNavigate();
  const { toast } = useToast();
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const reduce = useReducedMotion();

  const [step, setStep] = useState<Step>('credentials');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [reveal, setReveal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);

  const emailValid = isValidEmail(email);
  const showEmailError = touched && email.length > 0 && !emailValid;
  // Only enforced client-side on signup: the sign-in form must accept whatever
  // the account was created with, including passwords older than the rule.
  const passwordTooShort =
    mode === 'signup' && password.length > 0 && password.length < MIN_PASSWORD_LENGTH;
  const canSubmit = emailValid && password.length > 0 && !passwordTooShort;

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const user =
        mode === 'signup' ? await signUp(email, password) : await signIn(email, password);
      toast({ kind: 'success', title: `Welcome, ${user.name.split(' ')[0]}` });
      if (redirectTo) {
        // A full navigation is intentional: the CLI authorization page is a
        // server-rendered endpoint, and must receive the HttpOnly session
        // cookie through the public-origin proxy before it can be submitted.
        window.location.assign(redirectTo);
        return;
      }
      sweepNavigate(hasOnboarded() ? '/dashboard' : '/onboarding');
    } catch (err) {
      // A weak password on signup is the one case the server does distinguish,
      // and the only one worth restating as a rule rather than a rejection.
      if (err instanceof ApiError && err.status === 400) {
        setError(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
      } else {
        setError(errorMessage(err));
      }
      setPassword('');
    } finally {
      setPending(false);
    }
  };

  const sendReset = async () => {
    setPending(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setStep('forgot-sent');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  };

  const enter = (x: number) =>
    reduce
      ? { initial: false as const, animate: {}, exit: {} }
      : {
          initial: { opacity: 0, x },
          animate: { opacity: 1, x: 0 },
          exit: { opacity: 0, x },
          transition: { duration: 0.28, ease: EASE },
        };

  const emailField = (
    <>
      <label htmlFor="email" className="label-mono text-muted-foreground">
        Work email
      </label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        autoFocus
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        onBlur={() => setTouched(true)}
        aria-invalid={showEmailError || undefined}
        aria-describedby={showEmailError ? 'email-error' : undefined}
        placeholder="you@company.com"
        className={`mt-2 h-11 w-full rounded-lg border bg-card px-3.5 text-sm outline-none transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-brand/25 ${
          showEmailError
            ? 'border-[color:var(--status-critical)]'
            : 'border-border focus:border-brand'
        }`}
      />
      {showEmailError && (
        <p id="email-error" className="mt-2 text-xs" style={{ color: 'var(--status-critical)' }}>
          Enter a valid email address.
        </p>
      )}
    </>
  );

  if (step !== 'credentials') {
    return (
      <AnimatePresence mode="wait" initial={false}>
        {step === 'forgot' ? (
          <motion.div key="forgot" {...enter(12)}>
            <h1 className="text-2xl font-semibold tracking-tight">Reset your password</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              We will email you a link to set a new one.
            </p>

            <form
              className="mt-7"
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                setTouched(true);
                if (emailValid && !pending) void sendReset();
              }}
            >
              {emailField}
              {error && <FormError message={error} />}
              <Button
                type="submit"
                variant="cta"
                disabled={pending}
                className="mt-5 h-11 w-full gap-2 rounded-lg"
              >
                {pending ? (
                  <>
                    <RefreshDouble className="h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    Send reset link
                    <ArrowRight className="h-4 w-4" />
                  </>
                )}
              </Button>
            </form>

            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setError(null);
              }}
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          </motion.div>
        ) : (
          <motion.div key="forgot-sent" {...enter(12)}>
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-border bg-card">
              <MailOpen className="h-4 w-4 text-brand" />
            </span>
            <h1 className="mt-5 text-2xl font-semibold tracking-tight">Check your email</h1>
            {/* The server answers identically for an unregistered address, so
                this copy must not promise that an email is definitely coming. */}
            <p className="mt-2 text-sm text-muted-foreground">
              If <span className="text-foreground">{email}</span> is registered, a reset link is on
              its way.
            </p>
            <button
              type="button"
              onClick={() => {
                setStep('credentials');
                setError(null);
              }}
              className="mt-6 inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back to sign in
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    );
  }

  return (
    <motion.div key="credentials" {...enter(-12)}>
      <h1 className="text-2xl font-semibold tracking-tight">{copy.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{copy.subtitle}</p>

      <div className="mt-7 flex gap-2">
        <SsoButton label="GitHub" provider="github" />
        <SsoButton label="Google" provider="google" />
      </div>

      <div className="my-6 flex items-center gap-3">
        <span className="h-px flex-1 bg-border" />
        <span className="label-mono text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (canSubmit && !pending) void submit();
        }}
        noValidate
      >
        {emailField}

        <div className="mt-4 flex items-baseline justify-between">
          <label htmlFor="password" className="label-mono text-muted-foreground">
            Password
          </label>
          {mode === 'signin' && (
            <button
              type="button"
              onClick={() => {
                setStep('forgot');
                setError(null);
              }}
              className="text-xs text-brand transition-colors hover:text-brand-hover"
            >
              Forgot?
            </button>
          )}
        </div>

        <div className="relative mt-2">
          <input
            id="password"
            type={reveal ? 'text' : 'password'}
            autoComplete={copy.passwordAutoComplete}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={passwordTooShort || undefined}
            aria-describedby={mode === 'signup' ? 'password-hint' : undefined}
            placeholder={
              mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters` : '••••••••'
            }
            className={`h-11 w-full rounded-lg border bg-card pl-3.5 pr-11 text-sm outline-none transition-all placeholder:text-muted-foreground focus:ring-2 focus:ring-brand/25 ${
              passwordTooShort
                ? 'border-[color:var(--status-critical)]'
                : 'border-border focus:border-brand'
            }`}
          />
          <button
            type="button"
            onClick={() => setReveal((v) => !v)}
            aria-label={reveal ? 'Hide password' : 'Show password'}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
          >
            {reveal ? <EyeClosed className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>

        {mode === 'signup' && (
          <p
            id="password-hint"
            className="mt-2 text-xs"
            style={passwordTooShort ? { color: 'var(--status-critical)' } : undefined}
          >
            <span className={passwordTooShort ? undefined : 'text-muted-foreground'}>
              At least {MIN_PASSWORD_LENGTH} characters. Length is the only rule.
            </span>
          </p>
        )}

        {error && <FormError message={error} />}

        <Button
          type="submit"
          variant="cta"
          disabled={pending}
          className="mt-5 h-11 w-full gap-2 rounded-lg"
        >
          {pending ? (
            <>
              <RefreshDouble className="h-4 w-4 animate-spin" />
              {copy.pendingLabel}
            </>
          ) : (
            <>
              {copy.cta}
              <ArrowRight className="h-4 w-4" />
            </>
          )}
        </Button>
      </form>

      <p className="mt-6 text-sm text-muted-foreground">
        {copy.switchText}{' '}
        <Link to={copy.switchTo} className="text-brand hover:text-brand-hover">
          {copy.switchLabel}
        </Link>
      </p>
    </motion.div>
  );
}
