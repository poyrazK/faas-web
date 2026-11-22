import type { ReactNode } from 'react';
import { Flask, Lock } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useAppEnvironment } from '@/lib/environment-scope';
import { cn } from '@/lib/utils';

/**
 * Wraps an app's variables and secrets so they follow the top bar's
 * environment. Production renders exactly as before. In another environment
 * the page says which one it edits, an app the environment doesn't run says
 * how to deploy it there (and nothing below reads production instead), and a
 * protected environment is read-only.
 */
export function EnvironmentValuesGate({
  slug,
  quiet = false,
  children,
}: {
  slug: string;
  /** The page draws its own environment note; the gate only gates. */
  quiet?: boolean;
  children: (env: { scope?: string; readOnly: boolean; name?: string }) => ReactNode;
}) {
  const app = useAppEnvironment(slug);
  if (!app.scope) return <>{children({ readOnly: false })}</>;
  if (app.unavailable)
    return (
      <p role="alert" className="text-sm text-muted-foreground">
        {app.name} isn’t one of this project’s environments. Choose another in the top bar.
      </p>
    );
  if (app.failed)
    return (
      <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        {app.name} could not be read.
        <Button size="xs" variant="outline" onClick={app.retry}>
          Try again
        </Button>
      </div>
    );
  if (app.present === null)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Checking {app.name}…
      </p>
    );
  if (app.present === false)
    return (
      <div className="surface flex flex-col gap-2 rounded-[1.25rem] bg-card px-5 py-4 text-sm">
        <p className="text-foreground">
          {slug} isn’t in {app.name} yet. Deploy it there with{' '}
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
            gregale deploy --environment {app.scope}
          </code>
          .
        </p>
        <p className="text-muted-foreground">
          {app.name} keeps its own variables and secrets, so production’s aren’t shown here.
        </p>
      </div>
    );
  if (quiet) return <>{children({ scope: app.scope, readOnly: app.readOnly, name: app.name })}</>;
  return (
    <>
      <EnvironmentNote name={app.name} readOnly={app.readOnly}>
        {/* Values can be set before the first deploy, which is often when
            they're needed (a database URL, a token). */}
        {app.deployed === false &&
          ` ${slug} isn’t deployed there yet: these apply on its first deploy (gregale deploy --environment ${app.scope}).`}
      </EnvironmentNote>
      {children({ scope: app.scope, readOnly: app.readOnly, name: app.name })}
    </>
  );
}

/**
 * The stage-tinted line that says which environment a page shows or edits:
 * "Editing Staging. Production keeps its own values." by default, the
 * read-only sentence for a protected stage, or `lead` instead of the default.
 */
export function EnvironmentNote({
  name,
  readOnly,
  lead,
  children,
}: {
  name: string;
  readOnly: boolean;
  lead?: string;
  children?: ReactNode;
}) {
  const Icon = readOnly ? Lock : Flask;
  return (
    <p
      role="note"
      className={cn(
        'flex items-center gap-2 rounded-xl px-3.5 py-2.5 text-[13px] ring-1',
        'bg-status-warning/10 text-status-warning ring-status-warning/25'
      )}
    >
      <Icon aria-hidden className="h-3.5 w-3.5 shrink-0" />
      <span>
        {readOnly
          ? `${name} is protected: changes go through a promotion.`
          : (lead ?? `Editing ${name}. Production keeps its own values.`)}
        {children}
      </span>
    </p>
  );
}
