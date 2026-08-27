import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'iconoir-react';

/**
 * A copy-to-clipboard button with a confirmed state.
 *
 * The confirmation lives in the button itself — icon and label swap for two
 * seconds — rather than in a toast, because on a docs page the reader is
 * looking at the button when they press it, and a toast is chrome the moment
 * does not need.
 *
 * Font and size are the caller's: the code-block header sets `text-xs`, the
 * page header sets `label-mono`. The button only insists on its colour states.
 */
export function CopyButton({
  text,
  label = 'Copy',
  className = '',
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    // Clipboard access can be denied or absent (plain http, permissions
    // policy); a button that quietly does nothing beats one that throws.
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      type="button"
      onClick={copy}
      className={`inline-flex items-center gap-1.5 rounded-md outline-none transition-colors ${
        copied ? 'text-brand' : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
    >
      {copied ? (
        <Check className="h-3.5 w-3.5" aria-hidden />
      ) : (
        <Copy className="h-3.5 w-3.5" aria-hidden />
      )}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
