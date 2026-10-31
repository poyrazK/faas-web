import { useId } from 'react';
import { Check, Upload } from 'iconoir-react';
import { FieldError } from '@/components/ui/field';
import { FUNCTION_STARTERS, type FunctionLanguage } from '@/lib/function-starters';
import { cn } from '@/lib/utils';

const LANGUAGES: { id: FunctionLanguage; mark: string; line: string }[] = [
  { id: 'node', mark: 'JS', line: 'Node 22 or 24 · an ES module, handler.js' },
  { id: 'python', mark: 'PY', line: 'Python 3.12 or 3.13 · handler.py' },
];

/**
 * A function written in the console: pick the language, then write the
 * handler (or drop in its file), starting from the CLI's own starter. The
 * console packs it and deploys it right after the app is created, so no
 * repository or CLI is needed. Go and Rust compile through a module and a
 * Dockerfile, so they start from the catalog's function starters instead.
 */
export function FunctionSource({
  formId,
  language,
  code,
  edited,
  error,
  errorId,
  onLanguage,
  onCode,
  onReset,
  onBrowseStarters,
}: {
  formId: string;
  language: FunctionLanguage;
  code: string;
  /** The handler differs from the language's starter. */
  edited: boolean;
  error?: string;
  errorId?: string;
  onLanguage: (language: FunctionLanguage) => void;
  onCode: (code: string) => void;
  onReset: () => void;
  onBrowseStarters: () => void;
}) {
  const uid = useId();
  const starter = FUNCTION_STARTERS[language];

  const read = async (file: File) => {
    const name = file.name.toLowerCase();
    if (name.endsWith('.py')) onLanguage('python');
    else if (name.endsWith('.js') || name.endsWith('.mjs')) onLanguage('node');
    onCode(await file.text());
  };

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-3">
        <h2 id={`${uid}-language`} className="text-sm font-medium text-muted-foreground">
          Language
        </h2>
        <div
          role="radiogroup"
          aria-labelledby={`${uid}-language`}
          className="flex flex-col divide-y divide-border rounded-xl border border-border bg-card"
        >
          {LANGUAGES.map((l) => (
            <label
              key={l.id}
              className="group flex cursor-pointer items-center gap-3.5 px-4 py-3 transition-colors first:rounded-t-[11px] last:rounded-b-[11px] hover:bg-accent/40 has-checked:bg-accent/50 has-focus-visible:ring-2 has-focus-visible:ring-inset has-focus-visible:ring-brand"
            >
              <input
                type="radio"
                name="function-language"
                form={formId}
                value={l.id}
                checked={language === l.id}
                onChange={() => onLanguage(l.id)}
                aria-label={FUNCTION_STARTERS[l.id].label}
                aria-describedby={`${uid}-${l.id}-line`}
                className="sr-only"
              />
              <span
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted font-mono text-[11px] font-semibold text-muted-foreground transition-colors group-has-checked:bg-brand/15 group-has-checked:text-brand"
              >
                {l.mark}
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium">{FUNCTION_STARTERS[l.id].label}</span>
                <span id={`${uid}-${l.id}-line`} className="text-[13px] text-muted-foreground">
                  {l.line}
                </span>
              </span>
              <Check
                aria-hidden
                className="h-4 w-4 shrink-0 text-brand opacity-0 group-has-checked:opacity-100"
              />
            </label>
          ))}
        </div>
        <p className="text-[13px] text-muted-foreground">
          Go or Rust?{' '}
          <button
            type="button"
            onClick={onBrowseStarters}
            className="font-medium text-foreground underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
          >
            Use a function starter
          </button>
          ; they build with the CLI.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Handler</h2>
        <div className="flex flex-col rounded-xl border border-border bg-card">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <label htmlFor={`${uid}-code`} className="font-mono text-[13px] font-medium">
              {starter.filename}
            </label>
            <div className="flex items-center gap-1">
              {edited && (
                <button
                  type="button"
                  onClick={onReset}
                  className="inline-flex h-8 items-center rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  Reset to starter
                </button>
              )}
              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md px-2.5 text-[13px] text-muted-foreground transition-colors hover:bg-accent/50 hover:text-foreground has-focus-visible:ring-2 has-focus-visible:ring-brand">
                <Upload aria-hidden className="h-3.5 w-3.5" />
                Upload
                <input
                  type="file"
                  aria-label="Upload a handler file"
                  accept={`${FUNCTION_STARTERS.node.accept},${FUNCTION_STARTERS.python.accept}`}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void read(file);
                    e.target.value = '';
                  }}
                  className="sr-only"
                />
              </label>
            </div>
          </div>
          <textarea
            id={`${uid}-code`}
            name="handler"
            form={formId}
            value={code}
            onChange={(e) => onCode(e.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-invalid={error ? true : undefined}
            aria-describedby={cn(`${uid}-contract`, error && errorId)}
            className="min-h-[22rem] w-full resize-y bg-transparent px-4 py-3 font-mono text-[13px] leading-6 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
          />
          <p
            id={`${uid}-contract`}
            className="border-t border-border px-4 py-2.5 text-[13px] text-muted-foreground"
          >
            Exports <code className="font-mono">handler(event, ctx)</code> and returns a status
            code, headers and a body. It deploys as soon as the app exists.
          </p>
        </div>
        {error && errorId && <FieldError id={errorId}>{error}</FieldError>}
      </div>
    </div>
  );
}
