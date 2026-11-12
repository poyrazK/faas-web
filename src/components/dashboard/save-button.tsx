import type { ComponentProps } from 'react';
import { Check } from 'iconoir-react';
import { Button } from '@/components/ui/button';

/** `saved` is an explicit server acknowledgement, never inferred from busy ending. */
export function SaveButton({
  saved,
  children,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children' | 'asChild'> & {
  saved: boolean;
  children: string;
}) {
  return (
    <Button
      {...props}
      aria-label={props['aria-label'] ?? (saved && !props.busy ? `${children} — Saved` : undefined)}
    >
      <span className="console-save grid" data-saved={saved && !props.busy ? 'true' : undefined}>
        <span className="console-save-label col-start-1 row-start-1">{children}</span>
        <span
          aria-hidden
          className="console-save-confirm col-start-1 row-start-1 inline-flex items-center justify-center gap-1.5"
        >
          <Check className="size-4" /> Saved
        </span>
      </span>
    </Button>
  );
}
