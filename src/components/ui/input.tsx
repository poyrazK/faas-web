import * as React from 'react';

import { FIELD } from '@/components/ui/field';
import { cn } from '@/lib/utils';

/** Text input in the console field idiom — see `ui/field.tsx` for the base. */
function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(FIELD, 'w-full min-w-0', className)}
      {...props}
    />
  );
}

export { Input };
