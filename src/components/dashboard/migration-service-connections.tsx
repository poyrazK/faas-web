import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { FIELD } from '@/components/ui/field';
import { migrationConnectionKeyError } from '@/lib/migration-connections';

export function MigrationServiceConnections({
  caller,
  keys,
  targets,
  connections,
  disabled,
  onChange,
}: {
  caller: string;
  keys: string[];
  targets: string[];
  connections: Record<string, string>;
  disabled: boolean;
  onChange: (connections: Record<string, string>) => void;
}) {
  const [extra, setExtra] = useState<string[]>([]);
  const [key, setKey] = useState('');
  const [error, setError] = useState('');
  if (!targets.length && !Object.keys(connections).length) return null;
  const names = [...new Set([...keys, ...extra, ...Object.keys(connections)])].sort();
  return (
    <fieldset disabled={disabled} className="mb-4 flex flex-col gap-3">
      <legend className="mb-2 text-sm font-medium">Service connections for {caller}</legend>
      <p className="text-xs text-muted-foreground">
        Choose which runtime variables should connect to selected Gregale services. Existing
        connections stay in place until you choose a service. Private URLs are for server code;
        browser and build-time variables use the public frontend URL controls below.
      </p>
      {names.map((name) => {
        const issue = migrationConnectionKeyError(name);
        return (
          <label key={name} className="flex flex-col gap-1.5">
            <span className="label-mono">
              Connection for {caller}: {name}
            </span>
            <select
              aria-label={`Connection for ${caller}: ${name}`}
              className={FIELD}
              value={connections[name] ?? ''}
              disabled={
                disabled || !!issue || (!connections[name] && Object.keys(connections).length >= 10)
              }
              onChange={(e) => {
                const next = { ...connections };
                if (e.target.value) next[name] = e.target.value;
                else delete next[name];
                onChange(next);
              }}
            >
              <option value="">Keep existing connection</option>
              {connections[name] && !targets.includes(connections[name]) && (
                <option value={connections[name]} disabled>
                  {connections[name]} is no longer a selected dependency
                </option>
              )}
              {targets.map((target) => (
                <option key={target} value={target}>
                  Connect to {target} on Gregale
                </option>
              ))}
            </select>
            {connections[name] && (
              <span className="text-xs text-muted-foreground">
                {name} → https://{connections[name]}.internal. Replaces this key's pasted value when
                deployed; the pasted value will not be submitted.
              </span>
            )}
            {issue && <span className="text-xs text-muted-foreground">{issue}</span>}
          </label>
        );
      })}
      <label className="flex flex-col gap-1.5">
        <span className="label-mono">Add connection variable for {caller}</span>
        <input
          className={FIELD}
          value={key}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKey(e.target.value)}
          placeholder="API_URL"
        />
      </label>
      <Button
        variant="outline"
        disabled={!key.trim() || Object.keys(connections).length >= 10}
        onClick={() => {
          const name = key.trim();
          const issue = migrationConnectionKeyError(name);
          setError(issue);
          if (issue) return;
          setExtra((old) => [...new Set([...old, name])]);
          setKey('');
        }}
      >
        Add variable for {caller}
      </Button>
      {error && (
        <p role="alert" className="text-xs text-status-serious">
          {error}
        </p>
      )}
    </fieldset>
  );
}
