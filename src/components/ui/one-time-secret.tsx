import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from './button';
import { CopyMorph, useCopy } from './copy-button';
import { useToast } from './toast';

/** The response belongs only to the interaction that requested it. */
export function useOneTimeSecret<T>() {
  const [evidence, setEvidence] = useState<{ value: T; version: number } | null>(null);
  const generation = useRef(0);
  const mounted = useRef(true);
  const restoreFocus = useRef<(() => void) | undefined>(undefined);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      generation.current += 1;
      restoreFocus.current = undefined;
    };
  }, []);
  const clear = useCallback(() => {
    generation.current += 1;
    setEvidence(null);
    restoreFocus.current = undefined;
  }, []);
  const dismiss = useCallback(() => {
    const focus = restoreFocus.current;
    clear();
    focus?.();
  }, [clear]);
  const capture = useCallback((onDismiss?: () => void) => {
    const request = ++generation.current;
    // Keep the last accepted evidence if a replacement request fails.
    return (value: T | null) => {
      if (!mounted.current || generation.current !== request) return false;
      setEvidence(value === null ? null : { value, version: request });
      restoreFocus.current = value === null ? undefined : onDismiss;
      return true;
    };
  }, []);
  // A replacement resets Reveal/Copy without putting plaintext into a React key.
  return { secret: evidence?.value ?? null, version: evidence?.version, capture, clear, dismiss };
}

/** Masking omits plaintext entirely from the DOM, including accessible metadata. */
export function OneTimeSecret({
  value,
  title,
  description,
  onDismiss,
}: {
  value: string;
  title: string;
  description: string;
  onDismiss: () => void;
}) {
  const [revealed, setRevealed] = useState(false);
  const { copied, copy } = useCopy();
  const { toast } = useToast();
  const id = useId();
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.focus();
  }, []);
  return (
    <div
      ref={panel}
      tabIndex={-1}
      role="region"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-description`}
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <h3 id={`${id}-title`} className="text-sm font-medium">
        {title}
      </h3>
      <p id={`${id}-description`} className="text-xs text-muted-foreground">
        {description} Copy it now; dismissing or leaving this surface removes this one-time copy.
      </p>
      <code className="select-all break-all rounded-lg border border-border px-3 py-2 font-mono text-xs">
        {revealed ? (
          value
        ) : (
          <>
            <span aria-hidden>••••••••••••••••</span>
            <span className="sr-only">Secret hidden</span>
          </>
        )}
      </code>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => {
            void copy(value).then((ok) => {
              if (!ok) toast({ kind: 'error', title: 'Could not copy' });
            });
          }}
        >
          <CopyMorph copied={copied} />
          <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-pressed={revealed}
          onClick={() => setRevealed(!revealed)}
        >
          {revealed ? 'Hide' : 'Reveal'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDismiss}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}
