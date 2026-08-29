import { useState } from 'react';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { FIELD, Textarea } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from './primitives';
import {
  useApp,
  useDeleteTrustedSigner,
  usePutTrustedSigner,
  useSetAppSecurity,
  useTrustedSigners,
} from '@/lib/api/queries';
import { errorMessage } from '@/lib/api/errors';

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
  const app = useApp(slug);
  const setSecurity = useSetAppSecurity(slug);
  const signers = useTrustedSigners(slug);
  const putSigner = usePutTrustedSigner(slug);
  const deleteSigner = useDeleteTrustedSigner(slug);

  const [name, setName] = useState('');
  const [pem, setPem] = useState('');

  const signerRows = signers.data?.signers ?? [];
  const signersPhase = queryPhase({
    error: signers.error,
    loading: signers.isPending,
    isEmpty: signerRows.length === 0,
  });
  const requireSigned = app.data?.require_signed ?? false;

  return (
    <Panel
      title="Supply chain"
      description="Require every deploy to carry a signature from a trusted publisher. Admin only; changes demand MFA."
    >
      <div className="flex items-start justify-between gap-6 border-b border-border pb-4">
        <div>
          <p className="text-sm font-medium">Require signed deploys</p>
          <p className="mt-1 max-w-lg text-xs leading-relaxed text-muted-foreground">
            Unsigned images are refused at deploy time once this is on. Turn it on only after at
            least one publisher below can sign.
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
                toast({ kind: 'error', title: 'Could not change', description: errorMessage(err) })
              )
          }
          aria-label="Require signed deploys"
          className="mt-1 data-[state=checked]:bg-brand"
        />
      </div>

      <div className="pt-4">
        <p className="label-mono mb-3 text-muted-foreground">Trusted publishers</p>

        {signersPhase !== 'ready' ? (
          <InlinePhase
            phase={signersPhase}
            error={signers.error}
            loadingMessage="Reading publishers…"
            emptyMessage="No publishers yet — add the public key that signs your images."
          />
        ) : (
          <ul className="flex flex-col divide-y divide-border">
            {signerRows.map((s) => (
              <li key={s.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
                <span className="font-mono text-xs">{s.name}</span>
                <span className="text-xs text-muted-foreground">
                  added {new Date(s.added_at).toLocaleDateString()} by {s.added_by}
                </span>
                <button
                  type="button"
                  aria-label={`Remove publisher ${s.name}`}
                  onClick={async () => {
                    if (
                      !(await confirm({
                        title: `Remove publisher ${s.name}?`,
                        description:
                          'Deploys signed only by this key start failing immediately while signatures are required.',
                        confirmLabel: 'Remove publisher',
                        destructive: true,
                      }))
                    )
                      return;
                    void deleteSigner
                      .mutateAsync(s.name)
                      .then(() => toast({ kind: 'success', title: `Removed ${s.name}` }))
                      .catch((err: unknown) =>
                        toast({
                          kind: 'error',
                          title: 'Could not remove',
                          description: errorMessage(err),
                        })
                      );
                  }}
                  className="pressable ml-auto rounded p-1 text-muted-foreground hover:text-foreground"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}

        <form
          className="mt-4 flex flex-wrap items-end gap-3 border-t border-border pt-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (!name.trim() || !pem.trim() || putSigner.isPending) return;
            void putSigner
              .mutateAsync({ name: name.trim(), publicKeyPem: pem })
              .then(() => {
                setName('');
                setPem('');
                toast({ kind: 'success', title: 'Publisher added' });
              })
              .catch((err: unknown) =>
                toast({ kind: 'error', title: 'Could not add', description: errorMessage(err) })
              );
          }}
        >
          <label className="flex min-w-36 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="release-ci"
              className={`${FIELD} font-mono`}
            />
          </label>
          <label className="flex min-w-64 flex-[2] flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Public key (PEM)</span>
            <Textarea
              value={pem}
              onChange={(e) => setPem(e.target.value)}
              rows={2}
              spellCheck={false}
              placeholder="-----BEGIN PUBLIC KEY-----"
              className="min-h-9 font-mono text-xs"
            />
          </label>
          <Button
            type="submit"
            size="sm"
            disabled={!name.trim() || !pem.trim()}
            busy={putSigner.isPending}
          >
            Add publisher
          </Button>
        </form>
      </div>
    </Panel>
  );
}
