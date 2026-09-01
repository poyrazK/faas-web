/**
 * Port of `pkg/secretscan/scan.go`'s rule table (the CLI's `--secret-scan`
 * pre-pack pass). Same providers, same expressions, same severities. Keep
 * this list in the upstream order so a diff against the Go file is trivial.
 */
export interface SecretRule {
  provider: string;
  severity: 'high' | 'medium';
  regex: RegExp;
}

export const SECRET_RULES: readonly SecretRule[] = [
  { provider: 'stripe_live', severity: 'high', regex: /sk_live_[A-Za-z0-9]{24,}/ },
  { provider: 'stripe_test', severity: 'medium', regex: /sk_test_[A-Za-z0-9]{24,}/ },
  { provider: 'github_pat', severity: 'high', regex: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  { provider: 'aws_access', severity: 'high', regex: /AKIA[0-9A-Z]{16}/ },
  { provider: 'openai', severity: 'high', regex: /sk-[A-Za-z0-9]{20,}T3BlbkFJ[A-Za-z0-9]{20,}/ },
  { provider: 'anthropic', severity: 'high', regex: /sk-ant-[A-Za-z0-9-]{32,}/ },
  { provider: 'google_api', severity: 'high', regex: /AIza[0-9A-Za-z\-_]{35}/ },
  {
    provider: 'private_key_block',
    severity: 'high',
    regex: /-----BEGIN (RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/,
  },
];

export interface SecretFinding {
  key: string;
  provider: string;
  severity: SecretRule['severity'];
}

/** First matching rule wins per key; the value itself is never returned. */
export function findSecrets(entries: { key: string; value: string }[]): SecretFinding[] {
  const out: SecretFinding[] = [];
  for (const e of entries) {
    const rule = SECRET_RULES.find((r) => r.regex.test(e.value));
    if (rule) out.push({ key: e.key, provider: rule.provider, severity: rule.severity });
  }
  return out;
}
