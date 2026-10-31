import { describe, expect, it } from 'vitest';
import { cliDeployCommand, cliInitCommand, cliInitDeployCommand } from './cli-commands';

// The CLI's own usage lines, copied from poyrazK/faas cmd/gregale:
//   init:   "gregale init --template <name> --path <dir> [--deploy] [--name <slug>] ..."
//   deploy: names the app with --name; --app is a boolean shape selector, so
//           `deploy --app my-app` is rejected with "Did you mean `gregale deploy --name my-app`?"
describe('cli commands handed out by the console', () => {
  it('deploys an existing app by --name, never --app <slug>', () => {
    expect(cliDeployCommand('my-api')).toBe('gregale deploy --name my-api');
  });

  it('scaffolds a template into a directory named after it, since init requires --path', () => {
    expect(cliInitCommand('hello-node')).toBe(
      'gregale init --template hello-node --path hello-node'
    );
  });

  it('scaffolds a template with the required --path and deploys it to the created app', () => {
    expect(cliInitDeployCommand('hello-python', 'my-api')).toBe(
      'gregale init --template hello-python --path my-api --deploy --name my-api'
    );
  });
});
