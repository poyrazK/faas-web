/**
 * `gregale` commands the console hands out to copy.
 *
 * Keep these in one place: the CLI rejects near-misses rather than guessing.
 * `deploy` names the app with `--name` (`--app` is a boolean shape selector),
 * and `init` requires `--path`. `cli-commands.test.ts` pins them to the CLI's
 * usage lines.
 */

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
