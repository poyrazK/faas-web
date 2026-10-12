import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useCreateAndDeploy } from '@/lib/api/create-and-deploy';
import { errorMessage } from '@/lib/api/errors';
import { appQuotaExceeded, memoryAllowed } from '@/lib/plan';
import { RepoPicker } from '@/components/dashboard/repo-picker';
import { appNameError } from '@/components/dashboard/new-app-validation';
import { isValidGitRef } from '@/components/dashboard/new-app-source';
import type { LaunchSeed } from './wizard';

const MEMORY = 128;
const label = 'text-[12px] text-muted-foreground';
const field =
  'h-9 w-full rounded-lg border border-input bg-background/40 px-3 text-[13px] outline-none focus:border-brand focus:ring-[3px] focus:ring-brand-muted';
const PLAN: Record<string, string> = { free: 'Free', hobby: 'Hobby', pro: 'Pro', scale: 'Scale' };

export function StepGit({ onLaunched }: { onLaunched: (l: LaunchSeed) => void }) {
  const { account } = useAuth();
  const { createApp, deployGit } = useCreateAndDeploy();
  const [repo, setRepo] = useState('');
  const [ref, setRef] = useState('main');
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  const derived =
    repo
      .split('/')
      .pop()
      ?.toLowerCase()
      .replace(/[^a-z0-9-]/g, '-') ?? '';
  const slug = touched ? name : derived;
  const nameError = slug ? appNameError(slug) : undefined;
  const quotaFull = appQuotaExceeded(account ?? null);
  const memoryOver = !memoryAllowed(account ?? null, MEMORY);
  const over = quotaFull || memoryOver;
  const plan = account ? (PLAN[account.plan] ?? account.plan) : '';
  const ready =
    Boolean(repo) && Boolean(slug) && !nameError && isValidGitRef(ref) && !over && !busy;

  async function deploy() {
    if (!ready) return;
    setBusy(true);
    setError(undefined);
    try {
      await createApp({ name: slug });
    } catch (err) {
      setBusy(false);
      setError(errorMessage(err));
      return;
    }
    try {
      const dep = await deployGit({ slug, repo, ref });
      onLaunched({ slug, source: 'git', repo, ref, deploymentId: dep.id });
    } catch (err) {
      onLaunched({ slug, source: 'git', repo, ref, submitError: errorMessage(err) });
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void deploy();
      }}
    >
      <h2 className="text-[18px] font-semibold tracking-[-0.015em]">Pick a repository</h2>
      <label className="mt-4 flex flex-col gap-1.5">
        <span className={label}>Repository</span>
        <RepoPicker
          value={repo}
          onChange={(r, branch) => {
            setRepo(r);
            if (branch) setRef(branch);
          }}
        />
      </label>
      <div className="mt-4 grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1.5">
          <span className={label}>Branch</span>
          <input
            aria-label="Branch"
            className={field}
            value={ref}
            onChange={(e) => setRef(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={label}>App name</span>
          <input
            aria-label="App name"
            className={field}
            value={slug}
            onChange={(e) => {
              setTouched(true);
              setName(e.target.value);
            }}
          />
          <span className="text-[11.5px] text-muted-foreground">
            {nameError ?? (slug ? `${slug}.gregale.app` : ' ')}
          </span>
        </label>
      </div>
      {repo && over && account && (
        <div className="mt-4 flex gap-3 rounded-[10px] border border-status-warning/25 bg-status-warning/[0.07] p-3 text-[12.5px]">
          <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-status-warning" />
          <div>
            <p className="font-semibold">
              {quotaFull
                ? `You're using ${account.app_count} of ${account.limits.deployed_apps} apps on ${plan}`
                : `${plan} allows up to ${account.limits.ram_mb} MB per app; this needs ${MEMORY} MB`}
            </p>
            <p className="mt-0.5 text-muted-foreground">
              {quotaFull
                ? 'Upgrade for more apps, or remove one you no longer need.'
                : 'Upgrade for more memory per app.'}
            </p>
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="mt-3 text-[12px] text-status-critical">
          {error}
        </p>
      )}
      <div className="mt-6 flex items-center justify-between">
        <span className="text-[12px] text-muted-foreground">{`Scale to zero · ${MEMORY} MB`}</span>
        <button
          type="submit"
          disabled={!ready}
          className="pressable flex h-9 items-center gap-2 rounded-lg bg-brand px-4 text-[13px] font-semibold text-primary-foreground hover:bg-brand-hover disabled:opacity-40"
        >
          {busy ? 'Deploying…' : `Deploy ${slug || 'app'}`}
        </button>
      </div>
    </form>
  );
}
