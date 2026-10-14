import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useConfirm } from '@/components/ui/confirm';
import { useAuth } from '@/lib/auth';
import { useDeployFromRefFor } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { resourceId } from '@/lib/resource-id';
import { isValidGitRef, isValidGitHubRepo, type DeploymentRecoveryContext } from './new-app-source';

/** This is a new source build in an existing app, never an immutable retry. */
export function RecoverySourceForm({
  recovery,
  appId,
  allowed,
  onChange,
  onBusyChange,
}: {
  recovery: DeploymentRecoveryContext;
  appId: string;
  allowed: boolean;
  onChange: (next: DeploymentRecoveryContext) => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [repo, setRepo] = useState(recovery.repo);
  const [ref, setRef] = useState(/^[a-f0-9]{40}$/i.test(recovery.ref) ? '' : recovery.ref);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  const mounted = useRef(false);
  const latestAllowed = useRef(allowed);
  const { account } = useAuth();
  const confirm = useConfirm();
  const deploy = useDeployFromRefFor();
  useEffect(() => {
    latestAllowed.current = allowed;
  }, [allowed]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const installationId = Number(account?.github_install_id);
  const connected = Number.isSafeInteger(installationId) && installationId > 0;
  const valid = connected && isValidGitHubRepo(repo) && isValidGitRef(ref);

  async function submit() {
    if (lock.current || !allowed || !valid) return;
    lock.current = true;
    setBusy(true);
    onBusyChange(true);
    setError(null);
    let requested = false;
    const selected = { ...recovery, repo: repo.trim(), ref: ref.trim() };
    try {
      const approved = await confirm({
        title: 'Deploy this fixed ref?',
        description: `Build ${selected.repo}@${selected.ref} in ${recovery.app} using the app’s current configuration. No new app is created. The original failed attempt stays in history.`,
        confirmLabel: 'Deploy fixed ref',
      });
      if (!mounted.current || !approved) return;
      if (!latestAllowed.current) {
        setError(
          'The deployment state changed. Review its status before starting another attempt.'
        );
        return;
      }
      // Keep the selected record's provenance until a new attempt is confirmed.
      // Source-ref uses the account installation; do not change auto-deploy binding.
      onChange({ ...recovery, phase: 'submitting' });
      requested = true;
      const next = await deploy.mutateAsync({
        slug: recovery.app,
        repo: selected.repo,
        ref: selected.ref,
        format: 'tarball',
      });
      if (!mounted.current) return;
      if (!resourceId(next.id) || next.id === recovery.deployment || next.app_id !== appId) {
        onChange({ ...recovery, phase: 'unknown' });
        return;
      }
      onChange({ ...selected, deployment: next.id, phase: undefined });
    } catch (err) {
      if (!mounted.current) return;
      const unknown = requested && (!(err instanceof ApiError) || err.status >= 500);
      setError(errorMessage(err));
      onChange({ ...recovery, phase: unknown ? 'unknown' : 'rejected' });
    } finally {
      lock.current = false;
      if (mounted.current) {
        setBusy(false);
        onBusyChange(false);
      }
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-4 rounded-lg border border-border bg-card p-5"
      aria-label="Deploy a fix"
    >
      <h3 className="font-medium">Deploy a fix to {recovery.app}</h3>
      <p className="text-sm leading-relaxed text-muted-foreground">
        Push your fix, then choose its branch, tag, or commit. This builds fresh source with the
        app’s current configuration; it does not replay the original release’s overrides.
      </p>
      <label className="block text-sm">
        Repository
        <Input
          className="mt-1.5 font-mono"
          value={repo}
          disabled={busy}
          maxLength={512}
          onChange={(e) => setRepo(e.target.value)}
        />
      </label>
      <label className="block text-sm">
        Branch, tag, or commit
        <Input
          className="mt-1.5 font-mono"
          value={ref}
          disabled={busy}
          maxLength={200}
          placeholder="Choose the ref containing your fix"
          onChange={(e) => setRef(e.target.value)}
        />
      </label>
      {!connected && (
        <p role="alert" className="text-sm text-muted-foreground">
          Connect GitHub in Settings → Integrations before deploying.
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" variant="cta" busy={busy} disabled={!valid || !allowed}>
        Deploy fixed ref
      </Button>
    </form>
  );
}
