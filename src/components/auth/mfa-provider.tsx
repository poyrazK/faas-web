import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
import { Modal } from '@/components/ui/modal';
import { Button } from '@/components/ui/button';
import { CopyMorph, useCopy } from '@/components/ui/copy-button';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  confirmMfa,
  disableMfa,
  enrollMfa,
  recoverMfa,
  requestMfaRecoveryEmail,
  verifyMfa,
  type MFAEnrollment,
} from '@/lib/api/queries';
import { setMfaRequiredHandler } from '@/lib/api/client';
import { useQueryClient } from '@tanstack/react-query';

type MfaMode = 'choose' | 'confirm' | 'verify' | 'recover' | 'email-recovery';

/**
 * Enrollment, an authenticator code and a saved recovery code all establish
 * recent MFA. Callers can report the method without demanding another code.
 */
export type MfaMethod = 'authenticator' | 'recovery' | 'enrolment';

interface MfaOpenOptions {
  /** Why the modal opened, shown above the form — the gate that asked for it. */
  reason?: string;
  /** After a successful confirm / verify / recover, with the method that was used. */
  onVerified?: (via: MfaMethod) => void;
  /** The modal closed without success. */
  onDismissed?: () => void;
  /**
   * Whether to offer recovery choices. Defaults to true.
   */
  allowRecovery?: boolean;
}

interface MfaContextValue {
  openMfa: (mode?: MfaMode, opts?: MfaOpenOptions) => void;
}

const MfaContext = createContext<MfaContextValue | null>(null);

export function useMfa() {
  const context = useContext(MfaContext);
  if (!context) throw new Error('useMfa must be used inside <MfaProvider>');
  return context;
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, '').slice(0, 6);
}

export function MfaProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [open, setOpenState] = useState(false);
  // Read by handleMfaRequired, which runs from fetch callbacks: a burst of
  // refused requests lands before React re-renders, so it needs the value as
  // of the last call, not of the last render.
  const openRef = useRef(false);
  const setOpen = useCallback((next: boolean) => {
    openRef.current = next;
    setOpenState(next);
  }, []);
  const [mode, setMode] = useState<MfaMode>('choose');
  const [enrollment, setEnrollment] = useState<MFAEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [lastRecoveryCode, setLastRecoveryCode] = useState(false);
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [required, setRequired] = useState(false);
  const pending = useRef<MfaOpenOptions | null>(null);
  // When the session last got through (`performance.now()`). Requests sent
  // before then carried the pending cookie and are still being refused as
  // they land; those refusals are stale and must not reopen the modal.
  const verifiedAt = useRef(Number.NEGATIVE_INFINITY);
  const [reason, setReason] = useState<string | null>(null);
  const [allowRecovery, setAllowRecovery] = useState(true);

  const resetTransient = useCallback(() => {
    setEnrollment(null);
    setCode('');
    setCurrentPassword('');
    setLastRecoveryCode(false);
    setEmailSent(false);
    setError(null);
  }, []);

  const openMfa = useCallback(
    (nextMode: MfaMode = 'choose', opts?: MfaOpenOptions) => {
      resetTransient();
      setRequired(false);
      pending.current = opts ?? null;
      setReason(opts?.reason ?? null);
      setAllowRecovery(opts?.allowRecovery ?? true);
      setMode(nextMode);
      setOpen(true);
    },
    [resetTransient, setOpen]
  );

  /**
   * An API answer of `mfa_required`. While the session is mfa_pending, every
   * request gets one — each poll, each retry, and every query refetched when
   * the window regains focus, which is the moment someone returns from their
   * authenticator app with a code. Only the first may open the modal. Once it
   * is open, a later one must not touch it: resetting it here wiped the code
   * mid-typing, dropped the setup QR (whose secret the app had already
   * scanned), and lost a step-up's reason and callback. Verifying clears the
   * session gate whichever screen it is done from, so marking the session
   * required is all that is left to do.
   *
   * The same burst outlives a successful verify: requests sent with the
   * pending cookie keep landing after it is re-issued, and each would open the
   * modal again the moment it closed. A refusal of a request that started
   * before the last verification is ignored.
   */
  const handleMfaRequired = useCallback(
    (requestStartedAt: number) => {
      if (requestStartedAt < verifiedAt.current) return;
      setRequired(true);
      if (openRef.current) return;
      pending.current = null;
      setReason(null);
      setAllowRecovery(true);
      resetTransient();
      setMode('choose');
      setOpen(true);
    },
    [resetTransient, setOpen]
  );

  useEffect(() => {
    setMfaRequiredHandler(handleMfaRequired);
    return () => setMfaRequiredHandler(null);
  }, [handleMfaRequired]);

  const close = useCallback(() => {
    if (busy) return;
    setOpen(false);
    const cb = pending.current;
    pending.current = null;
    cb?.onDismissed?.();
  }, [busy, setOpen]);

  const startEnrollment = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await enrollMfa();
      setEnrollment(result);
      setCode('');
      setMode('confirm');
    } catch (err: unknown) {
      // A pending session can already have an enrolled authenticator. In that
      // case the API deliberately answers 409; route the user to verification
      // without making them decipher the conflict response.
      if (err instanceof ApiError && err.status === 409) {
        setMode('verify');
        setCode('');
      } else {
        setError(errorMessage(err));
      }
    } finally {
      setBusy(false);
    }
  }, []);

  const complete = useCallback(
    async (via: MfaMethod) => {
      verifiedAt.current = performance.now();
      setBusy(false);
      setOpen(false);
      setRequired(false);
      resetTransient();
      // A blocked query remains cached as an error. Refetch every resource so
      // the page that triggered the gate recovers immediately after the cookie
      // is re-issued without mfa_pending. Cancel first: a poll sent just
      // before the verify answer landed still carries the pending cookie and
      // will be refused, and invalidating alone reuses that in-flight request
      // for a query with no data yet — so the page would keep the refusal
      // until its next poll, or for good on a query that does not poll.
      await queryClient.cancelQueries();
      await queryClient.invalidateQueries();
      const cb = pending.current;
      pending.current = null;
      cb?.onVerified?.(via);
    },
    [queryClient, resetTransient, setOpen]
  );

  const submit = useCallback(
    async (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setError(null);

      if ((mode === 'confirm' || mode === 'verify') && code.length !== 6) {
        setError('Enter the six-digit code from your authenticator app.');
        return;
      }
      if (mode === 'recover' && code.trim().length === 0) {
        setError('Enter one of your recovery codes.');
        return;
      }

      setBusy(true);
      try {
        if (mode === 'email-recovery') {
          await requestMfaRecoveryEmail();
          setEmailSent(true);
          setBusy(false);
          return;
        }
        let via: MfaMethod = 'authenticator';
        if (mode === 'confirm') {
          await confirmMfa(code, currentPassword || undefined);
          via = 'enrolment';
        } else if (mode === 'verify') await verifyMfa(code);
        else if (mode === 'recover') {
          await recoverMfa(code.trim().toUpperCase());
          via = 'recovery';
        }
        await complete(via);
      } catch (err: unknown) {
        setLastRecoveryCode(err instanceof ApiError && err.code === 'mfa_last_recovery_code');
        setError(
          mode === 'confirm' && err instanceof ApiError && err.code === 'invalid_credentials'
            ? 'Enter your current password to finish authenticator setup.'
            : errorMessage(err)
        );
        setBusy(false);
      }
    },
    [code, complete, currentPassword, mode]
  );

  const context = useMemo(() => ({ openMfa }), [openMfa]);

  return (
    <MfaContext.Provider value={context}>
      {children}
      <Modal
        open={open}
        onClose={close}
        title={
          mode === 'choose'
            ? required
              ? 'Additional verification required'
              : reason
                ? 'Multi-factor authentication required'
                : 'Protect your account with MFA'
            : 'Multi-factor authentication'
        }
        description={
          mode === 'email-recovery'
            ? 'Receive a recovery link at your account email.'
            : mode === 'confirm'
              ? 'Confirm your new authenticator and save your recovery codes.'
              : mode === 'choose'
                ? required
                  ? 'This session needs MFA before the dashboard can load.'
                  : reason
                    ? 'This action needs a recent code from your authenticator app.'
                    : 'MFA is optional. Set it up when you want extra protection for your account.'
                : allowRecovery
                  ? 'Use an authenticator app or a saved recovery code to continue.'
                  : 'Use your authenticator app to continue.'
        }
        width="max-w-lg"
      >
        {reason && <p className="mb-4 text-sm font-medium leading-relaxed">{reason}</p>}
        {mode === 'choose' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              {required
                ? 'MFA adds a second factor to your Gregale account. Set up an authenticator if this is your first time, or verify an existing one to unlock the dashboard.'
                : reason
                  ? 'Set up an authenticator if this is your first time, or enter a code from the one you already use.'
                  : 'MFA adds a second factor to your Gregale account. Set up an authenticator now to require a code whenever you sign in from a new dashboard session.'}
            </p>
            {error && <InlineError message={error} />}
            <div className="grid gap-2 sm:grid-cols-2">
              <Button onClick={() => void startEnrollment()} disabled={busy}>
                Set up authenticator
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setError(null);
                  setCode('');
                  setMode('verify');
                }}
              >
                Enter authenticator code
              </Button>
            </div>
            {allowRecovery && (
              <SwitchMode
                onClick={() => {
                  setError(null);
                  setCode('');
                  setMode('recover');
                }}
              >
                Use a recovery code instead
              </SwitchMode>
            )}
          </div>
        )}

        {mode === 'confirm' && enrollment && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Scan this QR code with your authenticator app, save the recovery codes, then enter the
              six-digit code it generates.
            </p>
            <div className="flex justify-center rounded-lg border border-border bg-white p-4">
              <img
                src={`data:image/png;base64,${enrollment.qr_code_png_base64}`}
                alt="Authenticator setup QR code"
                className="h-48 w-48"
              />
            </div>
            <CopyRow label="Manual setup key" value={enrollment.secret} />
            <div className="rounded-lg border border-border bg-muted/40 p-3">
              <div className="flex items-center justify-between gap-3">
                <p className="label-mono text-muted-foreground">Recovery codes</p>
                <CopyButton value={enrollment.recovery_codes.join('\n')} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                Each code works once. Store these somewhere safe before continuing.
              </p>
              <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 font-mono text-xs">
                {enrollment.recovery_codes.map((recoveryCode) => (
                  <code key={recoveryCode}>{recoveryCode}</code>
                ))}
              </div>
            </div>
            <MfaForm
              code={code}
              onCodeChange={setCode}
              onSubmit={submit}
              busy={busy}
              error={error}
              submitLabel="Confirm MFA"
              hint="Enter the current six-digit code."
              currentPassword={currentPassword}
              onPasswordChange={setCurrentPassword}
            />
          </div>
        )}

        {mode === 'verify' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Open your authenticator app and enter the current six-digit code for Gregale.
            </p>
            <MfaForm
              code={code}
              onCodeChange={(value) => setCode(digitsOnly(value))}
              onSubmit={submit}
              busy={busy}
              error={error}
              submitLabel="Verify and continue"
              hint="Codes change every 30 seconds."
            />
            {allowRecovery && (
              <SwitchMode
                onClick={() => {
                  setError(null);
                  setCode('');
                  setMode('recover');
                }}
              >
                Use a recovery code instead
              </SwitchMode>
            )}
          </div>
        )}

        {mode === 'recover' && (
          <div className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Enter one saved recovery code. It will be consumed and cannot be used again.
            </p>
            <form onSubmit={submit} className="space-y-3">
              <label htmlFor="mfa-recovery-code" className="label-mono text-muted-foreground">
                Recovery code
              </label>
              <input
                id="mfa-recovery-code"
                value={code}
                onChange={(event) => {
                  setLastRecoveryCode(false);
                  setCode(event.target.value.toUpperCase());
                }}
                autoComplete="one-time-code"
                autoFocus
                spellCheck={false}
                className="h-10 w-full rounded-md border border-input bg-background px-3 font-mono text-sm uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              />
              {error && <InlineError message={error} />}
              {lastRecoveryCode && (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setBusy(true);
                    void disableMfa({ recovery_code: code.trim().toUpperCase() })
                      .then(() => {
                        setCode('');
                        setLastRecoveryCode(false);
                        setMode('choose');
                        return startEnrollment();
                      })
                      .catch((err: unknown) => {
                        setError(errorMessage(err));
                        setBusy(false);
                      });
                  }}
                >
                  Reset authenticator with this code
                </Button>
              )}
              <div className="flex justify-end gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setError(null);
                    setCode('');
                    setMode('verify');
                  }}
                >
                  Back
                </Button>
                <Button type="submit" disabled={busy}>
                  Recover access
                </Button>
              </div>
            </form>
          </div>
        )}
        {mode === 'email-recovery' && (
          <form onSubmit={submit} className="space-y-4">
            <p className="text-sm leading-relaxed text-muted-foreground">
              Request an email to reset your authenticator. The link can be confirmed after a
              24-hour waiting period. Signing in again will be required after the reset.
            </p>
            {emailSent ? (
              <p role="status" className="text-sm">
                Check your email for the recovery link and its confirmation time.
              </p>
            ) : (
              <Button type="submit" disabled={busy}>
                Send recovery email
              </Button>
            )}
            {error && <InlineError message={error} />}
          </form>
        )}
        {allowRecovery && mode !== 'confirm' && mode !== 'email-recovery' && (
          <div className="mt-4">
            <SwitchMode
              onClick={() => {
                setError(null);
                setMode('email-recovery');
              }}
            >
              Recover by email
            </SwitchMode>
          </div>
        )}
      </Modal>
    </MfaContext.Provider>
  );
}

function MfaForm({
  code,
  onCodeChange,
  onSubmit,
  busy,
  error,
  submitLabel,
  hint,
  currentPassword,
  onPasswordChange,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  busy: boolean;
  error: string | null;
  submitLabel: string;
  hint: string;
  currentPassword?: string;
  onPasswordChange?: (password: string) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-3">
      {onPasswordChange && (
        <div className="space-y-2">
          <label htmlFor="mfa-current-password" className="label-mono text-muted-foreground">
            Current password
          </label>
          <input
            id="mfa-current-password"
            type="password"
            value={currentPassword}
            onChange={(event) => onPasswordChange(event.target.value)}
            autoComplete="current-password"
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          />
          <p className="text-xs text-muted-foreground">
            Required if you sign in with a password. Leave empty if you use a sign-in provider or
            email link only.
          </p>
        </div>
      )}
      <label htmlFor="mfa-totp" className="label-mono text-muted-foreground">
        Authenticator code
      </label>
      <input
        id="mfa-totp"
        value={code}
        onChange={(event) => onCodeChange(digitsOnly(event.target.value))}
        inputMode="numeric"
        pattern="[0-9]{6}"
        maxLength={6}
        autoComplete="one-time-code"
        autoFocus
        className="h-11 w-full rounded-md border border-input bg-background px-3 text-center font-mono text-lg tracking-[0.35em] outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">{hint}</p>
      {error && <InlineError message={error} />}
      <div className="flex justify-end gap-2 pt-1">
        <Button type="submit" disabled={busy || code.length !== 6}>
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}

function InlineError({ message }: { message: string }) {
  return (
    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
      {message}
    </p>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
      <div className="min-w-0">
        <p className="label-mono text-muted-foreground">{label}</p>
        <code className="break-all text-xs">{value}</code>
      </div>
      <CopyButton value={value} />
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const { copied, copy } = useCopy();
  return (
    <Button
      type="button"
      size="xs"
      variant="ghost"
      onClick={() => void copy(value)}
      aria-label="Copy"
      className="gap-1"
    >
      <CopyMorph copied={copied} className="h-3 w-3" />
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </Button>
  );
}

function SwitchMode({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
    >
      {children}
    </button>
  );
}
