export const MEMORY_OPTIONS = [128, 256, 512, 1024, 2048] as const;

export function MemorySelect({
  value,
  maxMb,
  onChange,
}: {
  value: number;
  maxMb?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5" role="group" aria-label="Memory per instance">
      {MEMORY_OPTIONS.map((mb) => {
        const disabled = maxMb === undefined || mb > maxMb;
        return (
          <button
            key={mb}
            type="button"
            disabled={disabled}
            aria-pressed={value === mb}
            title={
              maxMb === undefined
                ? 'Checking plan limits'
                : disabled
                  ? `Requires a plan with ${mb} MB per instance`
                  : undefined
            }
            onClick={() => onChange(mb)}
            className={`pressable h-9 rounded-md border px-3 font-mono text-xs disabled:cursor-not-allowed disabled:opacity-40 ${
              value === mb
                ? 'border-brand bg-brand/10 text-foreground'
                : 'border-border text-muted-foreground hover:text-foreground'
            }`}
          >
            {mb} MB
          </button>
        );
      })}
    </div>
  );
}
