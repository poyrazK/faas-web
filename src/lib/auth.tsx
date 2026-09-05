import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { api, setUnauthorizedHandler, unwrap } from './api/client';
import { ApiError } from './api/errors';
import type { components } from './api/schema';

/**
 * The real session layer, against `apid`'s cookie auth.
 *
 * **The session itself is not readable from JavaScript.** `POST /login` sets
 * `faas_sid` as `HttpOnly; Secure; SameSite=Lax`, which is the right call — it
 * means an XSS cannot exfiltrate the session — but it also means this module
 * cannot answer "is the user signed in?" without asking the server.
 *
 * Route guards run in `beforeLoad`, which is synchronous and must decide
 * instantly. So we keep a *hint* in localStorage: the email, written on a
 * successful sign-in and cleared on sign-out or on any 401. The hint is not a
 * credential and forging it grants nothing — every actual request is authorised
 * by the cookie, server-side. It exists purely so the guard can route without a
 * round-trip, and so a reload does not flash the sign-in screen at someone who
 * is signed in.
 *
 * The hint is then verified: `AuthProvider` calls `GET /v1/account` on mount,
 * and a 401 anywhere in the app clears it (see `setUnauthorizedHandler`).
 */

const SESSION_KEY = 'gregale.session';
const ONBOARDED_KEY = 'gregale.onboarded';
const WORKSPACE_KEY = 'gregale.workspace';
const OAUTH_PENDING_KEY = 'gregale.oauth-pending';
const ONBOARDING_GITHUB_RETURN_KEY = 'gregale.onboarding-github-return';
export const DEFAULT_WORKSPACE = 'acme-corp';

/** The server's floor: NIST-style length rule, no complexity theatre. */
export const MIN_PASSWORD_LENGTH = 12;

export type Account = components['schemas']['AccountResponse'];
export type Plan = Account['plan'];

export interface User {
  email: string;
  name: string;
  initials: string;
}

function initialsFor(email: string): string {
  const handle = email.split('@')[0] ?? '';
  const parts = handle.split(/[._-]+/).filter(Boolean);
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : handle.slice(0, 2);
  return letters.toUpperCase() || 'GG';
}

function nameFor(email: string): string {
  const handle = email.split('@')[0] ?? '';
  return handle
    .split(/[._-]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join(' ');
}

/** The API knows an email, not a display name; derive the rest for the shell. */
function userFor(email: string): User {
  const trimmed = email.trim();
  return {
    email: trimmed,
    name: nameFor(trimmed) || 'Gregale User',
    initials: initialsFor(trimmed),
  };
}

/**
 * The synchronous half of the guard — see the note at the top of this file.
 * A stale hint costs one redirect; it never grants access to data.
 */
export function readSession(): User | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<User>;
    return typeof parsed?.email === 'string' ? userFor(parsed.email) : null;
  } catch {
    return null;
  }
}

/**
 * OAuth returns through a full-page provider redirect. The server can restore
 * the HttpOnly session cookie, but it cannot write the client-only session
 * hint used by the synchronous route guards. Keep a marker in sessionStorage
 * so the first page after the callback knows to hydrate `/v1/account`.
 */
export function markOAuthPending() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(OAUTH_PENDING_KEY, 'true');
  } catch {
    // Private browsing modes may deny storage; the OAuth flow still proceeds.
  }
}

export function hasOAuthPending(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.sessionStorage.getItem(OAUTH_PENDING_KEY) === 'true';
  } catch {
    return false;
  }
}

export function clearOAuthPending() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(OAUTH_PENDING_KEY);
  } catch {
    // Best effort only; a denied storage area cannot affect the session.
  }
}

function writeSession(user: User | null) {
  if (typeof window === 'undefined') return;
  if (user) window.localStorage.setItem(SESSION_KEY, JSON.stringify({ email: user.email }));
  else window.localStorage.removeItem(SESSION_KEY);
}

export function hasOnboarded(): boolean {
  if (typeof window === 'undefined') return false;
  return window.localStorage.getItem(ONBOARDED_KEY) === 'true';
}

export function markOnboarded() {
  window.localStorage.setItem(ONBOARDED_KEY, 'true');
}

/**
 * The GitHub installation callback lands on `/dashboard/account`, whose parent
 * route normally requires onboarding to be complete. Remember this deliberate
 * hand-off so the guard can admit that one route and the account page can send
 * the customer back to their first deployment.
 */
export function beginOnboardingGitHubConnect() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.setItem(ONBOARDING_GITHUB_RETURN_KEY, 'true');
}

export function hasOnboardingGitHubReturn(): boolean {
  if (typeof window === 'undefined') return false;
  return window.sessionStorage.getItem(ONBOARDING_GITHUB_RETURN_KEY) === 'true';
}

export function consumeOnboardingGitHubReturn(): boolean {
  if (typeof window === 'undefined') return false;
  const pending = hasOnboardingGitHubReturn();
  if (pending) window.sessionStorage.removeItem(ONBOARDING_GITHUB_RETURN_KEY);
  return pending;
}

/** Workspace slug chosen during onboarding; falls back to the demo default. */
export function readWorkspace(): string {
  if (typeof window === 'undefined') return DEFAULT_WORKSPACE;
  return window.localStorage.getItem(WORKSPACE_KEY)?.trim() || DEFAULT_WORKSPACE;
}

export function saveWorkspace(slug: string) {
  window.localStorage.setItem(WORKSPACE_KEY, slug.trim());
}

/** Explicit workspace deletion wipes account state, not just the session. */
export function clearWorkspace() {
  window.localStorage.removeItem(WORKSPACE_KEY);
  window.localStorage.removeItem(ONBOARDED_KEY);
}

/* --- Dev bypass ------------------------------------------------------------
   Lets the console be opened without a backend, so its design can be worked
   on while `apid` is down. Writes the same session hint and onboarding flag a
   real sign-in would, plus a marker that tells the 401 handler below to leave
   them alone. Every branch is behind `import.meta.env.DEV`, which Vite
   replaces with `false` in production, so none of this survives a build.
   ------------------------------------------------------------------------- */

const DEV_BYPASS_KEY = 'gregale.dev-bypass';
export const DEV_BYPASS_EMAIL = 'design@gregale.dev';

export function isDevBypass(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false;
  return window.localStorage.getItem(DEV_BYPASS_KEY) === 'true';
}

export function enterDevBypass() {
  if (!import.meta.env.DEV) return;
  window.localStorage.setItem(DEV_BYPASS_KEY, 'true');
  writeSession(userFor(DEV_BYPASS_EMAIL));
  markOnboarded();
}

export function exitDevBypass() {
  if (!import.meta.env.DEV) return;
  window.localStorage.removeItem(DEV_BYPASS_KEY);
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

interface AuthValue {
  user: User | null;
  /** Plan, quota limits, and usage. Null until `GET /v1/account` resolves. */
  account: Account | null;
  /** True while the initial session check is in flight. */
  loading: boolean;
  signIn: (email: string, password: string) => Promise<User>;
  signUp: (email: string, password: string) => Promise<User>;
  signOut: () => Promise<void>;
  /** Always resolves — the server answers identically whether or not the address exists. */
  requestPasswordReset: (email: string) => Promise<void>;
  refreshAccount: () => Promise<void>;
  /**
   * False once `GET /v1/account` has failed with something other than a 401 —
   * the box is down, or a proxy answered for it. The shell says so once,
   * rather than leaving every panel to report the same outage separately.
   */
  apiReachable: boolean;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(() => readSession());
  const [account, setAccount] = useState<Account | null>(null);
  const [apiReachable, setReachable] = useState(true);
  // Only the boot check blocks; later refreshes happen behind the current UI.
  const [loading, setLoading] = useState<boolean>(
    () => readSession() !== null || hasOAuthPending()
  );

  const setSession = useCallback((next: User | null) => {
    writeSession(next);
    setUser(next);
    if (!next) setAccount(null);
  }, []);

  const refreshAccount = useCallback(async () => {
    const next = await unwrap(api.GET('/v1/account', {}));
    setReachable(true);
    setAccount(next);
    // The server is authoritative on the address; a hint written from a typo'd
    // or since-changed email gets corrected here.
    if (next.email) setSession(userFor(next.email));
  }, [setSession]);

  /**
   * Any 401 from anywhere means the cookie is gone or expired. Drop the hint so
   * the guards send the user to sign in, rather than leaving every panel
   * showing an error it cannot explain.
   */
  useEffect(() => {
    setUnauthorizedHandler(() => {
      // With no backend there is no cookie, so every call is a 401; under the
      // dev bypass that must not bounce the designer back to sign-in.
      if (isDevBypass()) return;
      writeSession(null);
      setUser(null);
      setAccount(null);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Verify the hint once on mount. StrictMode double-invokes effects in dev, and
  // this one is a network call, so it is guarded.
  const checked = useRef(false);
  useEffect(() => {
    if (checked.current) return;
    checked.current = true;
    const sessionHint = readSession();
    const oauthPending = hasOAuthPending();
    if (!sessionHint && !oauthPending) {
      setLoading(false);
      return;
    }
    void refreshAccount()
      .catch((err: unknown) => {
        // A 401 has already cleared the session via the handler above. Anything
        // else — the box is down, the network dropped — should not sign the
        // user out, but the shell needs to know so it can say so once.
        if (!(err instanceof ApiError && err.isAuth)) setReachable(false);
        if (oauthPending && err instanceof ApiError && err.isAuth) clearOAuthPending();
      })
      .finally(() => setLoading(false));
  }, [refreshAccount]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      await unwrap(api.POST('/login', { body: { email: email.trim(), password } }));
      const next = userFor(email);
      setSession(next);
      // Fire and forget: the plan and quota banner can arrive a beat later
      // rather than holding up the redirect into the console.
      void refreshAccount().catch(() => {});
      return next;
    },
    [refreshAccount, setSession]
  );

  const signUp = useCallback(
    async (email: string, password: string) => {
      await unwrap(api.POST('/signup', { body: { email: email.trim(), password } }));
      const next = userFor(email);
      setSession(next);
      void refreshAccount().catch(() => {});
      return next;
    },
    [refreshAccount, setSession]
  );

  /**
   * Clears locally *first*, then tells the server.
   *
   * Order matters: callers sign out and navigate to `/login` in the same tick,
   * and the route guard reads the hint synchronously. Awaiting the round-trip
   * before clearing would let the guard still see a session and bounce the user
   * straight back into the console.
   *
   * The server call is best-effort for the same reason — a failed logout leaves
   * a cookie the server expires on its own, and refusing to sign someone out
   * because the network blipped is the worse failure.
   */
  const signOut = useCallback(async () => {
    exitDevBypass();
    setSession(null);
    try {
      await unwrap(api.POST('/v1/auth/logout', {}));
    } catch {
      // Intentionally ignored — see above.
    }
  }, [setSession]);

  const requestPasswordReset = useCallback(async (email: string) => {
    await unwrap(api.POST('/login/forgot', { body: { email: email.trim() } }));
  }, []);

  const value = useMemo(
    () => ({
      user,
      account,
      loading,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      refreshAccount,
      apiReachable,
    }),
    [
      user,
      account,
      loading,
      signIn,
      signUp,
      signOut,
      requestPasswordReset,
      refreshAccount,
      apiReachable,
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
