import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { publicBuildURLKeyError, publicBuildURLError } from '@/lib/migration-public-urls';

export function MigrationPublicConnections({
  caller,
  origin,
  keys,
  imported,
  targets,
  connections,
  urls,
  approved,
  disabled,
  onChange,
  onApprove,
}: {
  caller: string;
  origin?: string;
  keys: string[];
  imported: Record<string, string>;
  targets: { name: string; url?: string }[];
  connections: Record<string, string>;
  urls: Record<string, string>;
  approved: boolean;
  disabled: boolean;
  onChange: (connections: Record<string, string>, urls: Record<string, string>) => void;
  onApprove: (approved: boolean) => void;
}) {
  const [extra, setExtra] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  const names = [
    ...new Set([
      ...keys.filter((k) => !publicBuildURLKeyError(k)),
      ...extra,
      ...Object.keys(connections),
      ...Object.keys(urls),
    ]),
  ].sort();
  const count = Object.keys(connections).length + Object.keys(urls).length;
  function choose(name: string, choice: string) {
    const nextConnections = { ...connections };
    const nextURLs = { ...urls };
    delete nextConnections[name];
    delete nextURLs[name];
    if (choice === 'existing') nextURLs[name] = imported[name] ?? '';
    else if (choice) nextConnections[name] = choice.slice('service:'.length);
    onChange(nextConnections, nextURLs);
  }
  return (
    <fieldset disabled={disabled} className="mb-4 flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">Public frontend URLs for {caller}</legend>
      <p className="text-xs text-muted-foreground">
        Frontend frameworks bake these URLs into the app during its build. Choose a public URL below
        to configure it before the first build. Saved choices are reused on retry.
      </p>
      {names.map((name) => {
        const target = targets.find((t) => t.name === connections[name]);
        const existing = Object.hasOwn(urls, name);
        const value = existing ? urls[name] : target?.url;
        const issue = value !== undefined ? publicBuildURLError(value) : '';
        return (
          <div key={name} className="flex flex-col gap-1.5">
            <label className="flex flex-col gap-1.5">
              <span className="label-mono">
                Public connection for {caller}: {name}
              </span>
              <select
                aria-label={`Public connection for ${caller}: ${name}`}
                className={FIELD}
                value={
                  connections[name] ? `service:${connections[name]}` : existing ? 'existing' : ''
                }
                disabled={disabled || (!connections[name] && !existing && count >= 10)}
                onChange={(e) => choose(name, e.target.value)}
              >
                <option value="">Keep as runtime configuration</option>
                <option value="existing">Use an existing public URL at build time</option>
                {connections[name] && (!target || !target.url) && (
                  <option value={`service:${connections[name]}`} disabled>
                    {connections[name]} no longer has a selected public endpoint
                  </option>
                )}
                {targets
                  .filter((t) => !!t.url)
                  .map((t) => (
                    <option key={t.name} value={`service:${t.name}`}>
                      Connect to {t.name} on Gregale
                    </option>
                  ))}
              </select>
            </label>
            {existing && (
              <label className="flex flex-col gap-1.5">
                <span className="label-mono">
                  Public URL for {caller}: {name}
                </span>
                <input
                  className={FIELD}
                  value={urls[name]}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => onChange(connections, { ...urls, [name]: e.target.value })}
                  placeholder="https://api.example.com"
                />
              </label>
            )}
            {value && (
              <p className="break-all text-xs text-muted-foreground">
                {name} → {value}
              </p>
            )}
            {issue && (
              <p role="alert" className="text-xs text-status-serious">
                {issue}
              </p>
            )}
          </div>
        );
      })}
      <label className="flex flex-col gap-1.5">
        <span className="label-mono">Add public URL variable for {caller}</span>
        <input
          className={FIELD}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          placeholder="VITE_API_URL"
        />
      </label>
      <Button
        variant="outline"
        disabled={!key.trim() || count >= 10}
        onClick={() => {
          const name = key.trim();
          const issue = publicBuildURLKeyError(name);
          setError(issue);
          if (!issue) {
            setExtra((old) => [...new Set([...old, name])]);
            setKey('');
          }
        }}
      >
        Add public variable for {caller}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-status-serious">
          {error}
        </p>
      )}
      {count > 0 && (
        <>
          <label className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={approved}
              onChange={(e) => onApprove(e.target.checked)}
            />
            These URLs are public and may be included in browser bundles for {caller}.
          </label>
          <p className="text-xs text-muted-foreground">
            The API must allow browser requests{origin ? ` from ${origin}` : ' from this frontend'}.
            Review CORS and application authentication before cutover. Dockerfiles must declare the
            matching ARG variables.
          </p>
        </>
      )}
    </fieldset>
  );
}
