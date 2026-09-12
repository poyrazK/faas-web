import { Link } from '@tanstack/react-router';
import { Github } from 'iconoir-react';
import { INSTALL_COMMAND } from '@/components/landing/install-command';
import { CopyIconButton } from '@/components/ui/copy-button';
import { Button } from '@/components/ui/button';
import { Panel } from './primitives';

/**
 * What the console says to an account with nothing in it.
 *
 * Browser setup is the primary path; the documented CLI remains available
 * without making a first-time console user install anything to get started.
 */

const STEPS: { command: string; caption: string }[] = [
  {
    command: INSTALL_COMMAND,
    caption: 'Install the CLI. Homebrew on macOS and Linux.',
  },
  {
    command: 'gregale connect',
    caption: 'Link your GitHub account once, in a browser. CI reuses it after that.',
  },
  {
    command: 'gregale deploy --repo <owner>/<repo> --ref main',
    caption: 'Build and deploy. The app appears here as soon as the build starts.',
  },
];

export function FirstRun() {
  return (
    <Panel padded={false} title="Deploy your first app">
      <div className="px-5 py-6 sm:px-6">
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">
          Connect a GitHub repository and take it from source to a live endpoint, right here in the
          console.
        </p>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button asChild variant="cta">
            <Link to="/dashboard/workflows/new" search={{ source: 'git' }}>
              <Github aria-hidden />
              Deploy from GitHub
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/dashboard/workflows/new" search={{ source: 'template' }}>
              Explore templates
            </Link>
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Templates provide starter code to deploy with the CLI.
        </p>
        <ol className="mt-7 grid gap-5 border-t border-border pt-5 sm:grid-cols-3">
          {[
            ['Choose a source', 'Select your repository and branch.'],
            ['Configure your app', 'Choose a runtime and review your settings.'],
            ['Deploy and open', 'Follow the build, then open your live app.'],
          ].map(([title, description], index) => (
            <li key={title} className="flex gap-3">
              <span aria-hidden className="text-sm text-brand">
                {index + 1}
              </span>
              <div>
                <p className="text-sm font-medium">{title}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
      <details className="border-t border-border">
        <summary className="cursor-pointer px-5 py-4 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-brand">
          Prefer the CLI?
        </summary>
        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <li
              key={step.command}
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
                  <code className="min-w-0 break-all font-mono text-xs text-foreground">
                    {step.command}
                  </code>
                  <CopyIconButton text={step.command} label={step.command} />
                </div>
                <p className="text-xs text-muted-foreground">{step.caption}</p>
              </div>
            </li>
          ))}
        </ol>
      </details>
    </Panel>
  );
}
