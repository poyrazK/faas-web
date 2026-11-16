import { useId, useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FIELD, Textarea } from '@/components/ui/field';
import { IconButton } from '@/components/ui/icon-button';
import { Timestamp } from '@/components/ui/timestamp';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { Sheet } from './kit/sheet';
import { InlinePhase, Panel, queryPhase } from './primitives';
import { requireSignedNote, supplyChainLine } from './source-access-words';
import {
  useApp,
  useDeleteTrustedSigner,
  usePutTrustedSigner,
  useSetAppSecurity,
  useTrustedSigners,
} from '@/lib/api/queries';

const TONE_TEXT = {
  good: 'text-foreground/90',
  neutral: 'text-foreground/90',
  warning: 'text-[color:var(--status-warning)]',
  critical: 'text-[color:var(--status-critical)]',
} as const;

/**
 * Signed-deploy enforcement and the trusted-publisher list —
 * `/v1/apps/{slug}/security` and `/v1/apps/{slug}/trusted_signers`.
 *
 * Both writes are admin + MFA server-side; the MFA provider handles the
 * step-up when it is demanded, so this panel only has to report refusals
 * honestly. The signer key is a PEM public key: the platform never holds
 * the private half.
 */
export function SupplyChainPanel({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const formId = useId();
  const app = useApp(slug);
  const setSecurity = useSetAppSecurity(slug);
  const signers = useTrustedSigners(slug);
  const putSigner = usePutTrustedSigner(slug);
  const deleteSigner = useDeleteTrustedSigner(slug);

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [pem, setPem] = useState('');

  const signerRows = signers.data?.signers ?? [];
  const signersPhase = queryPhase({
    error: signers.error,
    loading: signers.isPending,
    isEmpty: signerRows.length === 0,
  });
  const requireSigned = app.data?.require_signed ?? false;
  const publishers = signers.data ? signerRows.length : undefined;
  const line = supplyChainLine(app.data ? requireSigned : undefined, publishers);
  const note = requireSignedNote(publishers, requireSigned);
  const canAdd = Boolean(name.trim() && pem.trim());

  const add = () => {
    if (!canAdd || putSigner.isPending) return;
    void putSigner
      .mutateAsync({ name: name.trim(), publicKeyPem: pem })
      .then(() => {
        setName('');
        setPem('');
        setAdding(false);
        toast({ kind: 'success', title: 'Publisher added' });
      })
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not add', error: err }));
  };

  const removeSigner = async (signer: string) => {
    if (
      !(await confirm({
        title: `Remove publisher ${signer}?`,
        description:
          'Deploys signed only by this key start failing immediately while signatures are required.',
        confirmLabel: 'Remove publisher',
        destructive: true,
      }))
    )
      return;
    void deleteSigner
      .mutateAsync(signer)
      .then(() => toast({ kind: 'success', title: `Removed ${signer}` }))
      .catch((err: unknown) => toast({ kind: 'error', title: 'Could not remove', error: err }));
  };

  return (
    <Panel
      title="Supply chain"
      help="Admin only; changes demand MFA. A trusted publisher is a public key (PEM) whose signatures Gregale accepts; the private half never leaves your signer."
      actions={
        <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
          <Plus className="h-3.5 w-3.5" />
          Add publisher
        </Button>
      }
    >
      <div className="flex flex-col gap-4">
        {line && <p className={`text-base ${TONE_TEXT[line.tone]}`}>{line.sentence}</p>}

        <div className="flex items-start justify-between gap-6">
          <div>
            <p className="text-sm font-medium">Require signed deploys</p>
            <p
              className={`mt-1 max-w-lg text-xs leading-relaxed ${
                note.tone === 'warning'
                  ? 'text-[color:var(--status-warning)]'
                  : 'text-muted-foreground'
              }`}
            >
              {note.sentence}
            </p>
          </div>
          <Switch
            checked={requireSigned}
            disabled={app.isPending || setSecurity.isPending}
            onCheckedChange={(on) =>
              void setSecurity
                .mutateAsync(on)
                .then(() =>
                  toast({
                    kind: 'success',
                    title: on ? 'Signed deploys required' : 'Signature requirement lifted',
                  })
                )
                .catch((err: unknown) =>
                  toast({ kind: 'error', title: 'Could not change', error: err })
                )
            }
            aria-label="Require signed deploys"
            className="mt-1 data-[state=checked]:bg-brand"
          />
        </div>

        {signersPhase === 'ready' ? (
          <ul
            aria-label="Trusted publishers"
            className="well flex flex-col divide-y divide-border rounded-xl bg-muted/40"
          >
            {signerRows.map((s) => (
              <li key={s.name} className="flex items-center gap-3 px-3 py-2">
                <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate font-mono text-xs">{s.name}</span>
                  <span className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    Added <Timestamp value={s.added_at} /> by {s.added_by}
                  </span>
                </div>
                <IconButton
                  aria-label={`Remove publisher ${s.name}`}
                  disabled={deleteSigner.isPending}
                  onClick={() => void removeSigner(s.name)}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                >
                  <Trash className="h-3.5 w-3.5" />
                </IconButton>
              </li>
            ))}
          </ul>
        ) : signersPhase === 'empty' ? null : (
          <InlinePhase
            phase={signersPhase}
            error={signers.error}
            loadingMessage="Reading publishers…"
            onRetry={() => void signers.refetch()}
          />
        )}
      </div>

      <Sheet
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a trusted publisher"
        footer={
          <Button
            type="submit"
            form={formId}
            size="sm"
            disabled={!canAdd}
            busy={putSigner.isPending}
          >
            Add publisher
          </Button>
        }
      >
        <form
          id={formId}
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            add();
          }}
        >
          <p className="text-sm text-muted-foreground">
            Paste the public half of a signing key. Images signed with its private half can deploy
            while signatures are required.
          </p>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="release-ci"
              spellCheck={false}
              className={`${FIELD} w-full font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Public key (PEM)</span>
            <Textarea
              value={pem}
              onChange={(e) => setPem(e.target.value)}
              rows={8}
              spellCheck={false}
              placeholder="-----BEGIN PUBLIC KEY-----"
              className="font-mono text-xs"
            />
          </label>
        </form>
      </Sheet>
    </Panel>
  );
}
