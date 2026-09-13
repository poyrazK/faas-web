import type { ComponentProps } from 'react';
import { Tooltip, TooltipProvider } from './tooltip';
import { cn } from '@/lib/utils';

/** Icon actions always have an accessible name and a pointer/focus tooltip. */
export function IconButton({
  className,
  children,
  ...props
}: ComponentProps<'button'> & { 'aria-label': string }) {
  return (
    <TooltipProvider>
      <Tooltip content={props['aria-label']}>
        <button
          type="button"
          {...props}
          className={cn(
            'inline-flex min-h-8 min-w-8 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
            className
          )}
        >
          {children}
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
