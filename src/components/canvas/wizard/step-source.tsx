import { useEffect, useRef, useState } from 'react';
import { Github } from 'iconoir-react';
import { useAuth } from '@/lib/auth';
import { GitHubConnectForm } from '@/components/dashboard/github-connect-form';
import { cn } from '@/lib/utils';

export function StepSource({ onPick }: { onPick: (source: 'git' | 'cli') => void }) {
  const { account } = useAuth();
  const connected = Boolean(account?.github_install_id);
  const [active, setActive] = useState<'git' | 'cli'>('git');
  const latest = useRef({ active, connected, onPick });
  useEffect(() => {
    latest.current = { active, connected, onPick };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === 'ArrowRight') setActive('cli');
      if (e.key === 'ArrowLeft') setActive('git');
      if (e.key === 'Enter') {
        const { active, connected, onPick } = latest.current;
        if (active === 'cli' || connected) onPick(active);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const tile = (on: boolean) =>
    cn(
      'flex min-h-[156px] flex-col gap-3 rounded-xl border p-4 text-left transition-colors duration-[var(--motion-fast)]',
      on ? 'border-brand/45 bg-brand/[0.04]' : 'border-border hover:border-border-secondary'
    );

  return (
    <div>
      <h2 className="text-[18px] font-semibold tracking-[-0.015em]">Where does your code live?</h2>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className={tile(active === 'git')} onMouseEnter={() => setActive('git')}>
          <span className="grid size-8 place-items-center rounded-lg bg-foreground/[0.06]">
            <Github aria-hidden className="size-4" />
          </span>
          <div>
            <p className="text-[13px] font-semibold">GitHub repository</p>
            <p className="text-[12px] text-muted-foreground">
              {connected
                ? 'Builds on every push to your branch.'
                : 'Install the Gregale app on your account or org.'}
            </p>
          </div>
          {connected ? (
            <button
              type="button"
              onClick={() => onPick('git')}
              className="mt-auto flex items-center gap-1.5 text-left text-[11.5px] text-muted-foreground"
            >
              <span aria-hidden className="size-1.5 rounded-full bg-status-good" />
              Connected
            </button>
          ) : (
            <div className="mt-auto">
              <GitHubConnectForm returnTo="/dashboard/canvas?wizard=source" />
            </div>
          )}
        </div>
        <button
          type="button"
          className={tile(active === 'cli')}
          onMouseEnter={() => setActive('cli')}
          onClick={() => onPick('cli')}
        >
          <span className="grid size-8 place-items-center rounded-lg bg-foreground/[0.06] font-mono text-[13px]">
            &gt;_
          </span>
          <span>
            <span className="block text-[13px] font-semibold">Command line</span>
            <span className="block text-[12px] text-muted-foreground">
              Deploy from your machine with{' '}
              <span className="font-mono text-[11px]">gregale deploy</span>.
            </span>
          </span>
          <span className="mt-auto text-[11.5px] text-muted-foreground">
            Any language · Dockerfile
          </span>
        </button>
      </div>
      {!connected && (
        <p className="mt-4 text-[11.5px] text-muted-foreground">
          GitHub opens in this tab and sends you back here, at this step.
        </p>
      )}
      <div className="mt-5 flex justify-between text-[12px] text-muted-foreground">
        <span>
          <kbd className="rounded border border-border-secondary border-b-2 px-1 font-mono text-[10px]">
            esc
          </kbd>{' '}
          back
        </span>
        <span>← → choose · ↵ continue</span>
      </div>
    </div>
  );
}
