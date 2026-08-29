import * as React from 'react';
import { Tooltip as TooltipPrimitive } from 'radix-ui';
import { cn } from '@/lib/utils';

/**
 * Accessible tooltip — replaces the native `title=""` attribute, which never
 * shows for keyboard or touch users. Needs a `TooltipProvider` ancestor
 * (the dashboard shell mounts one).
 *
 * Content is supplementary by definition: anything essential belongs in
 * visible text or an `aria-label`, not here.
 */

export function TooltipProvider(props: React.ComponentProps<typeof TooltipPrimitive.Provider>) {
  return <TooltipPrimitive.Provider delayDuration={350} skipDelayDuration={200} {...props} />;
}

export function Tooltip({
  content,
  side = 'top',
  sideOffset = 6,
  children,
  ...props
}: React.ComponentProps<typeof TooltipPrimitive.Root> & {
  content: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
}) {
  return (
    <TooltipPrimitive.Root {...props}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(
            'animate-pop-in z-[110] max-w-64 rounded-md border border-border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-elevation-3'
          )}
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
