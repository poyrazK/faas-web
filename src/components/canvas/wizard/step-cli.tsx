import { useEffect, useState } from 'react';
import { useCreateAndDeploy } from '@/lib/api/create-and-deploy';
import { useAppDeployments } from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';
import { appNameError } from '@/components/dashboard/new-app-validation';
import { useCopy } from '@/components/ui/copy-button';
import type { LaunchSeed } from './wizard';

const field =
  'h-9 w-full rounded-lg border border-input bg-background/40 px-3 text-[13px] outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-muted';

export function commandsFor(slug: string) {
  return [
    'curl -fsSL https://get.gregale.dev | sh',
    'gregale login',
    `gregale deploy --name ${slug}`,
  ];
}

function Waiting({ slug, onLaunched }: { slug: string; onLaunched: (l: LaunchSeed) => void }) {
  const deployments = useAppDeployments(slug, 1, { pollWhileEmpty: true });
  const first = deployments.data?.pages[0]?.items[0];
  const { copied, copy } = useCopy();
  useEffect(() => {
    if (first) onLaunched({ slug, source: 'cli', deploymentId: first.id });
  }, [first, slug, onLaunched]);
  const lines = commandsFor(slug);
  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.015em]">{`Deploy ${slug} from your terminal`}</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        Run these in your project folder. This card follows along.
      </p>
      <div className="relative mt-4 rounded-[10px] border border-border bg-background/60 px-3.5 py-3 font-mono text-[12px] leading-[1.9]">
        {lines.map((l) => (
          <div key={l}>
            <span className="text-muted-foreground">$ </span>
            {l}
          </div>
        ))}
        <button
          type="button"
          onClick={() => void copy(lines.join('\n'))}
          className="absolute top-2.5 right-2.5 rounded-md border border-border-secondary px-1.5 py-0.5 font-sans text-[10.5px] text-muted-foreground hover:text-foreground"
        >
          {copied ? 'Copied' : 'Copy all'}
        </button>
      </div>
      <div
        className="mt-4 flex items-center gap-2.5 text-[12.5px] text-muted-foreground"
        role="status"
      >
        <span aria-hidden className="size-2 animate-pulse rounded-full bg-brand" />
        Waiting for your first deploy…
        <button
          type="button"
          onClick={() => onLaunched({ slug, source: 'cli' })}
          className="ml-auto h-8 rounded-lg px-3 font-semibold hover:bg-accent hover:text-foreground"
        >
          Do it later
        </button>
      </div>
    </div>
  );
}

export function StepCli({ onLaunched }: { onLaunched: (l: LaunchSeed) => void }) {
  const { createApp } = useCreateAndDeploy();
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const nameError = name ? appNameError(name) : undefined;

  if (created) return <Waiting slug={created} onLaunched={onLaunched} />;

  return (
    <form
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name || nameError || busy) return;
        setBusy(true);
        setError(undefined);
        try {
          await createApp({ name });
          setCreated(name);
        } catch (err) {
          setError(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <h2 className="text-[18px] font-semibold tracking-[-0.015em]">Name your app</h2>
      <p className="mt-1 text-[13px] text-muted-foreground">
        We create it now; your first <span className="font-mono text-[11.5px]">gregale deploy</span>{' '}
        fills it.
      </p>
      <label className="mt-4 flex flex-col gap-1.5">
        <span className="text-[12px] text-muted-foreground">App name</span>
        <input
          aria-label="App name"
          autoFocus
          className={field}
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
        />
        <span className="text-[11.5px] text-muted-foreground">
          {nameError ?? (name ? `${name}.gregale.app` : ' ')}
        </span>
      </label>
      {error && (
        <p role="alert" className="mt-2 text-[12px] text-status-critical">
          {error}
        </p>
      )}
      <div className="mt-6 flex justify-end">
        <button
          type="submit"
          disabled={!name || Boolean(nameError) || busy}
          className="pressable h-9 rounded-lg bg-brand px-4 text-[13px] font-semibold text-primary-foreground hover:bg-brand-hover disabled:opacity-40"
        >{`Create ${name || 'app'}`}</button>
      </div>
    </form>
  );
}
