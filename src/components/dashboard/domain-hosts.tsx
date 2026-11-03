import { useId, useState, type FormEvent, type ReactNode } from 'react';
import { Globe, Lock } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FieldError, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import {
  HOSTS_MAX,
  parseHostNames,
  probeHost,
  useClearDomainHosts,
  useDomainHosts,
  useSetDomainHosts,
  wildcardSuffix,
} from '@/lib/api/domain-hosts';
import { InlinePhase, queryPhase } from './primitives';

/**
 * A wildcard domain's host allowlist, in its detail (faas pkg/apid/domainhosts).
 *
 * Without a list, any server name below the wildcard can make the edge obtain
 * a certificate, and each new one spends the wildcard's 40-per-week budget, so
 * random names can exhaust it. A list confines certificates to the names the
 * customer serves. Two documented edges are said where they bite: the doctor's
 * probe host is always allowed, and a certificate the edge already holds for a
 * removed name keeps serving until its next reload or renewal.
 */
export function DomainHosts({ domain }: { domain: string }) {
  const query = useDomainHosts(domain);
  const save = useSetDomainHosts(domain);
  const clear = useClearDomainHosts(domain);
  const confirm = useConfirm();
  const { toast } = useToast();
  const fieldId = useId();
  const hintId = useId();
  const errorId = useId();
  // null while the list is shown; the textarea's text while it is edited.
  const [draft, setDraft] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<unknown>(null);
  const suffix = wildcardSuffix(domain);
  const phase = queryPhase({ error: query.error, loading: query.isPending });

  if (phase !== 'ready' || !query.data) {
    return (
      <Frame>
        <InlinePhase
          phase={phase}
          error={query.error}
          loadingMessage="Reading the host allowlist…"
          onRetry={() => void query.refetch()}
        />
      </Frame>
    );
  }

  const listed = query.data.names;
  const restricted = query.data.restricted;
  const parsed = draft === null ? null : parseHostNames(domain, draft);
  const draftError = !parsed
    ? undefined
    : parsed.invalid.length > 0
      ? `${parsed.invalid.join(', ')} ${parsed.invalid.length === 1 ? 'is' : 'are'} not a name below ${domain}.`
      : parsed.names.length === 0
        ? 'List at least one name. To let every name get a certificate, remove the allowlist instead.'
        : parsed.names.length > HOSTS_MAX
          ? `At most ${HOSTS_MAX} names; this list has ${parsed.names.length}.`
          : undefined;
  const shownError = attempted ? draftError : undefined;
  const dropped = parsed ? listed.filter((name) => !parsed.names.includes(name)) : [];

  const edit = () => {
    setDraft(listed.join('\n'));
    setAttempted(false);
    setFailure(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setAttempted(true);
    if (!parsed || draftError || save.isPending) return;
    setFailure(null);
    try {
      await save.mutateAsync(parsed.names);
      setDraft(null);
      toast({ kind: 'success', title: `Saved the host allowlist for ${domain}` });
    } catch (err) {
      // The draft stays, so a refused name can be fixed in place.
      setFailure(err);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Remove the host allowlist for ${domain}?`,
      description: `Every name below ${suffix} may get a certificate again, so random names can use up the 40 new certificates this wildcard gets in any 7 days. Routing does not change.`,
      confirmLabel: 'Remove allowlist',
      destructive: true,
    });
    if (!ok) return;
    try {
      await clear.mutateAsync();
      toast({ kind: 'success', title: `Every name below ${suffix} may get a certificate` });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not remove the allowlist', error: err });
    }
  };

  return (
    <Frame>
      <div className="flex flex-col gap-2 text-sm">
        <AllowlistState restricted={restricted} />
        <p className="text-muted-foreground">
          {restricted
            ? `Only these names below ${suffix} get certificates; the edge refuses any other name. Routing does not change.`
            : `Every name below ${suffix} may get a certificate, and each new one uses one of the 40 new certificates this wildcard gets in any 7 days. List the names you serve, and the edge refuses a certificate for any other.`}
        </p>
        <p className="text-xs text-muted-foreground">
          <code className="break-all">{probeHost(domain)}</code>, which the domain doctor checks, is
          always allowed.
        </p>
      </div>

      {draft === null ? (
        <>
          {restricted && (
            <ul aria-label="Allowed names" className="flex flex-col divide-y divide-border">
              {listed.map((name) => (
                <li key={name} className="break-all py-1.5 font-mono text-xs">
                  {name}
                  <span className="text-muted-foreground">.{suffix}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={edit}>
              {restricted ? 'Edit names' : 'Restrict to listed names'}
            </Button>
            {restricted && (
              <Button
                size="sm"
                variant="outline"
                busy={clear.isPending}
                onClick={() => void remove()}
              >
                Remove allowlist
              </Button>
            )}
          </div>
        </>
      ) : (
        <form className="flex flex-col gap-2" onSubmit={(event) => void submit(event)} noValidate>
          <label htmlFor={fieldId} className="label-mono text-muted-foreground">
            Names
          </label>
          <Textarea
            id={fieldId}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={5}
            spellCheck={false}
            autoCapitalize="none"
            placeholder={`api\neu.shop`}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={shownError ? `${errorId} ${hintId}` : hintId}
            className="font-mono"
          />
          {shownError && <FieldError id={errorId}>{shownError}</FieldError>}
          <div id={hintId} className="flex flex-col gap-1 text-xs text-muted-foreground">
            <p>
              One per line: the part before .{suffix} (eu.shop for eu.shop.{suffix}), or the full
              host. Up to {HOSTS_MAX}.
            </p>
            <p>
              A name you leave out is refused a new certificate. One the edge already holds keeps
              serving until its next reload or renewal.
            </p>
          </div>
          {dropped.length > 0 && (
            <p className="text-xs" style={{ color: 'var(--status-warning)' }}>
              Removing {dropped.map((name) => `${name}.${suffix}`).join(', ')}.
            </p>
          )}
          {failure !== null && (
            <InlinePhase phase={queryPhase({ error: failure })} error={failure} />
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" busy={save.isPending}>
              Save names
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Frame>
  );
}

function Frame({ children }: { children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-medium">Host allowlist</h3>
      {children}
    </section>
  );
}

/** Colour, icon and label: which names may hold a certificate. */
function AllowlistState({ restricted }: { restricted: boolean }) {
  const color = restricted ? 'var(--status-good)' : 'var(--chart-muted)';
  const Icon = restricted ? Lock : Globe;
  return (
    <span
      className="inline-flex w-fit items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs"
      style={{ borderColor: `color-mix(in oklab, ${color} 35%, transparent)`, color }}
    >
      <Icon aria-hidden className="h-3 w-3" />
      {restricted ? 'Listed names only' : 'Every name'}
    </span>
  );
}
