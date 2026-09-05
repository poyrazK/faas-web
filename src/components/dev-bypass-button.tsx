import { useRouterState } from '@tanstack/react-router';
import { enterDevBypass } from '@/lib/auth';

/**
 * Dev-only shortcut into the console without signing in.
 *
 * Rendered by the root layout only when `import.meta.env.DEV` is true, so the
 * production bundle never contains it. Hidden once inside the console, where
 * it has nothing left to do.
 */
export function DevBypassButton() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  if (pathname.startsWith('/dashboard')) return null;

  return (
    <button
      type="button"
      onClick={() => {
        enterDevBypass();
        window.location.assign('/dashboard');
      }}
      className="label-mono fixed bottom-4 right-4 z-[60] inline-flex h-9 items-center gap-2 rounded-full border border-border bg-card px-4 text-foreground shadow-[0_8px_24px_-12px_rgba(13,21,18,0.3)] transition-colors hover:border-border-secondary"
    >
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-status-warning" />
      Dev · open dashboard
    </button>
  );
}
