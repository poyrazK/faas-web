import { CopyIconButton } from '@/components/ui/copy-button';

/**
 * A `gregale` command to copy, for the places the console defers to the CLI.
 *
 * The `$ ` prompt is decoration: it is hidden from assistive tech, cannot be
 * selected, and is not part of what the button copies. The button is named
 * `copyLabel`, else `label`, else the command itself. Build the command with
 * a function from `lib/cli-commands.ts` so it matches what the CLI accepts.
 */
export function CliCommand({
  command,
  label,
  copyLabel,
}: {
  command: string;
  /** Visible caption above the command; may be a full sentence, e.g. a warning. */
  label?: string;
  /** Short noun-like name for the copy button when `label` reads as an instruction. */
  copyLabel?: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {label && <p className="text-xs font-medium">{label}</p>}
      <div className="flex items-start gap-2 rounded-md border border-border bg-muted/30 p-2">
        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
          <span aria-hidden="true" className="select-none text-muted-foreground">
            $
          </span>{' '}
          {command}
        </code>
        <CopyIconButton text={command} label={copyLabel ?? label ?? command} />
      </div>
    </div>
  );
}
