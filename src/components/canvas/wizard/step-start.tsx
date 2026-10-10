import { useState } from 'react';
import { Globe, HardDrive, Timer, Cube } from 'iconoir-react';
import { Select } from '@/components/ui/field';
import { FrostedMark } from './frosted-mark';
import type { CreateKind } from '../create';

const OTHERS: {
  kind: CreateKind;
  label: string;
  hint: string;
  Icon: typeof Globe;
  tint: string;
}[] = [
  {
    kind: 'domain',
    label: 'Add a domain',
    hint: 'Route a hostname to an app',
    Icon: Globe,
    tint: 'var(--cat-network)',
  },
  {
    kind: 'cron',
    label: 'Schedule a cron',
    hint: 'Call an app on a schedule',
    Icon: Timer,
    tint: 'var(--cat-compute)',
  },
  {
    kind: 'bucket',
    label: 'Create a bucket',
    hint: 'Store objects for an app',
    Icon: HardDrive,
    tint: 'var(--cat-storage)',
  },
];

const row =
  'flex h-[52px] w-full items-center gap-3 rounded-[10px] border border-transparent px-3 text-left hover:bg-foreground/[0.04] focus-visible:border-brand/40 focus-visible:outline-none';

export function StepStart({
  mode,
  apps,
  onDeploy,
  onPickExisting,
}: {
  mode: 'empty' | 'new';
  apps: string[];
  onDeploy: () => void;
  onPickExisting: (slug: string, kind: CreateKind) => void;
}) {
  const [app, setApp] = useState(apps[0] ?? '');
  if (mode === 'empty') {
    return (
      <div className="px-1 pt-2 text-center">
        <FrostedMark />
        <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.015em]">Build your backend</h2>
        <p className="mt-1.5 text-[13px] text-muted-foreground">
          Deploy an app. Domains, storage and schedules attach to it, right here on the canvas.
        </p>
        <button
          type="button"
          autoFocus
          onClick={onDeploy}
          className="pressable mt-6 flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-brand text-[13px] font-semibold text-primary-foreground hover:bg-brand-hover"
        >
          Deploy an app{' '}
          <kbd className="rounded border border-primary-foreground/35 px-1 font-mono text-[10px]">
            ↵
          </kbd>
        </button>
        <a href="/docs/quickstart" className="mt-4 inline-block text-[12px] text-muted-foreground">
          New here? <span className="text-brand">Read the quickstart ↗</span>
        </a>
      </div>
    );
  }
  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.015em]">What do you want to add?</h2>
      <div className="mt-4 flex flex-col gap-1">
        <button type="button" autoFocus onClick={onDeploy} className={row}>
          <span
            aria-hidden
            className="grid size-8 place-items-center rounded-lg [&>svg]:size-4"
            style={{
              color: 'var(--cat-compute)',
              background: 'color-mix(in srgb, var(--cat-compute) 16%, transparent)',
            }}
          >
            <Cube />
          </span>
          <span>
            <span className="block text-[13px] font-semibold">Deploy an app</span>
            <span className="block text-[12px] text-muted-foreground">
              From a GitHub repo or your terminal
            </span>
          </span>
        </button>
        <div className="my-3 h-px bg-border" />
        <label className="mb-1 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
          App
          <Select
            aria-label="App"
            value={app}
            onChange={(e) => setApp(e.target.value)}
            className="h-8 w-48"
          >
            {apps.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </Select>
        </label>
        {OTHERS.map(({ kind, label, hint, Icon, tint }) => (
          <button
            key={kind}
            type="button"
            disabled={!app}
            onClick={() => onPickExisting(app, kind)}
            className={row}
          >
            <span
              aria-hidden
              className="grid size-8 place-items-center rounded-lg [&>svg]:size-4"
              style={{ color: tint, background: `color-mix(in srgb, ${tint} 16%, transparent)` }}
            >
              <Icon />
            </span>
            <span>
              <span className="block text-[13px] font-semibold">{label}</span>
              <span className="block text-[12px] text-muted-foreground">{hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
