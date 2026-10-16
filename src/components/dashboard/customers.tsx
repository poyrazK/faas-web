import { useMemo, useState, type FormEvent } from 'react';
import { Plus, Xmark } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Select } from '@/components/ui/field';
import { FormField } from '@/components/ui/form-field';
import { Input } from '@/components/ui/input';
import { Modal } from '@/components/ui/modal';
import { useToast } from '@/components/ui/toast';
import { useApps, useTenantSurfaces } from '@/lib/api/queries';
import {
  useConsumers,
  useLinkTenantConsumer,
  useLinkTenantSurface,
  usePlatformTenant,
  usePlatformTenants,
  useRegisterTenant,
  useSetTenantStatus,
  useTenantCredentials,
  type PlatformTenant,
  type PlatformTenantDetail,
} from '@/lib/api/monetization';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { Pill, ResourceTable, type Column } from './resource-table';
import { SegmentedControl } from './tabs';
import { TenantRateCards, TenantStatements, TenantUsage } from './customer-billing';
import {
  DetailRegion,
  Facts,
  MonetizationGate,
  STATUS_COLOR,
  explainWrite,
  formatUtc,
  formatUtcDate,
  useAppNames,
} from './monetization-shared';

/**
 * Customers: account-level platform tenants. One customer groups the app
 * consumers and tenant surfaces that belong to the same end customer across
 * apps, carries a tenant-wide price, and is billed with cross-app statements.
 *
 * The default view is the list and "Register customer"; links, prices, usage,
 * statements and credential metadata open behind a row.
 */
export function Customers() {
  return (
    <MonetizationGate title="Customers">
      <CustomersBody />
    </MonetizationGate>
  );
}

type Row = Pick<PlatformTenant, 'id' | 'name' | 'external_ref' | 'status' | 'created_at'>;

function CustomersBody() {
  const tenants = usePlatformTenants();
  const [selectedId, setSelectedId] = useState('');
  const [registering, setRegistering] = useState(false);
  const rows: Row[] = useMemo(
    () => tenants.data?.pages.flatMap((page) => page.tenants) ?? [],
    [tenants.data]
  );
  const columns: Column<Row>[] = [
    {
      key: 'name',
      label: 'Customer',
      sortable: true,
      render: (r) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{r.name}</span>
          <span className="truncate font-mono text-xs text-muted-foreground">{r.external_ref}</span>
        </div>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (r) => <Pill label={r.status} color={STATUS_COLOR[r.status]} />,
    },
    {
      key: 'created_at',
      label: 'Registered',
      sortable: true,
      priority: 'secondary',
      render: (r) => formatUtcDate(r.created_at),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <Panel
        title="Customers"
        description="Each customer groups the consumers and hostnames of one end customer across your apps."
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setRegistering(true)}>
            <Plus className="h-3.5 w-3.5" />
            Register customer
          </Button>
        }
      >
        <div className="flex flex-col gap-3">
          <ResourceTable
            rows={rows}
            columns={columns}
            searchKeys={['name', 'external_ref']}
            searchPlaceholder="Filter by name or external reference…"
            onRowClick={(r) => setSelectedId(r.id)}
            loading={tenants.isPending}
            error={tenants.error}
            onRetry={() => void tenants.refetch()}
            emptyMessage="No customers yet. Register one with the reference your own systems use."
            minWidth="min-w-[480px]"
          />
          {tenants.hasNextPage && (
            <div>
              <Button
                size="sm"
                variant="outline"
                busy={tenants.isFetchingNextPage}
                onClick={() => void tenants.fetchNextPage()}
              >
                Load more customers
              </Button>
            </div>
          )}
        </div>
      </Panel>
      {selectedId && (
        <DetailRegion key={selectedId} label="Customer details">
          <CustomerDetail id={selectedId} onClose={() => setSelectedId('')} />
        </DetailRegion>
      )}
      <RegisterCustomer
        open={registering}
        onClose={() => setRegistering(false)}
        onRegistered={setSelectedId}
      />
    </div>
  );
}

function RegisterCustomer({
  open,
  onClose,
  onRegistered,
}: {
  open: boolean;
  onClose: () => void;
  onRegistered: (id: string) => void;
}) {
  const register = useRegisterTenant();
  const { toast } = useToast();
  const [externalRef, setExternalRef] = useState('');
  const [name, setName] = useState('');
  const [attempted, setAttempted] = useState(false);
  const [failure, setFailure] = useState<{ title: string; description?: string } | null>(null);
  const refError =
    externalRef.trim().length === 0
      ? 'Enter the reference your systems use for this customer.'
      : externalRef.trim().length > 256
        ? 'Use 256 characters or fewer.'
        : undefined;
  const nameError =
    name.trim().length === 0
      ? 'Enter a display name.'
      : name.trim().length > 128
        ? 'Use 128 characters or fewer.'
        : undefined;
  const close = () => {
    setExternalRef('');
    setName('');
    setAttempted(false);
    setFailure(null);
    onClose();
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setAttempted(true);
    if (refError || nameError || register.isPending) return;
    setFailure(null);
    try {
      const { tenant, existing } = await register.mutateAsync({
        external_ref: externalRef.trim(),
        name: name.trim(),
      });
      toast(
        existing
          ? {
              kind: 'info',
              title: `${tenant.name} was already registered`,
              description: 'Registration is idempotent by external reference; nothing changed.',
            }
          : { kind: 'success', title: `${tenant.name} registered` }
      );
      onRegistered(tenant.id);
      close();
    } catch (err) {
      setFailure(
        explainWrite(
          err,
          'register the customer',
          'This external reference is already registered under another name'
        )
      );
    }
  };
  return (
    <Modal
      open={open}
      onClose={close}
      title="Register customer"
      description="Registering the same external reference and name again returns the existing customer."
    >
      <form className="flex flex-col gap-4" onSubmit={(e) => void submit(e)} noValidate>
        <FormField
          id="customer-external-ref"
          label="External reference"
          hint="Your own ID for this customer, such as a CRM or billing account ID."
          error={refError}
          showError={attempted}
        >
          {(props) => (
            <Input
              {...props}
              value={externalRef}
              onChange={(e) => setExternalRef(e.target.value)}
              placeholder="crm-1001"
              autoComplete="off"
            />
          )}
        </FormField>
        <FormField id="customer-name" label="Name" error={nameError} showError={attempted}>
          {(props) => (
            <Input
              {...props}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Acme Corporation"
              autoComplete="off"
            />
          )}
        </FormField>
        {failure && (
          <div role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
            <p className="font-medium">{failure.title}</p>
            {failure.description && <p className="text-muted-foreground">{failure.description}</p>}
          </div>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button type="submit" busy={register.isPending}>
            Register customer
          </Button>
        </div>
      </form>
    </Modal>
  );
}

type Section = 'links' | 'prices' | 'usage' | 'statements' | 'credentials';
const SECTIONS: { key: Section; label: string }[] = [
  { key: 'links', label: 'Consumers & surfaces' },
  { key: 'prices', label: 'Rate cards' },
  { key: 'usage', label: 'Usage' },
  { key: 'statements', label: 'Statements' },
  { key: 'credentials', label: 'Credentials' },
];

export function suspendCopy(name: string, suspended: boolean) {
  return suspended
    ? {
        title: `Resume ${name}?`,
        description:
          'Credentials of linked consumers and hostnames of linked surfaces are served again.',
        confirmLabel: 'Resume customer',
      }
    : {
        title: `Suspend ${name}?`,
        description:
          'Suspending blocks the credentials of every linked consumer and the hostnames of every linked tenant surface, across all apps. Anonymous traffic, independent JWT auth and unrelated app domains keep their own access policy. You can resume later.',
        confirmLabel: 'Suspend customer',
      };
}

function CustomerDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const detail = usePlatformTenant(id);
  const setStatus = useSetTenantStatus(id);
  const confirm = useConfirm();
  const { toast } = useToast();
  const [section, setSection] = useState<Section>('links');
  const tenant = detail.data;
  const phase = queryPhase({ error: detail.error, loading: detail.isPending });

  const toggle = async () => {
    if (!tenant) return;
    const suspended = tenant.status === 'suspended';
    const copy = suspendCopy(tenant.name, suspended);
    if (!(await confirm({ ...copy, destructive: !suspended }))) return;
    try {
      const next = await setStatus.mutateAsync(suspended ? 'active' : 'suspended');
      toast({
        kind: 'success',
        title: next.status === 'suspended' ? `${next.name} suspended` : `${next.name} resumed`,
      });
    } catch (err) {
      toast(explainWrite(err, suspended ? 'resume the customer' : 'suspend the customer'));
    }
  };

  return (
    <Panel
      title={tenant?.name ?? 'Customer'}
      description={tenant ? `External reference ${tenant.external_ref}` : undefined}
      actions={
        <div className="flex items-center gap-2">
          {tenant && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => void toggle()}
              busy={setStatus.isPending}
            >
              {tenant.status === 'suspended' ? 'Resume customer' : 'Suspend customer'}
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onClose} aria-label="Close customer details">
            <Xmark className="h-3.5 w-3.5" />
          </Button>
        </div>
      }
    >
      <InlinePhase
        phase={phase}
        error={detail.error}
        loadingMessage="Loading customer…"
        onRetry={() => void detail.refetch()}
      />
      {tenant && (
        <div className="flex flex-col gap-5">
          <Facts
            items={[
              [
                'Status',
                <Pill key="s" label={tenant.status} color={STATUS_COLOR[tenant.status]} />,
              ],
              [
                'Customer ID',
                <span key="id" className="font-mono text-xs">
                  {tenant.id}
                </span>,
              ],
              ['Registered', formatUtc(tenant.created_at)],
              ['Updated', formatUtc(tenant.updated_at)],
            ]}
          />
          {tenant.status === 'suspended' && (
            <p className="text-sm" style={{ color: 'var(--status-serious)' }}>
              Suspended: linked consumer credentials and surface hostnames are blocked.
            </p>
          )}
          <SegmentedControl
            label="Customer sections"
            value={section}
            options={SECTIONS}
            onChange={setSection}
          />
          {section === 'links' && <CustomerLinks tenant={tenant} />}
          {section === 'prices' && <TenantRateCards tenantId={tenant.id} />}
          {section === 'usage' && <TenantUsage tenant={tenant} />}
          {section === 'statements' && <TenantStatements tenantId={tenant.id} />}
          {section === 'credentials' && <CustomerCredentials tenant={tenant} />}
        </div>
      )}
    </Panel>
  );
}

function CustomerLinks({ tenant }: { tenant: PlatformTenantDetail }) {
  const appNames = useAppNames();
  const [linking, setLinking] = useState(false);
  const app = (id: string) => appNames.get(id) ?? id;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Consumers</p>
        {tenant.consumers.length === 0 ? (
          <p className="text-sm text-muted-foreground">No app consumers linked.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {tenant.consumers.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="text-sm font-medium">{c.name}</span>
                <span className="font-mono text-xs text-muted-foreground">{c.external_ref}</span>
                <span className="text-xs text-muted-foreground">app {app(c.app_id)}</span>
                {c.managed_by_platform_tenant && (
                  <span className="text-xs text-muted-foreground">
                    created by a customer bundle
                  </span>
                )}
                <span className="ml-auto">
                  <Pill label={c.status} color={STATUS_COLOR[c.status]} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-sm font-medium">Tenant surfaces</p>
        {tenant.surfaces.length === 0 ? (
          <p className="text-sm text-muted-foreground">No tenant surfaces linked.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
            {tenant.surfaces.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="text-xs text-muted-foreground">app {app(s.app_id)}</span>
                <span className="ml-auto">
                  <Pill label={s.status} color={STATUS_COLOR[s.status]} />
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Hostnames live on each app&rsquo;s Tenant surfaces tab.
        </p>
      </div>
      {linking ? (
        <LinkExisting tenantId={tenant.id} onDone={() => setLinking(false)} />
      ) : (
        <div>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setLinking(true)}>
            <Plus className="h-3.5 w-3.5" />
            Link existing
          </Button>
        </div>
      )}
    </div>
  );
}

function LinkExisting({ tenantId, onDone }: { tenantId: string; onDone: () => void }) {
  const apps = useApps();
  const [kind, setKind] = useState<'consumer' | 'surface'>('consumer');
  const [slug, setSlug] = useState('');
  const [target, setTarget] = useState('');
  const consumers = useConsumers(slug, kind === 'consumer');
  const surfaces = useTenantSurfaces(kind === 'surface' ? slug : '');
  const linkConsumer = useLinkTenantConsumer(tenantId);
  const linkSurface = useLinkTenantSurface(tenantId);
  const { toast } = useToast();
  const options =
    kind === 'consumer'
      ? (consumers.data?.consumers ?? []).map((c) => ({
          id: c.id,
          label: `${c.name} (${c.external_ref})`,
        }))
      : (surfaces.data?.surfaces ?? []).map((s) => ({ id: s.id, label: s.name }));
  const source = kind === 'consumer' ? consumers : surfaces;
  const busy = linkConsumer.isPending || linkSurface.isPending;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!target || busy) return;
    try {
      if (kind === 'consumer') await linkConsumer.mutateAsync(target);
      else await linkSurface.mutateAsync(target);
      toast({ kind: 'success', title: kind === 'consumer' ? 'Consumer linked' : 'Surface linked' });
      onDone();
    } catch (err) {
      toast(
        explainWrite(err, `link the ${kind}`, `That ${kind} is already linked to another customer`)
      );
    }
  };

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border border-border p-4"
      onSubmit={(e) => void submit(e)}
    >
      <SegmentedControl
        label="What to link"
        value={kind}
        options={[
          { key: 'consumer', label: 'Consumer' },
          { key: 'surface', label: 'Tenant surface' },
        ]}
        onChange={(next) => {
          setKind(next);
          setTarget('');
        }}
      />
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-40 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">App</span>
          <Select
            value={slug}
            onChange={(e) => {
              setSlug(e.target.value);
              setTarget('');
            }}
            aria-label="App"
          >
            <option value="">Choose an app…</option>
            {apps.data?.map((a) => (
              <option key={a.id} value={a.slug}>
                {a.slug}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-w-56 flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">
            {kind === 'consumer' ? 'Consumer' : 'Surface'}
          </span>
          <Select
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            disabled={!slug || options.length === 0}
            aria-label={kind === 'consumer' ? 'Consumer to link' : 'Surface to link'}
          >
            <option value="">
              {!slug
                ? 'Choose an app first'
                : source.isPending
                  ? 'Loading…'
                  : options.length === 0
                    ? 'None in this app'
                    : 'Choose…'}
            </option>
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
        <Button type="submit" size="sm" disabled={!target} busy={busy}>
          Link
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          Cancel
        </Button>
      </div>
      {Boolean(slug && source.error) && (
        <InlinePhase phase={queryPhase({ error: source.error })} error={source.error} />
      )}
    </form>
  );
}

function CustomerCredentials({ tenant }: { tenant: PlatformTenantDetail }) {
  const credentials = useTenantCredentials(tenant.id);
  const names = new Map(tenant.consumers.map((c) => [c.id, c.name] as const));
  const phase = queryPhase({
    error: credentials.error,
    loading: credentials.isPending,
    isEmpty: credentials.data?.length === 0,
  });
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        Metadata only; plaintext keys are never returned. Keys are issued per consumer on each
        app&rsquo;s Consumers tab.
      </p>
      <InlinePhase
        phase={phase}
        error={credentials.error}
        loadingMessage="Loading credentials…"
        emptyMessage="No keys on linked consumers."
        onRetry={() => void credentials.refetch()}
      />
      {phase === 'ready' && (
        <ul className="flex flex-col divide-y divide-border rounded-lg border border-border">
          {credentials.data?.map((k) => (
            <li
              key={k.id ?? `${k.consumer_id}:${k.prefix}`}
              className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2"
            >
              <span className="text-sm font-medium">{k.name}</span>
              <span className="font-mono text-xs text-muted-foreground">{k.prefix}…</span>
              <span className="text-xs text-muted-foreground">
                {names.get(k.consumer_id) ?? k.consumer_id} · {k.scopes.join(', ')}
              </span>
              <span className="text-xs text-muted-foreground">
                {k.last_used_at ? `last used ${formatUtc(k.last_used_at)}` : 'never used'}
              </span>
              {k.revoked_at && (
                <span className="ml-auto">
                  <Pill label="revoked" color={STATUS_COLOR.revoked} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
