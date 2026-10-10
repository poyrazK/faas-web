import { useId, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { Github } from 'iconoir-react';
import { Button } from '@/components/ui/button';

export function CompatibilityEntry() {
  const id = useId();
  const navigate = useNavigate();
  const [source, setSource] = useState('');

  return (
    <div className="mt-8 w-full max-w-xl text-left">
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-foreground">
        Will your repository run on Gregale?
      </label>
      <form
        action="/will-it-run"
        method="get"
        onSubmit={(event) => {
          event.preventDefault();
          if (source.trim())
            void navigate({
              to: '/will-it-run',
              search: { source: source.trim(), ref: undefined },
            });
        }}
        className="flex flex-col gap-2 rounded-2xl border border-border bg-card/90 p-2 shadow-sm sm:flex-row sm:items-center"
      >
        <div className="flex min-w-0 flex-1 items-center gap-2 px-2">
          <Github aria-hidden className="size-5 shrink-0 text-muted-foreground" />
          <input
            id={id}
            name="source"
            aria-label="Public GitHub repository"
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="github.com/you/your-api"
            maxLength={512}
            required
            autoComplete="off"
            spellCheck={false}
            className="h-11 min-w-0 flex-1 rounded-md bg-transparent px-1 text-sm text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-brand"
          />
        </div>
        <Button type="submit" variant="cta" className="h-11 shrink-0 rounded-xl px-5">
          Will it run?
        </Button>
      </form>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
        Check a public GitHub repository before signing up. Nothing is built or deployed.
      </p>
    </div>
  );
}
