import type { APISandboxExampleRequest } from './api-sandboxes';

function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\"'\"'") + "'";
}

export function sandboxExampleCommand(baseURL: string, request: APISandboxExampleRequest) {
  const flags =
    request.method === 'HEAD' ? '--head' : `--include --request ${shellQuote(request.method)}`;
  const command = [
    `curl --silent --show-error --globoff ${flags}`,
    '-H "Authorization: Bearer $SANDBOX_KEY"',
  ];
  if (request.body !== undefined) {
    command.push(
      "-H 'Content-Type: application/json'",
      `--data-binary ${shellQuote(JSON.stringify(request.body))}`
    );
  }
  command.push(`--url ${shellQuote(baseURL + request.path)}`);
  return command.join(' \\\n  ');
}
