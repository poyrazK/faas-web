import { useNavigate } from '@tanstack/react-router';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useDestroyPreview } from '@/lib/api/queries';

/**
 * Preview apps are the rows githubd provisions per pull request. The API
 * does not flag them on `AppResponse`; the one convention it does expose is
 * the slug githubd derives — `pr-{number}-{parent-slug}` (pkg/githubd
 * previewSlug) — so that is what identifies a preview here. The teardown
 * endpoint refuses anything else with `404 preview_not_found`, so a wrong
 * guess costs a sentence, never a production app.
 */
export const PREVIEW_SLUG = /^pr-\d+-/;

export function isPreviewSlug(slug: string): boolean {
  return PREVIEW_SLUG.test(slug);
}

export function TearDownPreviewButton({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const destroy = useDestroyPreview();
  if (!isPreviewSlug(slug)) return null;

  const onDestroy = async () => {
    if (
      !(await confirm({
        title: `Tear down preview ${slug}?`,
        description:
          'The preview app and its URL are removed. The pull request and the production app are untouched.',
        confirmLabel: 'Tear down',
        destructive: true,
        typeToConfirm: slug,
      }))
    )
      return;
    try {
      await destroy.mutateAsync(slug);
      toast({ kind: 'success', title: `Preview ${slug} torn down` });
      void navigate({ to: '/dashboard/workflows' });
    } catch (err) {
      if (err instanceof ApiError && err.code === 'preview_not_found') {
        toast({
          kind: 'info',
          title: 'Not a preview app',
          description:
            'Only pull-request previews can be torn down here; delete the app from Settings instead.',
        });
        return;
      }
      toast({ kind: 'error', title: 'Could not tear down', description: errorMessage(err) });
    }
  };

  return (
    <Button
      variant="outline"
      size="sm"
      className="gap-1.5"
      onClick={() => void onDestroy()}
      disabled={destroy.isPending}
    >
      <Trash className="h-3.5 w-3.5" />
      Tear down preview
    </Button>
  );
}
