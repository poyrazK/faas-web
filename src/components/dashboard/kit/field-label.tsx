import type { ReactNode } from 'react';
import { HelpTip } from './help-tip';

/**
 * A field's label, with its explanation behind a "?" rather than in a
 * sentence under the field. The "?" sits beside the `<label>`, not inside it,
 * so the field's accessible name stays its label alone.
 */
export function FieldLabel({
  label,
  help,
  htmlFor,
}: {
  label: string;
  help?: ReactNode;
  /** The control's id; omit for a group of buttons, which has no single control. */
  htmlFor?: string;
}) {
  const Text = htmlFor ? 'label' : 'span';
  return (
    <span className="flex items-center gap-1">
      <Text htmlFor={htmlFor} className="label-mono text-muted-foreground">
        {label}
      </Text>
      {help && <HelpTip label={`About ${label}`}>{help}</HelpTip>}
    </span>
  );
}
