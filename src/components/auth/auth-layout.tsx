import type { ReactNode } from 'react';
import { RestoreTarget } from '@/components/restore-target';
import { RESTORE_CONTEXT } from '@/lib/platform-claims';
import { Link } from '@tanstack/react-router';
import { DotCutCanvas } from '@/components/dotcut/dot-cut-canvas';
import type { Scene } from '@/components/dotcut/scenes';

/**
 * The auth-screen scene cycle.
 *
 * Identical to the stock set except the text scene, which rendered a bare `A`
 * — a placeholder from the component's own demo with no relationship to this
 * product. It spells the wordmark now.
 *
 * `fit` and the raised column count are both doing real work. The rasteriser
 * defaults to 0.36 of the grid width, which suits one glyph; seven letters in
 * that space get two cells each and dissolve into noise. Widening to 0.9 is
 * necessary but not sufficient — at the stock 42 columns that still leaves
 * about five cells per letter, which reads as texture rather than type. 72
 * columns gives roughly nine, which is where the letterforms actually resolve.
 *
 * The cost is smaller dots across every scene, and that is a deliberate trade:
 * a wordmark that cannot be read is worth less than a slightly finer halftone.
 *
 * Defined at module scope on purpose: `DotCutCanvas` rebuilds its canvas when
 * this array's identity changes, so an inline literal would tear down and
 * restart the animation on every render.
 */
const AUTH_SCENES: Scene[] = [
  { kind: 'text', value: 'GREGALE', fit: 0.9, transition: 'wipe', palette: 0, style: 'drift' },
  { kind: 'rings', transition: 'ripple', palette: 1, style: 'grain' },
  { kind: 'columns', transition: 'columns', palette: 2, style: 'streak' },
  { kind: 'checker', transition: 'scatter', palette: 3, style: 'swell' },
  { kind: 'boxes', transition: 'collapse', palette: 4, style: 'grain' },
  { kind: 'bars', transition: 'wipe', palette: 5, style: 'drift' },
];

const PROOF_POINTS = [
  ['Idle cost', 'zero'],
  ['Isolation', 'hardware microVM'],
];

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background text-foreground">
      {/* Form side */}
      <div className="flex w-full flex-col px-5 py-8 sm:px-10 lg:w-[52%] lg:px-16">
        <Link to="/" className="inline-flex w-fit items-center">
          <img src="/logo.png" alt="Gregale" className="h-7 w-auto" />
        </Link>

        <div className="flex flex-1 items-center py-10">
          <div className="mx-auto w-full max-w-sm">{children}</div>
        </div>

        {/* Privacy and Terms linked to `#`. They are pages this product owes
            its customers, but linking them before they exist is worse than
            omitting them — put them back here once they are written. */}
        <p className="mb-3 max-w-md text-xs leading-relaxed text-muted-foreground">
          <RestoreTarget />. {RESTORE_CONTEXT}
        </p>
        <p className="text-xs text-muted-foreground">© {new Date().getFullYear()} Gregale</p>
      </div>

      {/* Visual side */}
      <aside className="relative hidden overflow-hidden border-l border-border lg:block lg:w-[48%]">
        <DotCutCanvas
          scenes={AUTH_SCENES}
          columns={72}
          className="absolute inset-0 h-full w-full"
        />
        <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-12">
          <p className="max-w-sm text-2xl leading-[1.2] font-semibold tracking-tight">
            Functions that sleep at zero and wake in a blink.
          </p>
          <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
            {PROOF_POINTS.map(([label, value]) => (
              <div key={label}>
                <dt className="label-mono text-muted-foreground">{label}</dt>
                <dd className="mt-1 text-sm font-medium">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </aside>
    </div>
  );
}
