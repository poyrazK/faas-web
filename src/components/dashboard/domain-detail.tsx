import { useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { defaultBlocker, useDomainDetail, useSetDefaultDomain } from '@/lib/api/domain-detail';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useApps } from '@/lib/api/queries';
import { isWildcardDomain } from '@/lib/api/domain-hosts';
import { DomainHosts } from './domain-hosts';
import { DnsRecordList, Reveal, StatusWord } from './domain-records';
import {
  describeCertificate,
  describeDomain,
  routingRecords,
  verificationRecord,
} from './domain-words';
import { InlinePhase, queryPhase } from './primitives';

/**
 * One custom domain in full (`GET /v1/domains/{domain}`), in plain words:
 * the state and what it means first, then where it routes and whether it is
 * its app's main address, the DNS records to publish, and the certificate.
 * The certificate's names, raw state and last error sit behind "Show
 * certificate details".
 *
 * The default is the app's canonical host — the `canonical_url` the console,
 * CLI and API hand out for it (faas handlers.go appResponse). The platform
 * hostname keeps serving and nothing redirects, so the confirmation says both.
 */

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
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm">{children}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h3 className="bento-label">{title}</h3>
      {children}
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
  const words = describeDomain(data, { app: slug });
  const cert = describeCertificate(data.cert_status);
  const expires = formatDate(data.cert_not_after ?? data.cert_expires_at);
  const txt = verificationRecord(data);
  const { main, alternatives } = routingRecords(data);
  const records = [...(txt ? [txt] : []), ...main, ...alternatives];
  const checked = formatDate(data.dns_last_checked_at);

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

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-1.5">
        <StatusWord word={words.word} tone={words.tone} title={words.term} />
        <p className="text-[15px] leading-6">{words.sentence}</p>
      </div>

      <Section title="Routing">
        <dl className="flex flex-col divide-y divide-border">
          <Row label="Routes to">
            <span className="font-mono">{slug}</span>
          </Row>
          {data.environment && (
            <Row label="Environment">
              <span className="font-mono">{data.environment}</span>
            </Row>
          )}
          <Row label="Main address">
            {blocker === 'already' ? (
              <span>This is the default domain for {slug}.</span>
            ) : blocker ? (
              <span className="text-muted-foreground">{BLOCKED[blocker](data.environment)}</span>
            ) : (
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-muted-foreground">Links to {slug} use another address.</span>
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
        </dl>
      </Section>

      {records.length > 0 && (
        <Section title="DNS records">
          <DnsRecordList records={records} label={`DNS records for ${data.domain}`} />
        </Section>
      )}

      <Section title="HTTPS certificate">
        <div className="flex flex-col gap-1">
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusWord word={cert.word} tone={cert.tone} title={data.cert_status ?? undefined} />
            {expires && (
              <span className="text-xs text-muted-foreground">Valid until {expires}</span>
            )}
          </span>
          <p className="text-sm text-muted-foreground">{cert.sentence}</p>
        </div>
        <Reveal show="Show certificate details" hide="Hide certificate details">
          <dl className="flex flex-col divide-y divide-border">
            <Row label="State">
              <code className="text-xs">{data.cert_status ?? '—'}</code>
            </Row>
            {cert.reason && (
              <Row label="Reason">
                <code className="break-all text-xs">{cert.reason}</code>
              </Row>
            )}
            {data.cert_sans && data.cert_sans.length > 0 && (
              <Row label="Names covered">
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
            {checked && <Row label="DNS checked">{checked}</Row>}
          </dl>
        </Reveal>
      </Section>

      {isWildcardDomain(data.domain) && <DomainHosts domain={data.domain} />}
    </div>
  );
}

/** The card action that opens a domain's detail. Self-contained, so the page adds one line. */
export function DomainDetailButton({ domain }: { domain: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button
        size="sm"
        variant="ghost"
        aria-label={`Details for ${domain}`}
        onClick={() => setOpen(true)}
        className="text-muted-foreground hover:text-foreground"
      >
        Details
      </Button>
      {open && (
        <Modal open onClose={() => setOpen(false)} width="max-w-2xl" title={domain}>
          <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto p-1">
            <DomainDetail domain={domain} />
          </div>
        </Modal>
      )}
    </>
  );
}
