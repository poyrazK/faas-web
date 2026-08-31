import { DEPLOY_TAGS, REASON_MAX, type AnnotationDraft } from '@/lib/deploy-annotations';

const INPUT =
  'h-9 w-full rounded-md border border-border bg-background px-2 font-mono text-sm outline-none focus:border-brand/50';

/**
 * The CLI's `--reason / --tag / --deployed-by / --pr-number`, as four optional
 * fields. They travel with the deployment and show in its drawer, so an
 * on-call engineer six months later can see why a Tuesday-night deploy
 * happened. All four are optional; a blank deploy is a valid deploy.
 */
export function DeployAnnotations({
  value,
  onChange,
}: {
  value: AnnotationDraft;
  onChange: (next: AnnotationDraft) => void;
}) {
  const set = <K extends keyof AnnotationDraft>(k: K, v: AnnotationDraft[K]) =>
    onChange({ ...value, [k]: v });
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 sm:col-span-2">
        <span className="label-mono text-muted-foreground">Reason</span>
        <input
          aria-label="Reason"
          value={value.reason}
          maxLength={REASON_MAX}
          onChange={(e) => set('reason', e.target.value)}
          placeholder="Why this deploy is happening"
          className={INPUT}
        />
        <span className="text-right text-[11px] text-muted-foreground">
          {value.reason.length} / {REASON_MAX}
        </span>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Tag</span>
        <select
          aria-label="Tag"
          value={value.tag}
          onChange={(e) => set('tag', e.target.value as AnnotationDraft['tag'])}
          className={INPUT}
        >
          <option value="">None</option>
          {DEPLOY_TAGS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Deployed by</span>
        <input
          aria-label="Deployed by"
          value={value.deployed_by}
          onChange={(e) => set('deployed_by', e.target.value)}
          placeholder="Your name or a bot's"
          className={INPUT}
        />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label-mono text-muted-foreground">Pull request</span>
        <input
          aria-label="Pull request"
          inputMode="numeric"
          value={value.pr_number}
          onChange={(e) => set('pr_number', e.target.value.replace(/\D/g, ''))}
          placeholder="Number only"
          className={INPUT}
        />
      </label>
    </div>
  );
}
