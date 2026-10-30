export function MigrationBuildDependencies({
  caller,
  targets,
  selected,
  disabled,
  onChange,
}: {
  caller: string;
  targets: string[];
  selected: string[];
  disabled: boolean;
  onChange: (value: string[]) => void;
}) {
  if (!targets.length && !selected.length) return null;
  return (
    <fieldset disabled={disabled} className="my-4 flex flex-col gap-3">
      <legend className="label-mono">APIs needed while building {caller}</legend>
      <p className="text-xs text-muted-foreground">
        Select an API if this build fetches its data, for example during Next.js page generation.
        Gregale waits up to 30 minutes for the selected deployment to serve all traffic. Configure
        its public URL above; private runtime connections are available after deployment.
      </p>
      {[...new Set([...targets, ...selected])].map((target) => (
        <label key={target} className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(target)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...selected, target]
                  : selected.filter((name) => name !== target)
              )
            }
          />
          {caller} needs {target} during build
          {!targets.includes(target) &&
            ' (no longer in the selected dependencies; clear this choice)'}
        </label>
      ))}
    </fieldset>
  );
}
