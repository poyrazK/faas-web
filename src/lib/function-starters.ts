/**
 * Starter handlers for a function written in the console. Copied verbatim
 * from the CLI's embedded templates in poyrazK/faas
 * (`cmd/gregale/templates/function-node` and `function-python` at origin/main
 * 5f003ca), so a console-written function starts from exactly what
 * `gregale init --template function-*` writes. Go and Rust functions compile
 * through a generated module and a Dockerfile, so they start from the
 * template catalog and the CLI instead.
 *
 * The API keeps a runtime's default handler file when the deploy names the
 * historical `handler.handler` (pkg/api/function_handler.go), so the file
 * names here are the contract: `handler.js` for Node, `handler.py` for Python.
 */

export type FunctionLanguage = 'node' | 'python';

export interface FunctionStarter {
  language: FunctionLanguage;
  label: string;
  /** The runtime the CLI template deploys with. */
  runtime: 'node22' | 'python312';
  /** Versions this language can run on; Configure picks among them. */
  runtimes: readonly ('node22' | 'node24' | 'python312' | 'python313')[];
  filename: 'handler.js' | 'handler.py';
  accept: string;
  code: string;
  /** Files the archive carries beside the handler. */
  extra: { name: string; content: string }[];
}

export const FUNCTION_STARTERS: Record<FunctionLanguage, FunctionStarter> = {
  node: {
    language: 'node',
    label: 'Node.js',
    runtime: 'node22',
    runtimes: ['node22', 'node24'],
    filename: 'handler.js',
    accept: '.js,.mjs,text/javascript',
    code: `// Function template for gregale.
//
// Unlike app templates (express on :8080), functions expose a single
// exported async handler(event, ctx) that the node22 runner invokes
// directly. The CLI forces --runtime node22 --handler handler.handler
// when deploying this template so the wiring is automatic.

export async function handler(event, ctx) {
  // Never log or echo the request event: it can contain cookies, API keys,
  // authorization headers, and customer payloads. Keep the starter useful
  // with a bounded, non-secret invocation marker instead.
  ctx.log.info("function invoked", { invocation_id: ctx.invocation_id });
  return {
    statusCode: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ok: true,
      invocation_id: ctx.invocation_id,
    }),
  };
}
`,
    // The starter is an ES module, which Node runs only with this beside it.
    extra: [
      {
        name: 'package.json',
        content: `{
  "name": "function-gregale",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "handler.js",
  "engines": {
    "node": ">=22"
  }
}
`,
      },
    ],
  },
  python: {
    language: 'python',
    label: 'Python',
    runtime: 'python312',
    runtimes: ['python312', 'python313'],
    filename: 'handler.py',
    accept: '.py,text/x-python',
    code: `"""Function template for gregale (python312).

Functions are invoked directly by the runner — no HTTP server. The
CLI forces \`--runtime python312 --handler handler.handler\` when
deploying this template.

\`handler(event, ctx)\` returns a dict with \`statusCode\`, optional
\`headers\`, and a string \`body\`. The runner ships the response back to
the gateway which forwards it to the customer.
"""
import json


async def handler(event, ctx):
    # Do not log or echo event: it can contain cookies, API keys,
    # authorization headers, and customer payloads.
    ctx.log.info("function invoked", extra={"invocation_id": ctx.invocation_id})
    return {
        "statusCode": 200,
        "headers": {"content-type": "application/json"},
        "body": json.dumps(
            {
                "ok": True,
                "invocation_id": ctx.invocation_id,
            }
        ),
    }
`,
    extra: [],
  },
};

export function languageOf(runtime: string): FunctionLanguage | undefined {
  if (runtime.startsWith('node')) return 'node';
  if (runtime.startsWith('python')) return 'python';
  return undefined;
}
