import * as React from 'react';
import { cn } from '@/lib/utils';

/** Keyboard-shortcut chip — the mono label voice in a hairline border. The
 * same class string used to be retyped wherever a shortcut was shown. */
export function Kbd({ className, ...props }: React.ComponentProps<'kbd'>) {
  return (
    <kbd
      className={cn(
        'label-mono rounded border border-border px-1.5 py-0.5 text-muted-foreground',
        className
      )}
      {...props}
    />
  );
}
