import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { Panel } from './primitives';
import { api, unwrap } from '@/lib/api/client';
import { errorMessage } from '@/lib/api/errors';
import { applyEnvImport, fetchEnvExport, type EnvBatchResult } from '@/lib/api/env-transfer';
import {
  ENV_IMPORT_MAX_BYTES,
  ENV_SCOPE,
  envImportDiff,
  parseEnvImport,
  serializeEnvExport,
} from '@/lib/env-transfer';
import { useAuth } from '@/lib/auth';

export function EnvTransferPanel({ slug }: { slug: string }) {
  const { account } = useAuth();
  if (!account?.id)
    return (
      <Panel title="Import and export environment variables">
        <p className="text-sm text-muted-foreground">Loading account…</p>
      </Panel>
    );
  return <EnvTransferBody key={`${account.id}:${slug}`} slug={slug} accountId={account.id} />;
}

function EnvTransferBody({ slug, accountId }: { slug: string; accountId: string }) {
  const confirm = useConfirm();
  const client = useQueryClient();
  const [scope, setScope] = useState('default');
  const [text, setText] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<EnvBatchResult>();
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  const readVersion = useRef(0);
  const controller = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      controller.current?.abort();
      readVersion.current++;
    },
    []
  );
  const scopeValid = ENV_SCOPE.test(scope);
  const metadata = useQuery({
    queryKey: ['env-transfer', accountId, slug, scope],
    enabled: Boolean(accountId && slug && scopeValid),
    queryFn: ({ signal }) =>
      unwrap(
        api.GET('/v1/apps/{slug}/env', { params: { path: { slug }, query: { scope } }, signal })
      ),
  });
  const parsed = parseEnvImport(text);
  const diff = envImportDiff(parsed.entries, new Set(metadata.data?.env.map((entry) => entry.key)));
  const additions = diff.filter((entry) => entry.action === 'add').length;
  const overwrites = diff.length - additions;
  const ready = Boolean(
    accountId && metadata.data && !metadata.error && !metadata.isPending && scopeValid && slug
  );
  const quotaExceeded = Boolean(
    metadata.data && metadata.data.count + additions > metadata.data.quota_max
  );
  const changeText = (value: string) => {
    readVersion.current++;
    setText(value);
    setReviewed(false);
    setResult(undefined);
    setNotice('');
  };
  const apply = async () => {
    if (lock.current || !ready || !reviewed || !diff.length || quotaExceeded) return;
    lock.current = true;
    setPending(true);
    setNotice('');
    const snapshot = diff.map(({ key, value }) => ({ key, value }));
    const request = new AbortController();
    controller.current = request;
    try {
      if (
        !(await confirm({
          title: `Import ${snapshot.length} variables into ${slug} (${scope})?`,
          description: `${additions} additions and ${overwrites} overwrites. Existing stored values cannot be compared. Unmentioned variables stay unchanged. Each key is written separately; a failed request may leave partial changes. Updates take effect on the next cold wake.`,
          confirmLabel: 'Apply import',
          destructive: overwrites > 0,
        }))
      )
        return;
      if (request.signal.aborted) return;
      const outcome = await applyEnvImport(slug, scope, snapshot, request.signal);
      if (request.signal.aborted) return;
      setResult(outcome);
      // Keep only failures in memory for another review/confirmation. Successful
      // values are discarded so retry cannot overwrite them a second time.
      const failed = new Set(outcome.failed.map((item) => item.key));
      setText(
        failed.size
          ? serializeEnvExport(
              Object.fromEntries(
                snapshot
                  .filter((item) => failed.has(item.key))
                  .map((item) => [item.key, item.value])
              )
            )
          : ''
      );
      setReviewed(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ['apps', slug, 'env'] }),
        client.invalidateQueries({ queryKey: ['env-transfer', accountId, slug] }),
      ]);
    } catch (error) {
      if (!request.signal.aborted) setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      if (!request.signal.aborted) setPending(false);
    }
  };
  const download = async () => {
    if (lock.current || !ready) return;
    lock.current = true;
    setPending(true);
    setNotice('');
    const request = new AbortController();
    controller.current = request;
    try {
      if (
        !(await confirm({
          title: `Download env values for ${slug} (${scope})?`,
          description:
            'This file contains plaintext values that may be sensitive. Keep it private and out of version control. Only mutable environment variables in this scope are included; sealed secrets, manifest defaults, and image defaults are excluded.',
          confirmLabel: 'Download .env',
        }))
      )
        return;
      if (request.signal.aborted) return;
      const content = await fetchEnvExport(slug, scope, request.signal);
      if (request.signal.aborted) return;
      const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = `${slug}-${scope}.env`;
        link.click();
        setNotice('Environment file downloaded. Keep it private.');
      } finally {
        URL.revokeObjectURL(url);
      }
    } catch (error) {
      if (!request.signal.aborted) setNotice(errorMessage(error));
    } finally {
      lock.current = false;
      if (!request.signal.aborted) setPending(false);
    }
  };
  return (
    <Panel title="Import and export environment variables">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-foreground">
          Review additions and overwrites before applying a file or pasted block. Values stay in
          memory until you leave this app. Credentials belong in sealed Secrets.
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            Transfer scope
            <input
              aria-label="Transfer scope"
              value={scope}
              maxLength={40}
              disabled={pending}
              onChange={(event) => {
                setScope(event.target.value);
                setReviewed(false);
                setResult(undefined);
                setNotice('');
              }}
              className="h-10 rounded-lg border border-border bg-background px-3 font-mono text-sm"
            />
          </label>
          <Button variant="outline" disabled={!ready || pending} onClick={() => void download()}>
            Export .env
          </Button>
        </div>
        {!scopeValid && (
          <p role="alert" className="text-sm">
            Use a scope of 3–40 lowercase letters, digits, or hyphens, with no leading or trailing
            hyphen.
          </p>
        )}
        {scopeValid && metadata.isPending && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading existing variable names…
          </p>
        )}
        {metadata.error && (
          <div role="alert" className="text-sm">
            Could not read the scope: {errorMessage(metadata.error)}{' '}
            <Button size="sm" variant="outline" onClick={() => void metadata.refetch()}>
              Retry names
            </Button>
          </div>
        )}
        <label className="flex flex-col gap-1.5 text-sm">
          Choose a .env file (up to 1 MiB)
          <input
            type="file"
            accept=".env,text/plain"
            disabled={pending}
            onChange={async (event) => {
              const file = event.target.files?.[0];
              event.target.value = '';
              if (!file) return;
              const version = ++readVersion.current;
              if (file.size > ENV_IMPORT_MAX_BYTES) {
                setNotice('File exceeds the 1 MiB import limit.');
                return;
              }
              try {
                const content = await file.text();
                if (version === readVersion.current) changeText(content);
              } catch {
                if (version === readVersion.current)
                  setNotice('Could not read this file. Paste its contents instead.');
              }
            }}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          Paste .env contents
          <textarea
            aria-label="Paste .env contents"
            value={text}
            disabled={pending}
            autoComplete="off"
            spellCheck={false}
            rows={6}
            onChange={(event) => changeText(event.target.value)}
            placeholder={'LOG_LEVEL=info\nFEATURE_X="enabled"'}
            className="rounded-lg border border-border bg-background p-3 font-mono text-sm"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          Use one assignment per line. Double quotes accept escaped quotes and \n for line breaks.
          Values are hidden in the review.
        </p>
        <Button
          variant="outline"
          disabled={!ready || pending || !text.trim()}
          onClick={() => setReviewed(true)}
        >
          Review import
        </Button>
        {reviewed && (
          <div
            role="region"
            aria-label="Import dry run"
            className="flex flex-col gap-2 rounded-lg border border-border p-4"
          >
            <p className="text-sm">
              {additions} additions · {overwrites} overwrites · {parsed.diagnostics.length} issues
            </p>
            <ul className="text-sm">
              {diff.map((entry) => (
                <li key={entry.key}>
                  <span className="font-mono">{entry.key}</span> —{' '}
                  {entry.action === 'add' ? 'Add' : 'Overwrite'} (value hidden)
                </li>
              ))}
            </ul>
            {parsed.diagnostics.map((item, index) => (
              <p key={index} className="text-sm text-muted-foreground">
                {item.line ? `Line ${item.line}` : 'Input'}
                {item.key ? ` · ${item.key}` : ''}: {item.reason}
              </p>
            ))}
            {quotaExceeded && (
              <p role="alert" className="text-sm">
                This import would exceed the app quota ({metadata.data?.count} existing across all
                scopes, {metadata.data?.quota_max} allowed). Reduce additions before applying.
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Invalid and duplicate entries are excluded. The server validates each value and
              enforces plan limits. Stored values are write-only, so overwrites cannot be classified
              as unchanged.
            </p>
            <Button
              disabled={!ready || pending || !diff.length || quotaExceeded}
              onClick={() => void apply()}
              busy={pending}
            >
              Apply valid updates
            </Button>
          </div>
        )}
        {result && (
          <div role="status" className="text-sm">
            <p>
              {result.saved.length} saved · {result.failed.length} failed.
            </p>
            {result.saved.length > 0 && <p>Saved: {result.saved.join(', ')}</p>}
            {result.failed.map((item) => (
              <p key={item.key}>
                {item.key}: {item.message}
              </p>
            ))}
            {result.failed.length > 0 && (
              <p>
                Only failed entries remain above. Review and confirm to retry them; successful
                writes are preserved.
              </p>
            )}
          </div>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {notice}
          </p>
        )}
      </div>
    </Panel>
  );
}
