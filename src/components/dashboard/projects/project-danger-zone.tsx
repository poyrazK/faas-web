import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useDeleteProject,
  useOwningCompany,
  useProjectDeletePreview,
  type ProjectDeletePreview,
} from '@/lib/api/project-settings';
import type { ProjectDetail } from '@/lib/api/projects';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { InlinePhase, Panel, queryPhase } from '../primitives';

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "a, b and c", or the first three and how many more. */
function names(slugs: string[]) {
  const shown = slugs.slice(0, 3);
  const rest = slugs.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} and ${rest} more`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}` : shown[0];
}

/**
 * What happens to the apps, in the preview's numbers. Deleting the project
 * row detaches its apps (apps.project_id is ON DELETE SET NULL, faas migration
 * 00074:74); their domains, env values and crons stay with them, which is
 * what the delete preview counts (handlers_projects.go:160).
 */
function appsSentence(slug: string, preview: ProjectDeletePreview) {
  const apps = preview.workloads.map((workload) => workload.slug);
  if (!apps.length) return `${slug} has no apps attached, so deleting it detaches none.`;
  const one = apps.length === 1;
  return `Deleting ${slug} detaches its ${one ? 'app' : `${apps.length} apps`}, ${names(apps)}. ${
    one
      ? 'It keeps running as a standalone app with its'
      : 'They keep running as standalone apps with their'
  } ${count(preview.domain_count, 'domain', 'domains')}, ${count(
    preview.env_count,
    'environment value',
    'environment values'
  )} and ${count(preview.cron_count, 'cron', 'crons')}.`;
}

/**
 * The environment tables (environments, config versions, secrets, release
 * sets, promotions, feature flags) reference projects ON DELETE CASCADE, and
 * the repository binding lives on the project row. There is no soft delete.
 */
const CASCADE =
  "The project's environments, with their config, secrets, releases and feature flags, are deleted with it, and so is its repository binding. There is no restore.";

/**
 * DELETE /v1/projects/{slug} (faas handlers_projects.go:180), or the
 * organization's route in a company workspace (org_project_routes.go:47).
 */
export function ProjectDangerZone({
  accountId,
  project,
  onDeleted,
}: {
  accountId: string;
  project: ProjectDetail;
  onDeleted: () => void;
}) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const { org, label } = useWorkspaceTarget();
  const company = useOwningCompany(project.org_id);
  const preview = useProjectDeletePreview(accountId, project.slug);
  const remove = useDeleteProject(accountId, project.slug);
  const [failure, setFailure] = useState<string | null>(null);
  const phase = queryPhase({ error: preview.error, loading: preview.isPending });
  const apps = preview.data?.workloads.map((workload) => workload.slug) ?? [];

  function explain(err: unknown) {
    if (err instanceof ApiError && err.code === 'org_role_forbidden')
      return `Only ${org ? label : (company?.name ?? 'the company')}'s owners and admins can delete this project.`;
    // The handler answers ErrCapacity for any store failure, including a row
    // something still references: a static site (ON DELETE RESTRICT,
    // pgstore_hosting.go:59) or an environment clone's database plans.
    if (err instanceof ApiError && err.code === 'capacity')
      return 'The project was not deleted. The API answers this way when it is busy, and also when something still refers to the project, such as a static site or an environment clone’s database. Try again; if it keeps failing, remove those first.';
    return errorMessage(err);
  }

  return (
    <Panel
      title="Danger zone"
      description="The console asks you to type the project's slug before it goes through."
      className="border-[color:color-mix(in_oklab,var(--status-critical)_35%,transparent)]"
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-sm font-medium">Delete {project.slug}</p>
          {preview.data ? (
            <p className="text-xs leading-relaxed">{appsSentence(project.slug, preview.data)}</p>
          ) : phase === 'loading' ? (
            <InlinePhase phase={phase} loadingMessage="Reading what deleting would touch…" />
          ) : (
            <>
              <InlinePhase
                phase={phase}
                error={preview.error}
                onRetry={() => void preview.refetch()}
              />
              <p className="text-xs leading-relaxed">
                Its apps are detached and keep running as standalone apps, with their domains,
                environment values and crons.
              </p>
            </>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">{CASCADE}</p>
          {failure && (
            <p role="alert" className="text-sm" style={{ color: 'var(--status-critical)' }}>
              {failure}
            </p>
          )}
        </div>
        <Button
          size="sm"
          variant="destructive"
          busy={remove.isPending}
          onClick={async () => {
            const kept = apps.length
              ? `${names(apps)} ${apps.length === 1 ? 'keeps' : 'keep'} running as standalone ${
                  apps.length === 1 ? 'app' : 'apps'
                }, with ${apps.length === 1 ? 'its' : 'their'} domains, environment values and crons.`
              : 'Its apps are detached and keep running as standalone apps.';
            if (
              !(await confirm({
                title: `Delete project ${project.slug}?`,
                description: `${kept} ${CASCADE}`,
                confirmLabel: 'Delete project',
                destructive: true,
                typeToConfirm: project.slug,
              }))
            )
              return;
            setFailure(null);
            remove.mutate(undefined, {
              onSuccess: () => {
                toast({
                  kind: 'success',
                  title: `Deleted ${project.slug}`,
                  description: apps.length
                    ? `${count(apps.length, 'app is', 'apps are')} now standalone.`
                    : undefined,
                });
                onDeleted();
              },
              onError: (err) => setFailure(explain(err)),
            });
          }}
        >
          Delete project
        </Button>
      </div>
    </Panel>
  );
}
