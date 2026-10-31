import { Link } from '@tanstack/react-router';
import { CopyIconButton } from '@/components/ui/copy-button';
import { useApp, type App } from '@/lib/api/queries';
import { publicAppUrl } from '@/lib/app-url';

type CallTarget = Pick<App, 'slug'> &
  Partial<
    Pick<
      App,
      'type' | 'visibility' | 'url' | 'require_authn' | 'public_auth' | 'consumer_auth_mode'
    >
  >;

export interface CallInstructions {
  /** A runnable request, or none when the app has no public URL. */
  curl?: string;
  /** What the request needs, in one sentence; absent for an open app. */
  auth?: 'api-key' | 'basic' | 'consumer-key';
  ipAllowlist: boolean;
  internal: boolean;
  /** `gregale logs <slug> --follow` — the CLI reference's tail form. */
  logs: string;
}

/**
 * How to call a freshly deployed app, from what the app reports about itself.
 *
 * Header forms come from the AppResponse schema: `require_authn` and
 * `public_auth.mode: bearer` both demand `Authorization: Bearer` with an API
 * key of the owning account; `basic` is HTTP Basic with the sealed
 * credentials; `consumer_auth_mode: required` demands the app's consumer key
 * (`ck_…`) as a bearer. Placeholders stand in for every secret — the console
 * never has them to show. Apps and functions are both served over HTTP at
 * the platform URL, so the request has one shape for both.
 */
export function callInstructions(app: CallTarget): CallInstructions {
  const logs = `gregale logs ${app.slug} --follow`;
  const mode = app.public_auth?.mode ?? 'open';
  const internal = app.visibility === 'internal' || mode === 'internal_only';
  const url = publicAppUrl(app.url)?.replace(/\/$/, '');
  if (internal || !url) return { internal, ipAllowlist: false, logs };
  const auth: CallInstructions['auth'] =
    mode === 'basic'
      ? 'basic'
      : mode === 'bearer' || app.require_authn
        ? 'api-key'
        : app.consumer_auth_mode === 'required'
          ? 'consumer-key'
          : undefined;
  const credential =
    auth === 'basic'
      ? ` -u '<username>:<password>'`
      : auth === 'api-key'
        ? ` -H 'Authorization: Bearer <API_KEY>'`
        : auth === 'consumer-key'
          ? ` -H 'Authorization: Bearer <CONSUMER_KEY>'`
          : '';
  return {
    curl: `curl -i${credential} ${url}`,
    auth,
    ipAllowlist: mode === 'ip_allowlist',
    internal: false,
    logs,
  };
}

const AUTH_NOTE: Record<NonNullable<CallInstructions['auth']>, string> = {
  'api-key':
    'This app requires authentication: replace <API_KEY> with an API key from this account that can read apps.',
  basic:
    'This app uses HTTP Basic auth: use the username and password you saved for it. They are never shown again.',
  'consumer-key':
    'This app requires a consumer key: replace <CONSUMER_KEY> with a key (ck_…) issued for it.',
};

function Command({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-background px-3 py-2">
      <code className="min-w-0 break-all font-mono text-xs text-foreground">{text}</code>
      <CopyIconButton text={text} label={label} />
    </div>
  );
}

export function CallIt({ app, unreadable = false }: { app: CallTarget; unreadable?: boolean }) {
  const call = callInstructions(app);
  return (
    <section
      aria-labelledby={`call-it-${app.slug}`}
      className="mt-6 flex flex-col gap-3 border-t border-border pt-5"
    >
      <h3 id={`call-it-${app.slug}`} className="text-sm font-medium">
        Call it
      </h3>
      {call.curl ? (
        <>
          <Command text={call.curl} label="curl command" />
          {call.auth && (
            <p className="text-xs text-muted-foreground">
              {AUTH_NOTE[call.auth]}{' '}
              {call.auth === 'api-key' && (
                <Link
                  to="/dashboard/settings"
                  search={{ section: 'api-keys' }}
                  className="text-brand underline-offset-4 hover:underline"
                >
                  API keys
                </Link>
              )}
            </p>
          )}
          {call.ipAllowlist && (
            <p className="text-xs text-muted-foreground">
              Only requests from this app’s allowed IP ranges get through.
            </p>
          )}
          {app.type === 'function' && (
            <p className="text-xs text-muted-foreground">
              Your handler receives the request’s method, path, query, headers, and body.
            </p>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">
          {unreadable
            ? 'This app’s access settings could not be read, so no request is suggested. Send a test request from the Invoke tab.'
            : call.internal
              ? 'Internal service only: there is no public URL. Call it from another app in this account, or send a test request from the Invoke tab.'
              : 'The platform has not reported a public URL for this app yet. Send a test request from the Invoke tab.'}
        </p>
      )}
      <div className="flex flex-col gap-1.5">
        <p className="text-xs text-muted-foreground">Tail its logs from the CLI</p>
        <Command text={call.logs} label="logs command" />
      </div>
      <p className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: app.slug }}
          search={{ tab: 'Invoke' }}
          className="text-brand underline-offset-4 hover:underline"
        >
          Open the Invoke tab
        </Link>
        <Link
          to="/dashboard/apps/$appSlug"
          params={{ appSlug: app.slug }}
          search={{ tab: 'Logs' }}
          className="text-brand underline-offset-4 hover:underline"
        >
          View logs
        </Link>
      </p>
    </section>
  );
}

/** Reads the app's access settings, which decide the request's headers. */
export function AppCallIt({ slug }: { slug: string }) {
  const app = useApp(slug);
  if (app.data) return <CallIt app={app.data} />;
  // Without the app's auth settings a curl could be wrong; links still help.
  if (app.isError) return <CallIt app={{ slug }} unreadable />;
  return null;
}
