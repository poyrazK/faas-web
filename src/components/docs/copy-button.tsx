import { CopyMorph, useCopy } from '@/components/ui/copy-button';

/**
 * A copy-to-clipboard button with a confirmed state.
 *
 * The confirmation lives in the button itself — icon morphs and label swaps
 * for two seconds — rather than in a toast, because on a docs page the reader
 * is looking at the button when they press it, and a toast is chrome the
 * moment does not need.
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
  const { copied, copy } = useCopy();

  return (
    <button
      type="button"
      onClick={() => void copy(text)}
      className={`pressable inline-flex items-center gap-1.5 rounded-md outline-none ${
        copied ? 'text-brand' : 'text-muted-foreground hover:text-foreground'
      } ${className}`}
    >
      <CopyMorph copied={copied} />
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  );
}
