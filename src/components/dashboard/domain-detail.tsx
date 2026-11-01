import { useState, type ReactNode } from 'react';
import { InfoCircle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Pill } from '@/components/dashboard/resource-table';
import { defaultBlocker, useDomainDetail, useSetDefaultDomain } from '@/lib/api/domain-detail';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApps } from '@/lib/api/queries';
import { InlinePhase, queryPhase } from './primitives';

/**
 * One custom domain in full (`GET /v1/domains/{domain}`): where it routes,
 * whether it is its app's default, the live certificate, and the DNS records
 * to publish. The domains table keeps the one thing an unverified row needs
 * inline (its TXT record); everything else lives here.
 *
 * The default is the app's canonical host — the `canonical_url` the console,
 * CLI and API hand out for it (faas handlers.go appResponse). The platform
 * hostname keeps serving and nothing redirects, so the confirmation says both.
 */

const CERT_COLOR: Record<string, string> = {
  issued: 'var(--status-good)',
  pending: 'var(--status-warning)',
  renewing: 'var(--status-warning)',
  dns_drifted: 'var(--status-warning)',
  failed: 'var(--status-critical)',
};

/** Why the default is out of reach, in the handler's own order. */
const BLOCKED: Record<'unverified' | 'environment' | 'wildcard', (env?: string) => string> = {
  unverified: () => 'Verify this domain before making it the default.',
  environment: (env) =>
    `It routes only to the ${env} environment, so it cannot be the app's default.`,
  wildcard: () => 'A wildcard cannot be the default. Add a concrete hostname under it instead.',
};

function formatDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? null : new Date(ms).toLocaleDateString();
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3 py-2">
      <dt className="label-mono text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3 className="text-sm font-medium">{title}</h3>
      <dl className="flex flex-col divide-y divide-border">{children}</dl>
    </section>
  );
}

export function DomainDetail({ domain }: { domain: string }) {
  const { data, isPending, error, refetch } = useDomainDetail(domain);
  const apps = useApps().data;
  const setDefault = useSetDefaultDomain();
  const confirm = useConfirm();
  const { toast } = useToast();

  if (error || (!isPending && !data)) {
    const err = error ?? new Error('No domain was returned.');
    return (
      <InlinePhase phase={queryPhase({ error: err })} error={err} onRetry={() => void refetch()} />
    );
  }
  if (isPending) {
    return <InlinePhase phase="loading" loadingMessage={`Reading ${domain}…`} />;
  }

  const app = apps?.find((a) => a.id === data.app_id);
  const slug = app?.slug ?? data.app_id;
  const blocker = defaultBlocker(data);

  const makeDefault = async () => {
    const next = `https://${data.domain}`;
    const current = app?.canonical_url ?? app?.url;
    const ok = await confirm({
      title: `Make ${data.domain} the default for ${slug}?`,
      description: [
        `Links to ${slug} from the console, CLI and API will use ${next}`,
        current && current !== next ? ` instead of ${current}.` : '.',
        app?.url ? ` ${app.url} keeps working, and nothing redirects to the new address.` : '',
      ].join(''),
      confirmLabel: 'Make default',
    });
    if (!ok) return;
    try {
      await setDefault.mutateAsync(data.domain);
      toast({ kind: 'success', title: `${data.domain} is now the default` });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'domain_not_verified') {
        toast({
          kind: 'error',
          title: `${data.domain} is not verified`,
          description: 'Its verification lapsed since this was opened. Showing what it is now.',
        });
        void refetch();
        return;
      }
      toast({ kind: 'error', title: 'Could not set the default', description: errorMessage(err) });
    }
  };

  const status = data.cert_status ?? 'pending';
  const dialFailure = status.startsWith('dial_failed:') ? status.slice(12) : null;
  const expires = formatDate(data.cert_not_after ?? data.cert_expires_at);

  return (
    <div className="flex flex-col gap-5">
      <Section title="Routing">
        <Row label="Routes to">
          <span className="font-mono">{slug}</span>
        </Row>
        {data.environment && (
          <Row label="Environment">
            <span className="font-mono">{data.environment}</span>
          </Row>
        )}
        <Row label="Default">
          {blocker === 'already' ? (
            <span>This is the default domain for {slug}.</span>
          ) : blocker ? (
            <span className="text-muted-foreground">{BLOCKED[blocker](data.environment)}</span>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-muted-foreground">Not the default.</span>
              <Button
                size="sm"
                variant="secondary"
                busy={setDefault.isPending}
                onClick={() => void makeDefault()}
              >
                Make default
              </Button>
            </div>
          )}
        </Row>
        <Row label="Verified">{formatDate(data.verified_at) ?? 'Not yet'}</Row>
      </Section>

      <Section title="Certificate">
        <Row label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <Pill
              label={dialFailure ? 'unreachable' : status.replace('_', ' ')}
              color={dialFailure ? 'var(--status-critical)' : CERT_COLOR[status]}
            />
            {dialFailure && <code className="break-all text-xs">{dialFailure}</code>}
          </span>
        </Row>
        {expires && <Row label="Expires">{expires}</Row>}
        {data.cert_sans && data.cert_sans.length > 0 && (
          <Row label="Names">
            <ul className="flex flex-col gap-0.5 font-mono text-xs">
              {data.cert_sans.map((san) => (
                <li key={san} className="break-all">
                  {san}
                </li>
              ))}
            </ul>
          </Row>
        )}
        {data.cert_last_error && (
          <Row label="Last error">
            <span className="break-words text-xs" style={{ color: 'var(--status-critical)' }}>
              {data.cert_last_error}
            </span>
          </Row>
        )}
        {formatDate(data.dns_last_checked_at) && (
          <Row label="DNS checked">{formatDate(data.dns_last_checked_at)}</Row>
        )}
      </Section>

      {data.dns_records && data.dns_records.length > 0 && (
        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">DNS records</h3>
          <ul className="flex flex-col divide-y divide-border">
            {data.dns_records.map((record) => (
              <li
                key={`${record.type} ${record.name} ${record.value}`}
                className="flex flex-col gap-1 py-2"
              >
                <span className="flex flex-wrap items-center gap-2">
                  <Pill label={record.type} />
                  <span className="text-xs text-muted-foreground">
                    {record.purpose === 'verification' ? 'Proves ownership' : 'Routes traffic'}
                    {record.alternative && ', instead of the CNAME at a zone apex'}
                  </span>
                </span>
                <code className="select-all break-all text-xs">{record.name}</code>
                <code className="select-all break-all text-xs text-muted-foreground">
                  {record.value}
                </code>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/** The row action that opens a domain's detail. Self-contained, so the page adds one line. */
export function DomainDetailButton({ domain }: { domain: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <IconButton
        type="button"
        aria-label={`Details for ${domain}`}
        onClick={() => setOpen(true)}
        className="text-muted-foreground transition-colors hover:text-foreground"
      >
        <InfoCircle className="h-3.5 w-3.5" />
      </IconButton>
      {open && (
        <Modal
          open
          onClose={() => setOpen(false)}
          width="max-w-2xl"
          title={domain}
          description="Routing, certificate and DNS, read live from the platform."
        >
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <DomainDetail domain={domain} />
          </div>
        </Modal>
      )}
    </>
  );
}
