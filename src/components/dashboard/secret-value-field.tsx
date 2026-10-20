import { useId, useState } from 'react';
import { cn } from '@/lib/utils';

const FIELD =
  'w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-brand';

/**
 * A secret's value. Masked while it is one line; a password input strips line
 * breaks, which mangles PEM keys and other multi-line secrets, so pasting text
 * with line breaks (or choosing "Multi-line value") switches to a textarea
 * that keeps them. The textarea is not masked: multi-line text cannot be.
 */
export function SecretValueField({
  label,
  value,
  onChange,
  placeholder,
  className,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  const id = useId();
  const [multiline, setMultiline] = useState(() => value.includes('\n'));
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <span className="flex items-center justify-between gap-2">
        <label htmlFor={id} className="label-mono text-muted-foreground">
          {label}
        </label>
        {!multiline && (
          <button
            type="button"
            onClick={() => setMultiline(true)}
            className="pressable rounded text-xs text-muted-foreground hover:text-foreground"
          >
            Multi-line value
          </button>
        )}
      </span>
      {multiline ? (
        <textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          autoComplete="off"
          spellCheck={false}
          placeholder={placeholder}
          className={cn(FIELD, 'py-2 font-mono text-xs')}
        />
      ) : (
        <input
          id={id}
          type="password"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onPaste={(e) => {
            const pasted = e.clipboardData.getData('text');
            if (!pasted.includes('\n')) return;
            e.preventDefault();
            const input = e.currentTarget;
            const start = input.selectionStart ?? value.length;
            const end = input.selectionEnd ?? value.length;
            setMultiline(true);
            onChange(value.slice(0, start) + pasted + value.slice(end));
          }}
          autoComplete="off"
          placeholder={placeholder}
          className={cn(FIELD, 'h-10')}
        />
      )}
    </div>
  );
}
