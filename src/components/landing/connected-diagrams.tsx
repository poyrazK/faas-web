export type ConnectedDiagramKind = 'services' | 'jobs' | 'workflows' | 'releases';

/**
 * Connected work, drawn in the Hosting figures' language (`hosting-diagrams.tsx`,
 * same classes and 420×210 frame). Explanatory schematics: the app names and
 * revisions are illustrations, not account data or measured behaviour.
 */
export function ConnectedDiagram({ kind }: { kind: ConnectedDiagramKind }) {
  return (
    <svg viewBox="0 0 420 210" fill="none" aria-hidden="true" className="hosting-diagram">
      {kind === 'services' && (
        <>
          <path className="hosting-grid" d="M 0 177 H 420" />
          <text className="hosting-note" x="75" y="24">
            Callers
          </text>
          <rect
            className="hosting-surface hosting-accent"
            x="20"
            y="38"
            width="110"
            height="52"
            rx="7"
          />
          <text className="hosting-label" x="75" y="70">
            checkout
          </text>
          <rect className="hosting-surface" x="20" y="118" width="110" height="52" rx="7" />
          <text className="hosting-label" x="75" y="150">
            reports
          </text>
          <path className="hosting-route" d="M 130 64 H 192 M 228 64 H 290" />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 130 64 H 192 M 228 64 H 290"
          />
          <circle className="hosting-surface" cx="210" cy="64" r="18" />
          <path className="hosting-ink-accent" d="m 202 64 6 6 11 -12" />
          <text className="hosting-note" x="210" y="104">
            Caller checked
          </text>
          <path className="hosting-route hosting-return" d="M 130 144 H 184" />
          <path className="hosting-ink" d="m 190 138 12 12 m 0 -12 -12 12" />
          <text className="hosting-note" x="262" y="148">
            Not declared
          </text>
          <text className="hosting-note" x="350" y="24">
            payments.internal
          </text>
          <g className="hosting-arrive">
            <rect
              className="hosting-surface hosting-accent"
              x="290"
              y="38"
              width="120"
              height="52"
              rx="7"
            />
            <text className="hosting-label" x="350" y="70">
              payments
            </text>
          </g>
          <text className="hosting-note" x="350" y="110">
            Wakes if parked
          </text>
          <text className="hosting-note" x="210" y="200">
            Declared dependencies, called by name
          </text>
        </>
      )}
      {kind === 'jobs' && (
        <>
          <path className="hosting-grid" d="M 0 177 H 420 M 20 96 H 400" />
          <circle className="hosting-surface" cx="52" cy="96" r="26" />
          <path className="hosting-ink" d="M 52 82 V 96 L 62 103" />
          <path className="hosting-route" d="M 78 96 H 118 M 330 96 H 352" />
          <rect className="hosting-surface" x="118" y="70" width="80" height="52" rx="7" />
          <path className="hosting-ink" d="m 151 89 14 14 m 0 -14 -14 14" />
          <path className="hosting-route" d="M 158 70 C 168 30 280 30 290 70" />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 158 70 C 168 30 280 30 290 70"
          />
          <path className="hosting-ink-accent" d="m 285 63 5 7 5 -7" />
          <text className="hosting-note" x="224" y="28">
            Retry
          </text>
          <g className="hosting-arrive">
            <rect
              className="hosting-surface hosting-accent"
              x="250"
              y="70"
              width="80"
              height="52"
              rx="7"
            />
            <path className="hosting-ink-accent" d="m 281 96 6 6 11 -12" />
            <circle className="hosting-surface hosting-accent" cx="374" cy="96" r="20" />
            <path
              className="hosting-ink-accent"
              d="M 366 90 H 382 M 366 97 H 382 M 366 104 H 376"
            />
          </g>
          <text className="hosting-note" x="52" y="146">
            Schedule
          </text>
          <text className="hosting-note" x="158" y="146">
            Attempt 1
          </text>
          <text className="hosting-note" x="290" y="146">
            Attempt 2
          </text>
          <text className="hosting-note" x="374" y="146">
            Result
          </text>
          <text className="hosting-note" x="210" y="200">
            Timers and attempts tracked for you
          </text>
        </>
      )}
      {kind === 'workflows' && (
        <>
          <path className="hosting-grid" d="M 0 177 H 420" />
          <path className="hosting-route" d="M 92 100 H 118 M 190 100 H 216 M 288 100 H 314" />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 92 100 H 118 M 190 100 H 216 M 288 100 H 314"
          />
          {[20, 118].map((x) => (
            <g key={x}>
              <rect className="hosting-surface" x={x} y="74" width="72" height="52" rx="7" />
              <path className="hosting-ink" d={`m ${x + 27} 100 6 6 11 -12`} />
            </g>
          ))}
          <rect className="hosting-boundary" x="216" y="74" width="72" height="52" rx="7" />
          <path className="hosting-ink" d="M 246 90 V 110 M 258 90 V 110" />
          <path className="hosting-route" d="M 252 30 V 74" />
          <path className="hosting-ink-accent" d="m 247 67 5 7 5 -7" />
          <text className="hosting-note" x="252" y="20">
            Callback
          </text>
          <g className="hosting-arrive">
            <rect
              className="hosting-surface hosting-accent"
              x="314"
              y="74"
              width="72"
              height="52"
              rx="7"
            />
            <path className="hosting-ink-accent" d="M 344 91 L 358 100 L 344 109 Z" />
          </g>
          <text className="hosting-note" x="56" y="150">
            Step 1
          </text>
          <text className="hosting-note" x="154" y="150">
            Step 2
          </text>
          <text className="hosting-note" x="252" y="150">
            Wait
          </text>
          <text className="hosting-note" x="350" y="150">
            Step 3
          </text>
          <text className="hosting-note" x="210" y="200">
            State kept between steps
          </text>
        </>
      )}
      {kind === 'releases' && (
        <>
          <text className="hosting-note" x="82" y="24">
            Current
          </text>
          <rect className="hosting-surface" x="20" y="34" width="124" height="54" rx="7" />
          <text className="hosting-label" x="82" y="60">
            api
          </text>
          <text className="hosting-note" x="82" y="78">
            rev 41
          </text>
          <text className="hosting-note" x="82" y="112">
            New
          </text>
          <rect
            className="hosting-surface hosting-accent"
            x="20"
            y="122"
            width="124"
            height="54"
            rx="7"
          />
          <text className="hosting-label" x="82" y="148">
            api
          </text>
          <text className="hosting-note" x="82" y="166">
            rev 42
          </text>
          <path className="hosting-route hosting-return" d="M 144 61 C 220 61 240 106 296 106" />
          <path className="hosting-route" d="M 144 149 H 204 M 240 149 C 268 149 268 106 296 106" />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 144 149 H 204 M 240 149 C 268 149 268 106 296 106"
          />
          <circle className="hosting-surface" cx="222" cy="149" r="18" />
          <path className="hosting-ink-accent" d="m 214 149 6 6 11 -12" />
          <text className="hosting-note" x="222" y="190">
            Dependency check
          </text>
          <g className="hosting-arrive">
            <rect
              className="hosting-surface hosting-accent"
              x="296"
              y="80"
              width="110"
              height="54"
              rx="7"
            />
            <text className="hosting-label" x="351" y="106">
              billing
            </text>
            <text className="hosting-note" x="351" y="124">
              rev 17
            </text>
          </g>
        </>
      )}
    </svg>
  );
}
