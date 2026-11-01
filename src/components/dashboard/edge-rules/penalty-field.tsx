import type { components } from '@/lib/api/schema';
import { NumberField, ToggleRow } from './fields';

/**
 * A rule's penalty box (faas ADR-20261022105846, pkg/api/edge_rule_penalty.go):
 * once the rule has refused the same client `after` times within
 * `within_seconds`, every request from that client to the app is refused for
 * `seconds`, whatever path it asks for. Only rules that refuse a client by
 * policy can carry one — ip, geo, throttle, and waf in block mode
 * (edge_rule_penalty.go:49-60); the dialog edits the first three.
 */

export type Penalty = components['schemas']['EdgeRulePenalty'];

export const PENALTY_KINDS = new Set(['ip', 'geo', 'throttle']);

// limits.go:7620-7627.
const SECONDS = [60, 86400] as const;
const AFTER = [1, 1000] as const;
const WITHIN = [1, 3600] as const;
export const DEFAULT_PENALTY: Penalty = { seconds: 600, after: 1, within_seconds: 60 };

const outside = (v: number | undefined, [lo, hi]: readonly [number, number]) =>
  v === undefined || !Number.isInteger(v) || v < lo || v > hi;

export function validatePenalty(p: Penalty | null): Record<string, string> {
  if (!p) return {};
  return {
    ...(outside(p.seconds, SECONDS) ? { 'penalty.seconds': 'From 60 to 86400 seconds.' } : {}),
    ...(outside(p.after ?? 1, AFTER) ? { 'penalty.after': 'From 1 to 1000.' } : {}),
    ...(outside(p.within_seconds ?? 60, WITHIN)
      ? { 'penalty.within_seconds': 'From 1 to 3600 seconds.' }
      : {}),
  };
}

export const samePenalty = (a?: Penalty | null, b?: Penalty | null) =>
  (a?.seconds ?? 0) === (b?.seconds ?? 0) &&
  (a?.after ?? 1) === (b?.after ?? 1) &&
  (a?.within_seconds ?? 60) === (b?.within_seconds ?? 60) &&
  Boolean(a) === Boolean(b);

export function PenaltyField({
  value,
  onChange,
  errors,
}: {
  value: Penalty | null;
  onChange: (next: Penalty | null) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="flex flex-col gap-4">
      <ToggleRow
        label="Penalty box"
        hint="Once this rule has refused a client enough times, refuse every request from that client to the app for a while, on any path."
        checked={value !== null}
        onChange={(on) => onChange(on ? DEFAULT_PENALTY : null)}
      />
      {value && (
        <div className="grid gap-4 sm:grid-cols-3">
          <NumberField
            label="Block for (seconds)"
            hint="60 to 86400."
            error={errors['penalty.seconds']}
            value={value.seconds}
            min={60}
            onChange={(seconds) => onChange({ ...value, seconds: seconds ?? 0 })}
          />
          <NumberField
            label="After refusals"
            hint="How many refusals box the client."
            error={errors['penalty.after']}
            value={value.after}
            min={1}
            onChange={(after) => onChange({ ...value, after })}
          />
          <NumberField
            label="Within (seconds)"
            hint="The window the refusals count in."
            error={errors['penalty.within_seconds']}
            value={value.within_seconds}
            min={1}
            onChange={(within_seconds) => onChange({ ...value, within_seconds })}
          />
        </div>
      )}
    </div>
  );
}
