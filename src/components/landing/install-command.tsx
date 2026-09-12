import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'iconoir-react';

export const INSTALL_COMMAND = 'npm install -g gregale';

/**
 * The install command as a copy pill.
 *
 * Shared by the hero and the closing CTA: the same secondary action appears at
 * both ends of the page, so a developer who scrolled past the hero meets the
 * identical control again rather than a differently styled twin.
 */
export function InstallCommand({ className = '' }: { className?: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(INSTALL_COMMAND);
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1800);
    } catch {
      // Clipboard blocked (insecure context or denied permission) — leave the
      // command visible so it can still be selected by hand.
    }
  };

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={`Copy install command: ${INSTALL_COMMAND}`}
      className={`group flex h-11 items-center gap-3 rounded-full border border-border bg-card/70 pl-5 pr-2 font-mono text-sm text-muted-foreground backdrop-blur-sm transition-all duration-200 hover:border-brand/40 hover:bg-card hover:text-foreground ${className}`}
    >
      <span aria-hidden className="text-brand transition-colors">
        $
      </span>
      <span className="tracking-tight">{INSTALL_COMMAND}</span>
      <span
        className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors ${
          copied ? 'bg-brand-muted' : 'bg-muted group-hover:bg-secondary'
        }`}
      >
        {copied ? <Check className="h-3.5 w-3.5 text-brand" /> : <Copy className="h-3.5 w-3.5" />}
      </span>
      <span aria-live="polite" className="sr-only">
        {copied ? 'Copied to clipboard' : ''}
      </span>
    </button>
  );
}
