import { useId } from 'react';
import { CheckCircle, RefreshDouble, WarningTriangle } from 'iconoir-react';
import { Textarea } from '@/components/ui/field';
import { ApiError } from '@/lib/api/errors';
import { isCidr, parseCidrs } from '@/lib/api/networks';

/**
 * Pending, ready and error, as the API reports them for networks, peerings,
 * attachments and per-node convergence. Pending and error are fail-closed:
 * neither admits private traffic, so neither is drawn as healthy.
 */
const STATUS = {
  ready: ['Ready', 'var(--status-good)', CheckCircle],
  pending: ['Pending', 'var(--status-warning)', RefreshDouble],
  error: ['Error', 'var(--status-critical)', WarningTriangle],
} as const;

export function NetworkStatus({ status }: { status: keyof typeof STATUS }) {
  const [label, color, Icon] = STATUS[status];
  return (
    <span
      className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon className="size-3" aria-hidden />
      {label}
    </span>
  );
}

export type NetworkToast = {
  kind: 'info' | 'error';
  title: string;
  description?: string;
  error?: unknown;
};

/** The installation has not turned private networking on (503 private_network_not_enabled). */
export const isNotEnabled = (error: unknown) =>
  error instanceof ApiError && error.code === 'private_network_not_enabled';

/** What a refused network write means, by the stable code (handlers_private_networks.go). */
export function networkFailure(error: unknown, fallback: string, conflict?: string): NetworkToast {
  const code = error instanceof ApiError ? error.code : '';
  switch (code) {
    case 'plan_private_network_not_allowed':
      return {
        kind: 'info',
        title: 'Not included in your plan',
        description: 'Private networks are on the Pro and Scale plans.',
        error,
      };
    case 'private_network_not_enabled':
      return {
        kind: 'info',
        title: 'Private networking is not enabled',
        description: 'This installation has not turned private networks on. Contact support.',
      };
    case 'conflict':
      return { kind: 'error', title: fallback, description: conflict, error };
    case 'not_found':
      return {
        kind: 'info',
        title: 'Not found',
        description: 'It was removed elsewhere. The list is refreshed.',
      };
    default:
      return { kind: 'error', title: fallback, error };
  }
}

/** A CIDR list field: one range per line or comma, each checked as IPv4 CIDR. */
export function CidrListField({
  label,
  hint,
  value,
  onChange,
  placeholder = '10.42.8.0/24',
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  const errorId = useId();
  const bad = parseCidrs(value).filter((c) => !isCidr(c));
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      {label}
      <Textarea
        rows={2}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="font-mono"
        aria-invalid={bad.length ? true : undefined}
        aria-describedby={bad.length ? errorId : undefined}
      />
      {bad.length > 0 ? (
        <span id={errorId} className="text-xs" style={{ color: 'var(--status-critical)' }}>
          Not an IPv4 CIDR: {bad.join(', ')}
        </span>
      ) : (
        <span className="text-xs text-muted-foreground">{hint}</span>
      )}
    </label>
  );
}

export const cidrsValid = (value: string) => parseCidrs(value).every(isCidr);
