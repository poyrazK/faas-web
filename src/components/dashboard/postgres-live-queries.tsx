import { CliCommand } from '@/components/dashboard/cli-command';
import { MaturityLabel } from '@/components/dashboard/maturity-label';
import { useCapability, useCapabilityAccess } from '@/lib/api/capabilities';
import {
  useApps,
  usePostgresBindings,
  type PostgresBinding,
  type PostgresDatabase,
} from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { cliDataApiLiveCommand, cliPostgresLiveCommand } from '@/lib/cli-commands';

/**
 * Live queries on one managed database (faas ADR-20261016151947).
 *
 * The console can explain them but not operate them: apid serves
 * `/v1/postgres/databases/{id}/live` only to accounts in the rollout and
 * keeps it out of the public OpenAPI spec until launch (faas
 * cmd/sdk-coverage/main.go:284-291), and the console never calls a path the
 * spec does not have. So the section says what live queries do, from
 * docs/data-api.md § Live reads, and hands over the CLI commands — the Data
 * API's when an app reaches this database through it, which also sets up
 * usage reporting and the realtime endpoint live reads need.
 *
 * In a company workspace it says the routes have no organization variant.
 *
 * Gated on `live-queries`: an account the preview is off for sees nothing
 * here (joining is on the Previews panel), and a plan without it says so.
 */
export function LiveQueries({ database }: { database: PostgresDatabase }) {
  const { access } = useCapabilityAccess('live-queries');
  const { capability } = useCapability('live-queries');
  if (access === 'plan-not-entitled')
    return (
      <p className="text-xs text-muted-foreground">
        Live queries are not included in your plan.{' '}
        <a className="text-brand underline" href="/dashboard/plans">
          View plans
        </a>
      </p>
    );
  if (access !== 'on') return null;
  return (
    <section aria-label="Live queries" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="label-mono text-muted-foreground">Live queries</p>
        <MaturityLabel capability={capability} />
      </div>
      <p className="text-xs text-muted-foreground">
        A live read keeps a Data API query current over WebSocket: the client gets the rows, then
        each change as writes commit. Row-level security decides every row with the same claims a
        REST read gets, and open reads check their credential again every hour. Each live connection
        counts against your account&apos;s realtime connection limit.
      </p>
      <p className="text-xs text-muted-foreground">
        Whether live queries are on for this database is not shown here: the API does not publish
        that switch yet, so it is read and changed from the CLI.
      </p>
      <Commands database={database} />
    </section>
  );
}

function Commands({ database }: { database: PostgresDatabase }) {
  const { org, label } = useWorkspaceTarget();
  // The live routes sit under the account's own /v1/postgres/databases and
  // find the database by the signed-in account (livequeries/service.go:174);
  // there is no organization route for them.
  if (org)
    return (
      <p className="text-xs text-muted-foreground">
        Live queries have no organization route, so {label}&apos;s databases cannot be set up for
        them from the CLI either; they work on databases of your personal account.
      </p>
    );
  return <AccountCommands database={database} />;
}

function AccountCommands({ database }: { database: PostgresDatabase }) {
  const bindings = usePostgresBindings(database.id);
  const apps = useApps();
  // The Data API reaches its database through a `data_api` binding; its
  // command sets up everything live reads need, so prefer it when one exists.
  const dataApi = (bindings.data?.items ?? []).find(
    (b: PostgresBinding) => b.access === 'data_api' && b.state === 'ready'
  );
  const slug = dataApi && apps.data?.find((a) => a.id === dataApi.app_id)?.slug;
  if (dataApi && slug)
    return (
      <div className="flex flex-col gap-2">
        <CliCommand
          label={`${slug} serves this database through the Data API. Check its live reads:`}
          command={cliDataApiLiveCommand('status', slug, dataApi.scope)}
          copyLabel={`live read status command for ${slug}`}
        />
        <CliCommand
          label="Then set up whatever is missing — live queries, usage reporting and a realtime endpoint (the Data API restarts once):"
          command={cliDataApiLiveCommand('enable', slug, dataApi.scope)}
          copyLabel={`live read enable command for ${slug}`}
        />
      </div>
    );
  return (
    <div className="flex flex-col gap-2">
      <CliCommand
        label="Check live queries on this database:"
        command={cliPostgresLiveCommand('status', database.id)}
        copyLabel={`live query status command for ${database.name}`}
      />
      <CliCommand
        label="Turn them on. The database's live secret is printed once unless you store it on an app with --app:"
        command={cliPostgresLiveCommand('enable', database.id)}
        copyLabel={`live query enable command for ${database.name}`}
      />
    </div>
  );
}
