import { Link } from '@tanstack/react-router';
import { Plus } from 'iconoir-react';

/** The console's one primary action, always in the top bar. */
export function NewAppButton() {
  return (
    <Link
      to="/dashboard/apps/new"
      aria-label="New app"
      className="pressable inline-flex h-8 items-center gap-1.5 rounded-md bg-brand px-2.5 text-sm font-medium text-primary-foreground hover:bg-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
    >
      <Plus aria-hidden="true" className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">New app</span>
    </Link>
  );
}
