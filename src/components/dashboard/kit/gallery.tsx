import { useState, type ReactNode } from 'react';
import { Plus } from 'iconoir-react';
import {
  EmptyState,
  ErrorState,
  InlinePhase,
  LoadingState,
  PageHeader,
  Panel,
  RangeSelector,
  StateBadge,
  Stats,
  StatTile,
  UnreachableState,
  type QueryPhase,
} from '../primitives';
import { Pill, ResourceTable, type Column } from '../resource-table';
import { SegmentedControl, Tabs } from '../tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/field';
import { ApiError } from '@/lib/api/errors';
import { Sparkline, TimeChart } from './chart';
import { HelpTip } from './help-tip';
import { Sheet } from './sheet';

/**
 * Every console primitive in every read state, on one page.
 *
 * Dev-only (see `routes/dashboard.kit.tsx`). The figures below are samples for
 * looking at components, which is why they may live here and nowhere else in
 * `src`.
 */

const ERROR = new ApiError({
  type: 'about:blank',
  title: 'Request failed',
  status: 409,
  code: 'conflict',
  detail: 'That name is already taken.',
});

const HOURS = Array.from({ length: 24 }, (_, i) => {
  const wave = Math.sin(i / 3.5) * 120 + 300;
  return {
    at: `${String(i).padStart(2, '0')}:00`,
    requests: Math.round(wave + (i % 5) * 18),
    errors: Math.round((i === 17 ? 40 : 3) + (i % 3)),
  };
});

interface Row {
  id: string;
  name: string;
  state: 'running' | 'idle' | 'error' | 'deploying';
  requests: number;
  p95: number;
}

const ROWS: Row[] = [
  { id: 'api-gateway', name: 'api-gateway', state: 'running', requests: 441600, p95: 123 },
  { id: 'image-resize', name: 'image-resize', state: 'deploying', requests: 154560, p95: 159 },
  { id: 'webhook-router', name: 'webhook-router', state: 'idle', requests: 264960, p95: 107 },
  { id: 'billing-recon', name: 'billing-recon', state: 'error', requests: 22080, p95: 335 },
];

const COLUMNS: Column<Row>[] = [
  { key: 'name', label: 'App', render: (r) => <span className="font-mono">{r.name}</span> },
  { key: 'state', label: 'State', render: (r) => <StateBadge state={r.state} /> },
  { key: 'requests', label: 'Requests', numeric: true, render: (r) => r.requests.toLocaleString() },
  { key: 'p95', label: 'p95', numeric: true, render: (r) => `${r.p95} ms` },
];

const PHASES: QueryPhase[] = ['ready', 'loading', 'empty', 'error', 'unreachable'];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="border-b border-border pb-1.5 text-xs font-medium text-muted-foreground">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default function Gallery() {
  const [phase, setPhase] = useState<QueryPhase>('ready');
  const [tab, setTab] = useState<'one' | 'two' | 'three'>('one');
  const [range, setRange] = useState<'1h' | '24h' | '7d'>('24h');
  const [sheet, setSheet] = useState(false);

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        title="Component kit"
        meta={<StateBadge state="running" />}
        actions={
          <>
            <SegmentedControl
              label="Read state"
              value={phase}
              options={PHASES.map((key) => ({ key, label: key }))}
              onChange={setPhase}
            />
            <Button size="sm" onClick={() => setSheet(true)}>
              <Plus /> Create
            </Button>
          </>
        }
      />

      <Section title="Stats">
        <Stats columns={4}>
          <StatTile
            label="Requests"
            value={1_000_000}
            format={(v) => `${(v / 1e6).toFixed(1)}M`}
            delta={12.4}
            series={HOURS.map((h) => h.requests)}
            state={phase === 'loading' ? 'loading' : phase === 'ready' ? 'ready' : 'unavailable'}
          />
          <StatTile label="Error rate" value="0.66" unit="%" delta={-3.1} deltaGood={false} />
          <StatTile label="Wake p95" value={244} unit="ms" note="Cold start, fleet-wide" />
          <StatTile label="GB-hours left" value="567.5" note="of 2,000 this period" />
        </Stats>
        <div className="max-w-xs">
          <StatTile label="Standalone tile" value={42} />
        </div>
      </Section>

      <Section title="Panel and read states">
        <Panel
          title="Deployments"
          help="The last 50 deployments across your apps. Older ones are in the audit log."
          actions={<RangeSelector value={range} options={rangeOptions} onChange={setRange} />}
          padded={phase !== 'ready'}
        >
          {phase === 'ready' ? (
            <ResourceTable rows={ROWS} columns={COLUMNS} searchKeys={['name']} />
          ) : (
            <InlinePhase
              phase={phase}
              error={ERROR}
              emptyMessage="No deployments yet."
              onRetry={() => setPhase('ready')}
            />
          )}
        </Panel>
        <div className="grid gap-3 md:grid-cols-2">
          <LoadingState />
          <EmptyState message="No databases yet." action={<Button size="sm">Create</Button>} />
          <ErrorState error={ERROR} onRetry={() => {}} />
          <UnreachableState onRetry={() => {}} />
        </div>
      </Section>

      <Section title="Table">
        <ResourceTable
          rows={phase === 'empty' ? [] : ROWS}
          columns={COLUMNS}
          searchKeys={['name']}
          loading={phase === 'loading'}
          error={phase === 'error' ? ERROR : undefined}
          onRowClick={() => {}}
        />
      </Section>

      <Section title="Charts">
        <Panel title="Traffic">
          <TimeChart
            data={HOURS}
            x="at"
            series={{
              requests: { label: 'Requests', color: 'green' },
              errors: { label: 'Errors', color: 'red' },
            }}
            className="h-48"
          />
        </Panel>
        <div className="flex items-center gap-6">
          <Sparkline data={HOURS.map((h) => h.requests)} className="h-6 w-24" />
          <Sparkline data={HOURS.map((h) => h.errors)} color="red" className="h-6 w-24" />
        </div>
      </Section>

      <Section title="Navigation">
        <Tabs
          label="Example tabs"
          panelId="kit-tabs"
          value={tab}
          options={[
            { key: 'one', label: 'Overview' },
            { key: 'two', label: 'Settings' },
            { key: 'three', label: 'Activity' },
          ]}
          onChange={setTab}
        />
        <RangeSelector value={range} options={rangeOptions} onChange={setRange} />
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm">Primary</Button>
          <Button size="sm" variant="outline">
            Secondary
          </Button>
          <Button size="sm" variant="ghost">
            Ghost
          </Button>
          <Button size="sm" variant="destructive">
            Delete
          </Button>
          <Button size="sm" busy>
            Saving
          </Button>
        </div>
        <div className="flex max-w-md flex-wrap items-center gap-2">
          <Input placeholder="orders" className="w-40" />
          <Select defaultValue="17" className="w-24">
            <option value="16">16</option>
            <option value="17">17</option>
          </Select>
          <HelpTip docs="/docs/getting-started">
            Lower-case letters, digits and dashes. The name is the hostname prefix.
          </HelpTip>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {(['running', 'idle', 'deploying', 'error', 'undeployed'] as const).map((s) => (
            <StateBadge key={s} state={s} />
          ))}
          <Pill label="waf" />
          <Pill label="beta" color="var(--status-warning)" />
        </div>
      </Section>

      <Sheet
        open={sheet}
        onClose={() => setSheet(false)}
        title="Create database"
        footer={
          <>
            <Button size="sm" variant="ghost" onClick={() => setSheet(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setSheet(false)}>
              Create database
            </Button>
          </>
        }
      >
        <form className="flex flex-col gap-4" onSubmit={(e) => e.preventDefault()}>
          <label className="flex flex-col gap-1.5 text-sm">
            Name
            <Input placeholder="orders" />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            Version
            <Select defaultValue="17">
              <option value="16">16</option>
              <option value="17">17</option>
            </Select>
          </label>
        </form>
      </Sheet>
    </div>
  );
}

const rangeOptions = [
  { key: '1h' as const, label: '1h' },
  { key: '24h' as const, label: '24h' },
  { key: '7d' as const, label: '7d' },
];
