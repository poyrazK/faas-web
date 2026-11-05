import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { Popover } from 'radix-ui';
import { HelpCircle } from 'iconoir-react';

/**
 * Where an explanation goes instead of a description line: one "?" beside a
 * title, opened on demand. Short text, and a docs link when there is more.
 */
export function HelpTip({
  children,
  docs,
  label = 'About this',
}: {
  children: ReactNode;
  /** A `/docs/<slug>` page with the full story. */
  docs?: string;
  label?: string;
}) {
  return (
    <Popover.Root>
      <Popover.Trigger
        aria-label={label}
        className="pressable inline-flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground data-[state=open]:text-foreground"
      >
        <HelpCircle aria-hidden="true" className="size-3.5" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
          className="console z-[96] w-72 rounded-md border border-border bg-popover p-3 text-xs leading-relaxed text-foreground shadow-elevation-3 outline-none"
        >
          <div className="text-muted-foreground">{children}</div>
          {docs && (
            <Link
              to={docs}
              className="mt-2 inline-block text-brand underline-offset-4 hover:underline"
            >
              Read the docs
            </Link>
          )}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
