import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * The console form-field vocabulary, in one place.
 *
 * Seven files used to re-declare this class string locally (and drift: some
 * had `w-full`, some tabular numerals). `FIELD` is the base every text-ish
 * control shares; `Input`, `Select`, and `Textarea` below wrap the native
 * elements in it. New form code should reach for the components; `FIELD`
 * stays exported for the odd element they do not cover.
 *
 * `focus:` (not `focus-visible:`) on the border is deliberate for fields: a
 * caret you just clicked into needs a visible home for pointer users too.
 * Keyboard users additionally get the global `:focus-visible` ring.
 */
export const FIELD =
  'h-9 rounded-md border border-border bg-background px-3 text-sm outline-none transition-[border-color] duration-150 ease-console placeholder:text-muted-foreground focus:border-brand/50 disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-[color:var(--status-critical)]';

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  // A styled native <select>: the console keeps native popup semantics (and
  // `color-scheme: dark` themes the menu) rather than re-implementing them.
  return <select data-slot="select" className={cn(FIELD, className)} {...props} />;
}

/**
 * Inline complaint under a field. Pair with `aria-invalid` and
 * `aria-describedby={id}` on the input; gate on a touched flag so nobody is
 * scolded mid-typing. Say what the rule is, not just that it was broken.
 */
export function FieldError({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <p id={id} className="text-xs" style={{ color: 'var(--status-critical)' }}>
      {children}
    </p>
  );
}

/** Native ARIA wiring shared by validated controls. */
export function fieldErrorProps(error: string | undefined, errorId: string) {
  return {
    'aria-invalid': error ? (true as const) : undefined,
    'aria-describedby': error ? errorId : undefined,
  };
}

/**
 * Submit-attempt state plus deterministic first-invalid focus.
 *
 * Validation stays in each form because its rules come from that endpoint's
 * schema. This hook only owns the interaction contract: errors appear after a
 * submit attempt and the first named invalid control receives focus.
 */
export function useFormValidation<Name extends string>() {
  const [submitAttempted, setSubmitAttempted] = React.useState(false);

  const validate = React.useCallback(
    (errors: Partial<Record<Name, string | undefined>>, form: HTMLFormElement) => {
      setSubmitAttempted(true);
      const firstInvalid = Object.entries(errors).find(([, message]) => Boolean(message));
      if (!firstInvalid) return true;

      const control = form.elements.namedItem(firstInvalid[0]);
      if (control instanceof HTMLElement) control.focus();
      return false;
    },
    []
  );

  const resetValidation = React.useCallback(() => setSubmitAttempted(false), []);

  return { submitAttempted, validate, resetValidation };
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(FIELD, 'h-auto min-h-20 w-full py-2', className)}
      {...props}
    />
  );
}
