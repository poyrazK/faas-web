import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { components } from '@/lib/api/schema';

type Preset = components['schemas']['AlertPresetResponse'];
type Body = components['schemas']['EnableAlertPresetRequest'];

/**
 * The eight-row catalog, grouped by category. Pick one, give it a webhook,
 * and it becomes an ordinary rule on the app — editable like any other.
 * Until now every rule had to be assembled field by field.
 */
export function PresetPicker({
  presets,
  onEnable,
  busy,
}: {
  presets: Preset[];
  onEnable: (name: string, body: Body) => void;
  busy: boolean;
}) {
  const [picked, setPicked] = useState<Preset | null>(null);
  const [url, setUrl] = useState('');
  const [secret, setSecret] = useState('');
  const groups = useMemo(() => {
    const m = new Map<string, Preset[]>();
    for (const p of presets.filter((p) => p.enabled_in_catalog)) {
      m.set(p.category, [...(m.get(p.category) ?? []), p]);
    }
    return [...m.entries()];
  }, [presets]);
  const valid = /^https:\/\//.test(url.trim()) && secret.length >= 16;

  return (
    <div className="flex flex-col gap-4">
      {groups.map(([category, rows]) => (
        <div key={category}>
          <p className="label-mono mb-2 text-muted-foreground">{category}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((p) => (
              <button
                key={p.name}
                type="button"
                aria-pressed={picked?.name === p.name}
                onClick={() => setPicked(p)}
                className={cn(
                  'rounded-lg border p-3 text-left transition-colors',
                  picked?.name === p.name
                    ? 'border-brand bg-mint-1'
                    : 'border-border hover:border-brand/40'
                )}
              >
                <span className="block text-sm font-medium">{p.display_name}</span>
                <span className="block text-xs text-muted-foreground">{p.description}</span>
                <span className="mt-1 block font-mono text-[11px] text-muted-foreground">
                  {p.metric} {p.comparison} {p.threshold} · {p.window_spec} · {p.minimum_plan}+
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}
      {picked && (
        <form
          className="flex flex-wrap items-end gap-3 rounded-lg border border-border p-3"
          onSubmit={(e) => {
            e.preventDefault();
            // `enabled: true` is the API's default, sent explicitly under the generated type.
            if (valid)
              onEnable(picked.name, {
                webhook_url: url.trim(),
                webhook_secret: secret,
                enabled: true,
              });
          }}
        >
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Webhook URL</span>
            <input
              aria-label="Webhook URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://hooks.example.com/alerts"
              className="h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
            />
          </label>
          <label className="flex min-w-56 flex-1 flex-col gap-1.5">
            <span className="label-mono text-muted-foreground">Webhook secret</span>
            <input
              aria-label="Webhook secret"
              type="password"
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              className="h-9 rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50"
            />
          </label>
          <Button type="submit" size="sm" disabled={!valid} busy={busy}>
            Enable preset
          </Button>
        </form>
      )}
    </div>
  );
}
