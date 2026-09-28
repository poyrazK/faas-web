import type { ReactNode } from 'react';

type FieldControlProps = {
  id: string;
  'aria-describedby'?: string;
  'aria-invalid'?: true;
};

/** Label and feedback composition; callers own validation and touched state. */
export function FormField({
  id,
  label,
  hint,
  error,
  showError = false,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  showError?: boolean;
  children: (props: FieldControlProps) => ReactNode;
}) {
  const visibleError = showError ? error : undefined;
  const description =
    [hint && `${id}-hint`, visibleError && `${id}-error`].filter(Boolean).join(' ') || undefined;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': description,
        'aria-invalid': visibleError ? true : undefined,
      })}
      {hint && (
        <p id={`${id}-hint`} className="text-[13px] leading-5 text-muted-foreground">
          {hint}
        </p>
      )}
      {visibleError && (
        <p id={`${id}-error`} role="alert" className="text-[13px] leading-5 text-destructive">
          {visibleError}
        </p>
      )}
    </div>
  );
}
