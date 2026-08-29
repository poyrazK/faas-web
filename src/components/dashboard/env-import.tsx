import { useMemo, useRef, useState } from 'react';
import { Upload } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { useSetSecret } from '@/lib/api/queries';
import { parseDotEnv } from '@/lib/env-parse';
import { cn } from '@/lib/utils';

/**
 * Import a `.env` file as sealed secrets — the most tedious migration step
 * collapsed to paste → preview → confirm.
 *
 * The preview is the contract: every key shows whether it is new,
 * overwrites an existing secret, or has a name the API would refuse
 * (stated up front, not as a 422 after the round-trip). Import writes
 * sequentially through the same set-secret endpoint the form uses and
 * reports exactly what landed.
 */

/** The server's own SQL CHECK for names — mirrors the single-secret form. */
const KEY_RULE = /^[A-Z][A-Z0-9_]*$/;

type RowState = 'new' | 'overwrites' | 'invalid';

export function EnvImportButton({ slug, existingKeys }: { slug: string; existingKeys: string[] }) {
  const { toast } = useToast();
  const setSecret = useSetSecret(slug);
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [importing, setImporting] = useState(false);

  const parsed = useMemo(() => parseDotEnv(text), [text]);
  const existing = useMemo(() => new Set(existingKeys), [existingKeys]);
  const rows = useMemo(
    () =>
      parsed.entries.map((e) => ({
        ...e,
        state: (!KEY_RULE.test(e.key)
          ? 'invalid'
          : existing.has(e.key)
            ? 'overwrites'
            : 'new') as RowState,
      })),
    [parsed, existing]
  );
  const importable = rows.filter((r) => r.state !== 'invalid');

  const close = () => {
    if (importing) return;
    setOpen(false);
    setText('');
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    void file.text().then(setText);
  };

  const runImport = async () => {
    if (importable.length === 0 || importing) return;
    setImporting(true);
    let done = 0;
    const failed: string[] = [];
    // Sequential on purpose: one clear failure beats a burst of racing
    // writes, and secret sets are cheap.
    for (const row of importable) {
      try {
        await setSecret.mutateAsync({ key: row.key, value: row.value });
        done++;
      } catch {
        failed.push(row.key);
      }
    }
    setImporting(false);
    if (failed.length === 0) {
      toast({
        kind: 'success',
        title: `Imported ${done} ${done === 1 ? 'secret' : 'secrets'}`,
      });
      setOpen(false);
      setText('');
    } else {
      toast({
        kind: 'error',
        title: `Imported ${done}, ${failed.length} failed`,
        description: failed.slice(0, 4).join(', ') + (failed.length > 4 ? '…' : ''),
      });
    }
  };

  const STATE_LABEL: Record<RowState, { text: string; color?: string }> = {
    new: { text: 'new' },
    overwrites: { text: 'overwrites', color: 'var(--status-warning)' },
    invalid: { text: 'invalid name', color: 'var(--status-critical)' },
  };

  return (
    <>
      <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setOpen(true)}>
        <Upload className="h-3.5 w-3.5" />
        Import .env
      </Button>

      <Modal
        open={open}
        onClose={close}
        title="Import a .env file"
        description="Paste the file or choose it; nothing is written until you confirm."
        width="max-w-2xl"
        footer={
          <div className="flex items-center gap-3">
            {parsed.invalid.length > 0 && (
              <span className="text-xs" style={{ color: 'var(--status-warning)' }}>
                {parsed.invalid.length} unparseable {parsed.invalid.length === 1 ? 'line' : 'lines'}{' '}
                skipped
              </span>
            )}
            <Button
              size="sm"
              disabled={importable.length === 0}
              busy={importing}
              onClick={() => void runImport()}
            >
              Import {importable.length > 0 ? importable.length : ''}{' '}
              {importable.length === 1 ? 'secret' : 'secrets'}
            </Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="flex items-center justify-between gap-3">
            <input
              ref={fileRef}
              type="file"
              accept=".env,text/plain"
              className="hidden"
              onChange={(e) => readFile(e.target.files?.[0])}
            />
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()}>
              Choose file…
            </Button>
            <p className="text-xs text-muted-foreground">
              Values are sealed on write and never shown again.
            </p>
          </div>

          <Textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder={'DATABASE_URL=postgres://…\nAPI_TOKEN=…'}
            className="font-mono text-xs"
            aria-label=".env contents"
          />

          {rows.length > 0 && (
            <ul className="flex max-h-48 list-none flex-col divide-y divide-border overflow-y-auto rounded-lg border border-border">
              {rows.map((r) => (
                <li key={r.key} className="flex items-center gap-3 px-3 py-2">
                  <span
                    className={cn('font-mono text-xs', r.state === 'invalid' && 'line-through')}
                  >
                    {r.key}
                  </span>
                  <span className="truncate font-mono text-xs text-muted-foreground">
                    {r.value.length > 24 ? `${r.value.slice(0, 24)}…` : r.value}
                  </span>
                  <span
                    className="ml-auto shrink-0 text-xs"
                    style={{ color: STATE_LABEL[r.state].color }}
                  >
                    {STATE_LABEL[r.state].text}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal>
    </>
  );
}
