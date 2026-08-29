import {
  useCallback,
  type ComponentPropsWithoutRef,
  type PointerEvent,
  type ReactNode,
} from 'react';
import { ArrowRight } from 'iconoir-react';
import { Link } from '@tanstack/react-router';
import { cn } from '@/lib/utils';

/**
 * Bento grid — vendored from Magic UI (magicui.design/docs/components/bento-grid)
 * and re-cut for this design system.
 *
 * The anatomy is upstream's: the `background` fills the card, the copy is
 * pinned to the bottom and lifts on hover to make room for the action, the
 * icon shrinks toward its origin as it does. What changed:
 * - Colours are tokens (`bg-card`, `border-border`, `text-muted-foreground`),
 *   not literal neutrals with `dark:` twins — see README § Theming.
 * - The call to action is not hover-only. Upstream hides it until the card is
 *   hovered, which leaves keyboard and touch users with no link at all. Here
 *   it is visible at rest below `lg`, and above `lg` it slides in on hover
 *   *or* focus-within.
 * - `doc` is a docs slug routed through the router, so it preloads and never
 *   reloads the document.
 */

export function BentoGrid({ children, className, ...props }: ComponentPropsWithoutRef<'div'>) {
  return (
    <div
      className={cn(
        'grid w-full auto-rows-[25rem] grid-cols-1 lg:auto-rows-[22rem] gap-4 lg:grid-cols-3',
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

interface BentoCardProps extends Omit<ComponentPropsWithoutRef<'div'>, 'title'> {
  name: string;
  description: string;
  Icon: React.ComponentType<{ className?: string }>;
  /** Docs slug the card's action opens. */
  doc: string;
  cta?: string;
  /** Decorative layer behind the copy. Mark it `aria-hidden` yourself. */
  background?: ReactNode;
}

export function BentoCard({
  name,
  description,
  Icon,
  doc,
  cta = 'Read the docs',
  background,
  className,
  ...props
}: BentoCardProps) {
  // Cursor light (Magic UI's MagicCard idea): the pointer position is written
  // to two custom properties and a radial gradient follows it. Pointer-fine
  // only in effect — on touch there is no hover, so the layer stays at 0.
  const onPointerMove = useCallback((e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--x', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--y', `${e.clientY - r.top}px`);
  }, []);

  return (
    <div
      onPointerMove={onPointerMove}
      className={cn(
        'group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border',
        // Lit glass rather than a paper rectangle: a faint top-to-bottom tint
        // and a one-pixel inner highlight along the top edge — the same idea
        // the CTA button uses — over upstream's three-layer drop shadow, cast
        // in the page's own ink rather than black.
        'bg-gradient-to-b from-mint-1 to-card',
        'shadow-[inset_0_1px_0_0_color-mix(in_srgb,var(--card)_70%,transparent),0_0_0_1px_color-mix(in_srgb,var(--foreground)_3%,transparent),0_2px_4px_color-mix(in_srgb,var(--foreground)_5%,transparent),0_12px_24px_color-mix(in_srgb,var(--foreground)_5%,transparent)]',
        'transition-colors duration-300 hover:border-brand/40 focus-within:border-brand/40',
        className
      )}
      {...props}
    >
      {/* Dither nuance: two mint dot lattices at different pitches, masked
          so they gather toward the top-right and thin to nothing before the
          copy. Invisible at rest; on hover or focus-within the lattice fades
          in and drifts (shared keyframes, stopped under reduced motion). It
          sits under the background so every tile shares one grain of the
          hero's dither without competing with its own illustration. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="animate-dither-drift-a absolute -inset-6 opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-[0.32] group-focus-within:opacity-[0.32] motion-reduce:transition-none"
          style={{
            backgroundImage:
              'radial-gradient(color-mix(in oklab, var(--brand) 55%, transparent) 1px, transparent 1.2px)',
            backgroundSize: '6px 6px',
            WebkitMaskImage: 'radial-gradient(70% 80% at 88% 8%, black, transparent 72%)',
            maskImage: 'radial-gradient(70% 80% at 88% 8%, black, transparent 72%)',
          }}
        />
        <div
          className="animate-dither-drift-b absolute -inset-6 opacity-0 transition-opacity duration-700 ease-out group-hover:opacity-[0.22] group-focus-within:opacity-[0.22] motion-reduce:transition-none"
          style={{
            backgroundImage:
              'radial-gradient(color-mix(in oklab, var(--brand) 45%, transparent) 1px, transparent 1.2px)',
            backgroundSize: '11px 11px',
            backgroundPosition: '5px 5px',
            WebkitMaskImage: 'radial-gradient(95% 100% at 80% 0%, black 10%, transparent 78%)',
            maskImage: 'radial-gradient(95% 100% at 80% 0%, black 10%, transparent 78%)',
          }}
        />
      </div>

      <div className="pointer-events-none absolute inset-0">{background}</div>

      {/* Cursor light. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 motion-reduce:transition-none"
        style={{
          background:
            'radial-gradient(360px circle at var(--x, 50%) var(--y, 50%), color-mix(in srgb, var(--brand-fill) 14%, transparent), transparent 60%)',
        }}
      />

      <div className="pointer-events-none relative z-10 mt-auto flex flex-col gap-1 p-6 transition-transform duration-300 motion-reduce:transition-none lg:group-hover:-translate-y-10 lg:group-focus-within:-translate-y-10">
        <Icon className="h-10 w-10 origin-left text-brand transition-transform duration-300 ease-in-out motion-reduce:transition-none group-hover:scale-75" />
        <h3 className="mt-1 text-xl font-semibold tracking-tight text-foreground">{name}</h3>
        <p className="max-w-lg text-sm leading-relaxed text-muted-foreground">{description}</p>
      </div>

      <div className="relative z-10 flex items-center px-6 pb-5 transition-all duration-300 motion-reduce:transition-none lg:absolute lg:bottom-0 lg:w-full lg:translate-y-10 lg:opacity-0 lg:group-hover:translate-y-0 lg:group-hover:opacity-100 lg:group-focus-within:translate-y-0 lg:group-focus-within:opacity-100">
        <Link
          to="/docs/$slug"
          params={{ slug: doc }}
          className="inline-flex items-center gap-1.5 rounded-md text-sm font-medium text-brand outline-none transition-colors hover:text-brand-hover focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {cta}
          <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
        </Link>
      </div>
    </div>
  );
}
