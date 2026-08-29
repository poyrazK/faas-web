import type { Runtime } from '@/lib/mock-data';

/**
 * Deploy-an-example templates.
 *
 * Each scaffold follows the platform's real function contract as the
 * runtime docs state it — the stdin/stdout JSON envelope with `body_b64`
 * — so a pasted scaffold runs unmodified. Templates prefill the new-app
 * wizard; the scaffold and its deploy steps appear once the app exists.
 * Nothing here fabricates API behaviour: a template is prefilled config
 * plus code to paste, and the deploy is the same `gregale deploy` every
 * app uses.
 */

export interface Template {
  slug: string;
  name: string;
  tagline: string;
  runtime: Runtime;
  runtimeLabel: string;
  memoryMb: number;
  /** Scaffold entrypoint path, per the runtime contract. */
  filename: string;
  code: string;
  /** What to do after the app exists, in order. */
  steps: string[];
}

export const TEMPLATES: Template[] = [
  {
    slug: 'node-api',
    name: 'JSON API',
    tagline: 'A routed JSON API with two endpoints and honest 404s.',
    runtime: 'node24',
    runtimeLabel: 'Node 24',
    memoryMb: 128,
    filename: 'node24.js',
    code: `// /app/node24.js
const json = (status, data) => ({
  status,
  headers: { 'content-type': 'application/json' },
  body_b64: Buffer.from(JSON.stringify(data)).toString('base64'),
});

export default async function handler(req) {
  if (req.method === 'GET' && req.path === '/') {
    return json(200, { ok: true, service: 'json-api' });
  }
  if (req.method === 'POST' && req.path === '/echo') {
    const body = req.body_b64 ? Buffer.from(req.body_b64, 'base64').toString() : '';
    return json(200, { received: body });
  }
  return json(404, { error: 'not_found', path: req.path });
}`,
    steps: ['Save the scaffold as node24.js in an empty directory.', 'gregale deploy --app'],
  },
  {
    slug: 'node-webhook',
    name: 'Webhook receiver',
    tagline: 'Accept a webhook, acknowledge fast, log the payload.',
    runtime: 'node24',
    runtimeLabel: 'Node 24',
    memoryMb: 128,
    filename: 'node24.js',
    code: `// /app/node24.js
export default async function handler(req) {
  if (req.method !== 'POST') {
    return { status: 405, headers: { allow: 'POST' }, body_b64: '' };
  }
  const payload = req.body_b64 ? Buffer.from(req.body_b64, 'base64').toString() : '';
  // Sender signature headers arrive in req.headers — verify before trusting.
  console.log('webhook received', payload.slice(0, 500));
  return { status: 202, headers: {}, body_b64: '' };
}`,
    steps: [
      'Save the scaffold as node24.js in an empty directory.',
      'gregale deploy --app',
      'Point the sender at the app URL, then watch Logs for deliveries.',
    ],
  },
  {
    slug: 'python-api',
    name: 'Python API',
    tagline: 'The same JSON envelope, in Python 3.13.',
    runtime: 'python313',
    runtimeLabel: 'Python 3.13',
    memoryMb: 128,
    filename: 'handler.py',
    code: `# /app/handler.py
import base64
import json


def _json(status, data):
    body = base64.b64encode(json.dumps(data).encode()).decode()
    return {"status": status, "headers": {"content-type": "application/json"}, "body_b64": body}


def handler(request):
    if request["method"] == "GET" and request["path"] == "/":
        return _json(200, {"ok": True, "service": "python-api"})
    return _json(404, {"error": "not_found", "path": request["path"]})`,
    steps: ['Save the scaffold as handler.py in an empty directory.', 'gregale deploy --app'],
  },
  {
    slug: 'python-report',
    name: 'Scheduled report',
    tagline: 'A function built to be fired by a cron, not a browser.',
    runtime: 'python313',
    runtimeLabel: 'Python 3.13',
    memoryMb: 256,
    filename: 'handler.py',
    code: `# /app/handler.py
import base64
import datetime
import json


def handler(request):
    # A cron fires this on schedule; the work goes here.
    ran_at = datetime.datetime.now(datetime.timezone.utc).isoformat()
    print(f"report run at {ran_at}")
    body = base64.b64encode(json.dumps({"ran_at": ran_at}).encode()).decode()
    return {"status": 200, "headers": {"content-type": "application/json"}, "body_b64": body}`,
    steps: [
      'Save the scaffold as handler.py in an empty directory.',
      'gregale deploy --app',
      'Create a Cron Job for the app (Cron Jobs in the sidebar) with your schedule.',
    ],
  },
  {
    slug: 'go-api',
    name: 'Go API',
    tagline: 'The envelope as a compiled program — smallest wake, sharpest p95.',
    runtime: 'go124',
    runtimeLabel: 'Go 1.24',
    memoryMb: 128,
    filename: 'main.go',
    code: `// /app/main.go
package main

import (
	"encoding/base64"
	"encoding/json"
	"io"
	"os"
)

type request struct {
	Method  string            \`json:"method"\`
	Path    string            \`json:"path"\`
	Headers map[string]string \`json:"headers"\`
	Query   string            \`json:"query"\`
	BodyB64 string            \`json:"body_b64"\`
}

type response struct {
	Status  int               \`json:"status"\`
	Headers map[string]string \`json:"headers"\`
	BodyB64 string            \`json:"body_b64"\`
}

func main() {
	raw, _ := io.ReadAll(os.Stdin)
	var req request
	_ = json.Unmarshal(raw, &req)

	body, _ := json.Marshal(map[string]any{"ok": true, "path": req.Path})
	resp := response{
		Status:  200,
		Headers: map[string]string{"content-type": "application/json"},
		BodyB64: base64.StdEncoding.EncodeToString(body),
	}
	_ = json.NewEncoder(os.Stdout).Encode(resp)
}`,
    steps: ['Save the scaffold as main.go in an empty directory.', 'gregale deploy --app'],
  },
  {
    slug: 'go-pinger',
    name: 'Uptime pinger',
    tagline: 'A scheduled check that logs what it finds — pair it with a cron.',
    runtime: 'go124-alpine',
    runtimeLabel: 'Go 1.24 (Alpine)',
    memoryMb: 128,
    filename: 'main.go',
    code: `// /app/main.go
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

func main() {
	target := os.Getenv("TARGET_URL")
	start := time.Now()
	status := 0
	if target != "" {
		if resp, err := http.Get(target); err == nil {
			status = resp.StatusCode
			resp.Body.Close()
		}
	}
	fmt.Fprintf(os.Stderr, "ping %s -> %d in %s\\n", target, status, time.Since(start))
	_ = json.NewEncoder(os.Stdout).Encode(map[string]any{
		"status": 200, "headers": map[string]string{}, "body_b64": "",
	})
}`,
    steps: [
      'Save the scaffold as main.go in an empty directory.',
      'Set a TARGET_URL secret on the app.',
      'gregale deploy --app',
      'Create a Cron Job for the app with your check interval.',
    ],
  },
];

export const templateBySlug = (slug: string | undefined): Template | undefined =>
  TEMPLATES.find((t) => t.slug === slug);
