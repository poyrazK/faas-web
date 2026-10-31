import { OpenNewWindow } from 'iconoir-react';
import { CopyIconButton } from '@/components/ui/copy-button';
import { problemHelp } from '@/lib/api/problem-help';
import { cn } from '@/lib/utils';

/**
 * The part of an API error a person can act on beyond its sentence: the API's
 * next step, the stable code to quote or search for, and the docs page about
 * it when this site publishes one. Renders nothing for errors the API did not
 * author (a dropped connection, a proxy page).
 */
export function ProblemHelp({ error, className }: { error: unknown; className?: string }) {
  const { code, hint, docsHref } = problemHelp(error);
  if (!code) return null;
  return (
    <span className={cn('flex flex-col gap-1 text-xs text-muted-foreground', className)}>
      {hint && <span>{hint}</span>}
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="inline-flex items-center gap-1">
          <code className="font-mono">{code}</code>
          <CopyIconButton text={code} label={`error code ${code}`} />
        </span>
        {docsHref && (
          <a
            href={docsHref}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-brand underline-offset-4 hover:underline"
          >
            Docs
            <OpenNewWindow aria-hidden className="h-3 w-3" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        )}
      </span>
    </span>
  );
}
