/**
 * `gregale` commands the console hands out to copy.
 *
 * Keep these in one place: the CLI rejects near-misses rather than guessing.
 * `deploy` names the app with `--name` (`--app` is a boolean shape selector),
 * and `init` requires `--path`. `cli-commands.test.ts` pins them to the CLI's
 * usage lines.
 *
 * Values the user typed (a restore name) go through `shellArg`; values the
 * console already validated (slugs, ids, hostnames) are used as they are. A
 * `<placeholder>` stands in for anything the page does not know yet.
 */

/** Quote a typed value for a POSIX shell; leaves plain words bare. */
function shellArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(value) ? value : `'${value.replaceAll("'", `'\\''`)}'`;
}

/** Deploy the current directory to an existing app. */
export function cliDeployCommand(appSlug: string): string {
  return `gregale deploy --name ${appSlug}`;
}

/** Scaffold a catalog template into `./<template>` without deploying. */
export function cliInitCommand(template: string): string {
  return `gregale init --template ${template} --path ${template}`;
}

/** Scaffold a catalog template into `./<appSlug>` and deploy it to that app. */
export function cliInitDeployCommand(template: string, appSlug: string): string {
  return `gregale init --template ${template} --path ${appSlug} --deploy --name ${appSlug}`;
}

/** Start a run of a saved job with one task. `jobs run` needs `--tasks N` or `--input`. */
export function cliJobRunCommand(jobName: string): string {
  return `gregale jobs run ${jobName} --tasks 1`;
}

/** Delete a saved job. The CLI does not ask for confirmation. */
export function cliJobRemoveCommand(jobName: string): string {
  return `gregale jobs rm ${jobName}`;
}

const APP = '<app>';
const BUCKET = '<bucket-id>';

/** Read a bucket's versioning state; the same command also takes `enable` and `suspend`. */
export function cliBucketVersioningCommand(appSlug = APP, bucketId = BUCKET): string {
  return `gregale bucket versioning status ${appSlug} ${bucketId}`;
}

/** Read a bucket's lifecycle rules; `set` takes a JSON file and `clear` removes them. */
export function cliBucketLifecycleCommand(appSlug = APP, bucketId = BUCKET): string {
  return `gregale bucket lifecycle get ${appSlug} ${bucketId}`;
}

/** Read a bucket's default encryption. */
export function cliBucketEncryptionCommand(appSlug = APP, bucketId = BUCKET): string {
  return `gregale bucket encryption status ${appSlug} ${bucketId}`;
}

/** Read a bucket's Object Lock configuration. */
export function cliBucketObjectLockCommand(appSlug = APP, bucketId = BUCKET): string {
  return `gregale bucket object-lock status ${appSlug} ${bucketId}`;
}

/** List a bucket's in-progress multipart uploads. */
export function cliBucketUploadsCommand(appSlug = APP, bucketId = BUCKET): string {
  return `gregale bucket uploads list ${appSlug} ${bucketId}`;
}

/** Restore a managed Postgres database into a new one at a point in time. */
export function cliPostgresRestoreCommand(
  databaseId: string,
  newName?: string,
  pointInTime?: string
): string {
  const name = newName ? shellArg(newName) : '<new-name>';
  const at = pointInTime ? shellArg(pointInTime) : '<RFC3339-time>';
  return `gregale postgres restore ${databaseId} --name ${name} --point-in-time ${at}`;
}

/** Make a verified domain the default hostname for its app. */
export function cliDomainSetDefaultCommand(domain: string): string {
  return `gregale domains set-default ${domain}`;
}

/** Define an SLO an slo_budget_* alert can name (one objective; 7- or 30-day window). */
export function cliSloCreateCommand(appSlug: string): string {
  return `gregale alert slo create --app ${appSlug} --name <name> --objective 99.9`;
}

/** Define a synthetic check a synthetic_check_* alert can name. */
export function cliSyntheticCheckCreateCommand(appSlug: string): string {
  return `gregale alert check create --app ${appSlug} --name <name> --path /healthz`;
}

/** Read or turn on live queries for one managed database, named by ID. */
export function cliPostgresLiveCommand(action: 'status' | 'enable', databaseId: string): string {
  return `gregale postgres live ${action} ${databaseId}`;
}

/**
 * Read or set up a Data API's live reads: live queries on its database, usage
 * reporting, and a live-only realtime endpoint. `--scope` only when it is not
 * the default scope, which the CLI assumes.
 */
export function cliDataApiLiveCommand(
  action: 'status' | 'enable',
  appSlug: string,
  scope = 'default'
): string {
  return `gregale data-api live ${action} ${appSlug}${scope === 'default' ? '' : ` --scope ${scope}`}`;
}

/**
 * Trace which edge rules a request would match. apid has no trace endpoint:
 * the CLI simulates the gateway locally over the rules it reads (faas
 * cmd/gregale/commands_edge_rules_trace.go:28, pkg/edgeruletrace), so the
 * console builds the command. GET is the CLI's default and is left out.
 */
export function cliEdgeRuleTraceCommand(
  appSlug: string,
  request: { url?: string; method?: string; clientIp?: string; country?: string }
): string {
  const parts = [`gregale edge rule trace --app ${appSlug}`];
  const url = request.url?.trim();
  parts.push(`--url ${url ? shellArg(url) : 'https://<host>/<path>'}`);
  const method = request.method?.trim().toUpperCase();
  if (method && method !== 'GET') parts.push(`--method ${shellArg(method)}`);
  const ip = request.clientIp?.trim();
  if (ip) parts.push(`--client-ip ${shellArg(ip)}`);
  const country = request.country?.trim().toUpperCase();
  if (country) parts.push(`--country ${shellArg(country)}`);
  return parts.join(' ');
}
