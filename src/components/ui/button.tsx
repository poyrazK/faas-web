import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { RefreshDouble } from 'iconoir-react';
import { Slot } from 'radix-ui';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[transform,color,background-color,border-color,box-shadow,opacity] duration-150 active:scale-[0.97] motion-reduce:transform-none outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-primary/90',
        destructive:
          'bg-destructive text-white hover:bg-destructive/90 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40',
        outline:
          'border bg-background shadow-xs hover:bg-accent hover:text-accent-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50',
        secondary: 'bg-secondary text-secondary-foreground hover:bg-secondary/80',
        ghost: 'hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50',
        link: 'text-primary underline-offset-4 hover:underline',
        // Primary conversion action: a mint fill with an inset top highlight so
        // it reads as a lit surface, a mint glow that intensifies on hover, and
        // a shine that sweeps across once per hover.
        //
        // The gradient is deliberately shallow — mint-7 to mint-8 — because the
        // deep-mint label has to clear 4.5:1 against *both* ends. Running it
        // down to mint-9 looks richer and drops the bottom of the button to
        // 3.3:1, which fails for a 16px label.
        cta: 'relative overflow-hidden bg-gradient-to-b from-mint-7 to-mint-8 font-semibold text-mint-12 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.55),0_6px_24px_-10px_rgba(0,164,101,0.55)] hover:shadow-[inset_0_1px_0_0_rgba(255,255,255,0.75),0_10px_34px_-8px_rgba(0,164,101,0.85)] active:translate-y-px after:pointer-events-none after:absolute after:inset-0 after:-translate-x-full after:bg-gradient-to-r after:from-transparent after:via-white/55 after:to-transparent after:transition-transform after:duration-700 hover:after:translate-x-full motion-reduce:after:hidden',
      },
      size: {
        default: 'h-9 px-4 py-2 has-[>svg]:px-3',
        xs: "h-6 gap-1 rounded-md px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: 'h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5',
        lg: 'h-10 rounded-md px-6 has-[>svg]:px-4',
        icon: 'size-9',
        'icon-xs': "size-6 rounded-md [&_svg:not([class*='size-'])]:size-3",
        'icon-sm': 'size-8',
        'icon-lg': 'size-10',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  }
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  busy = false,
  children,
  disabled,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
    /**
     * An in-flight mutation. The label goes invisible but keeps its box while
     * a spinner overlays it, so the button — and the row it sits in — never
     * changes width mid-action the way a "Save" ↔ "Saving…" label swap does.
     * Also disables and sets `aria-busy`. Not for `asChild`.
     */
    busy?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  if (busy && !asChild) {
    return (
      <button
        data-slot="button"
        data-variant={variant}
        data-size={size}
        className={cn(buttonVariants({ variant, size, className }), 'relative')}
        disabled
        aria-busy="true"
        {...props}
      >
        <span aria-hidden className="invisible inline-flex items-center gap-[inherit]">
          {children}
        </span>
        <span className="absolute inset-0 flex items-center justify-center">
          <RefreshDouble className="animate-spin motion-reduce:animate-none" />
          <span className="sr-only">Working…</span>
        </span>
      </button>
    );
  }

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      disabled={disabled}
      {...props}
    >
      {children}
    </Comp>
  );
}

export { Button, buttonVariants };
