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

/**
 * Set an app's pre-auth guard. With no guard stored, observe and enforce need
 * a rate and burst of at least 1 (faas cmd/gregale/app_pre_auth.go:39-41);
 * switching a stored guard's mode keeps its rate, so `rate` is optional.
 */
export function cliPreAuthCommand(
  appSlug: string,
  mode: 'off' | 'observe' | 'enforce',
  rate?: { rps: number; burst: number }
): string {
  const base = `gregale app ${appSlug} --pre-auth ${mode}`;
  return rate ? `${base} --pre-auth-rps ${rate.rps} --pre-auth-burst ${rate.burst}` : base;
}
