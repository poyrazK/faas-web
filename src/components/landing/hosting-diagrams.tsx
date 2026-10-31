export type HostingDiagramKind =
  'compute' | 'scale' | 'domain' | 'trace' | 'secrets' | 'previews' | 'objects';

/** Explanatory schematics, not live infrastructure, measured timings or customer data. */
export function HostingDiagram({ kind }: { kind: HostingDiagramKind }) {
  return (
    <svg viewBox="0 0 420 210" fill="none" aria-hidden="true" className="hosting-diagram">
      {kind === 'previews' && (
        <>
          <path className="hosting-grid" d="M 16 62 H 416 M 16 146 H 416" />
          <path className="hosting-route" d="M 40 62 H 381" />
          <path className="hosting-route" d="M 104 62 C 143 62 131 146 181 146 H 282" />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 104 62 C 143 62 131 146 181 146 H 282"
          />
          {[40, 104, 238, 381].map((x) => (
            <circle key={x} className="hosting-surface" cx={x} cy="62" r="6" />
          ))}
          <text className="hosting-note" x="70" y="36">
            Main
          </text>
          <text className="hosting-note" x="349" y="36">
            Unchanged
          </text>
          <circle className="hosting-surface hosting-accent" cx="193" cy="146" r="6" />
          <text className="hosting-label" x="193" y="125">
            PR
          </text>
          <g className="hosting-arrive">
            <rect
              className="hosting-surface hosting-accent"
              x="282"
              y="110"
              width="130"
              height="72"
              rx="7"
            />
            <path className="hosting-route" d="M 282 128 H 412" />
            <circle className="hosting-secret-mask" cx="294" cy="119" r="2" />
            <text className="hosting-label" x="347" y="159">
              Preview
            </text>
          </g>
        </>
      )}
      {kind === 'objects' && (
        <>
          <path className="hosting-grid" d="M 0 170 H 420" />
          {[20, 54, 88].map((x, index) => (
            <g key={x} transform={`translate(${x} ${56 + index * 12})`}>
              <path className="hosting-surface" d="M 0 0 H 29 L 43 14 V 58 H 0 Z" />
              <path className="hosting-route" d="M 29 0 V 14 H 43 M 10 30 H 33 M 10 39 H 27" />
            </g>
          ))}
          <path className="hosting-route" d="M 148 107 H 294" />
          <path className="hosting-signal hosting-draw" pathLength="1" d="M 148 107 H 294" />
          <path className="hosting-ink-accent" d="m 280 102 5 5 -5 5" />
          <path
            className="hosting-surface hosting-accent"
            d="M 294 61 V 145 C 294 165 404 165 404 145 V 61 Z"
          />
          <ellipse className="hosting-surface hosting-accent" cx="349" cy="61" rx="55" ry="15" />
          <g className="hosting-arrive">
            <rect className="hosting-surface" x="315" y="87" width="27" height="34" rx="3" />
            <rect className="hosting-surface" x="350" y="104" width="27" height="34" rx="3" />
            <path
              className="hosting-ink-accent"
              d="M 322 99 H 335 M 322 106 H 332 M 357 116 H 370 M 357 123 H 367"
            />
          </g>
          <text className="hosting-note" x="76" y="195">
            Files
          </text>
          <text className="hosting-note" x="220" y="85">
            Upload
          </text>
          <text className="hosting-note" x="349" y="195">
            Private bucket
          </text>
        </>
      )}
      {kind === 'compute' && (
        <>
          <path className="hosting-grid" d="M 210 15 V 195 M 0 177 H 420" />
          {[20, 238].map((x, index) => (
            <g key={x}>
              <rect
                className="hosting-boundary hosting-draw"
                x={x}
                y="24"
                width="162"
                height="151"
                rx="12"
              />
              <text className="hosting-note" x={x + 81} y="49">
                microVM
              </text>
              <rect
                className={index === 0 ? 'hosting-surface hosting-accent' : 'hosting-surface'}
                x={x + 28}
                y="67"
                width="106"
                height="80"
                rx="7"
              />
              <path
                className={index === 0 ? 'hosting-ink-accent' : 'hosting-ink'}
                d={`m ${x + 68} 83 -8 8 8 8 M ${x + 94} 83 l 8 8 -8 8 M ${x + 85} 80 l -8 22`}
              />
              <text className="hosting-label" x={x + 81} y="129">
                {index === 0 ? 'Your app' : 'Other app'}
              </text>
            </g>
          ))}
          <text className="hosting-note" x="210" y="200">
            Separate runtime boundaries
          </text>
        </>
      )}
      {kind === 'scale' && (
        <>
          <path className="hosting-grid" d="M 30 114 H 390 M 210 16 V 126" />
          <path
            className="hosting-route"
            d="M 87 95 C 131 95 137 45 191 45 M 229 45 C 279 45 281 95 333 95"
          />
          <path
            className="hosting-signal hosting-draw"
            pathLength="1"
            d="M 87 95 C 131 95 137 45 191 45 M 229 45 C 279 45 281 95 333 95"
          />
          <circle className="hosting-surface" cx="60" cy="95" r="27" />
          <path className="hosting-ink" d="M 64 79 a 16 16 0 1 0 12 25 a 16 16 0 0 1 -12 -25 Z" />
          <circle className="hosting-surface" cx="210" cy="45" r="19" />
          <path className="hosting-ink-accent" d="M 201 45 h 18 m -6 -6 6 6 -6 6" />
          <circle
            className="hosting-surface hosting-accent hosting-arrive"
            cx="360"
            cy="95"
            r="27"
          />
          <path className="hosting-ink-accent" d="M 360 78 V 94 M 349 83 a 17 17 0 1 0 22 0" />
          <text className="hosting-label" x="60" y="144">
            Parked
          </text>
          <text className="hosting-label" x="210" y="94">
            Request
          </text>
          <text className="hosting-label" x="360" y="144">
            Awake
          </text>
          <path
            className="hosting-route hosting-return"
            d="M 360 161 V 172 Q 360 184 348 184 H 72 Q 60 184 60 172 V 161 m -4 5 4 -5 4 5"
          />
        </>
      )}
      {kind === 'domain' && (
        <>
          <path className="hosting-grid" d="M 0 106 H 420" />
          <rect className="hosting-surface" x="4" y="77" width="180" height="58" rx="8" />
          <text className="hosting-domain-name" x="94" y="111">
            api.example.com
          </text>
          <path className="hosting-route" d="M 184 106 H 326" />
          <path className="hosting-signal hosting-draw" pathLength="1" d="M 184 106 H 326" />
          <circle className="hosting-surface hosting-accent" cx="252" cy="106" r="20" />
          <path className="hosting-ink-accent hosting-arrive" d="m 244 106 5 5 10 -11" />
          <path className="hosting-route" d="M 252 80 V 62" />
          <text className="hosting-note" x="252" y="49">
            DNS
          </text>
          <rect
            className="hosting-surface hosting-accent"
            x="326"
            y="67"
            width="90"
            height="78"
            rx="9"
          />
          <path
            className="hosting-ink-accent"
            d="M 360 86 h 22 v 18 h -22 Z M 363 90 h 3 m 3 0 h 3"
          />
          <text className="hosting-label" x="371" y="130">
            App
          </text>
          <text className="hosting-note" x="94" y="181">
            Your domain
          </text>
          <text className="hosting-note" x="252" y="181">
            Verified
          </text>
          <text className="hosting-note" x="371" y="181">
            Route
          </text>
        </>
      )}
      {kind === 'trace' && (
        <>
          <path
            className="hosting-grid"
            d="M 24 12 V 195 M 148 12 V 195 M 272 12 V 195 M 396 12 V 195"
          />
          <path className="hosting-route" d="M 38 52 V 107 H 75 M 88 107 V 162 H 135" />
          <g className="hosting-span hosting-span-first">
            <rect className="hosting-surface" x="24" y="27" width="372" height="37" rx="5" />
            <text className="hosting-span-label" x="38" y="51">
              Request
            </text>
          </g>
          <g className="hosting-span hosting-span-second">
            <rect className="hosting-surface" x="75" y="89" width="266" height="37" rx="5" />
            <text className="hosting-span-label" x="89" y="113">
              Handler
            </text>
          </g>
          <g className="hosting-span hosting-span-third">
            <rect
              className="hosting-surface hosting-accent"
              x="135"
              y="144"
              width="161"
              height="37"
              rx="5"
            />
            <text className="hosting-span-label" x="149" y="168">
              Dependency
            </text>
          </g>
        </>
      )}
      {kind === 'secrets' && (
        <>
          <path className="hosting-grid" d="M 0 180 H 420" />
          <rect className="hosting-surface" x="4" y="42" width="196" height="122" rx="8" />
          <path className="hosting-route" d="M 4 78 H 200" />
          <text className="hosting-note" x="102" y="66">
            Environment
          </text>
          <text className="hosting-secret-key" x="18" y="112">
            KEY
          </text>
          <text className="hosting-secret-key" x="18" y="143">
            TOKEN
          </text>
          <g className="hosting-secret-mask">
            {[105, 122, 139, 156, 173].map((x) => (
              <g key={x}>
                <circle cx={x} cy="106" r="3" />
                <circle cx={x} cy="137" r="3" />
              </g>
            ))}
          </g>
          <path className="hosting-route" d="M 200 106 H 294" />
          <path className="hosting-signal hosting-draw" pathLength="1" d="M 200 106 H 294" />
          <path className="hosting-ink-accent" d="m 279 101 5 5 -5 5" />
          <rect className="hosting-boundary" x="294" y="26" width="122" height="152" rx="12" />
          <text className="hosting-note" x="355" y="53">
            Runtime
          </text>
          <rect
            className="hosting-surface hosting-accent"
            x="312"
            y="75"
            width="86"
            height="67"
            rx="6"
          />
          <path
            className="hosting-ink-accent hosting-arrive"
            d="M 343 88 h -5 v 12 l -4 4 4 4 v 12 h 5 M 367 88 h 5 v 12 l 4 4 -4 4 v 12 h -5"
          />
          <text className="hosting-note" x="102" y="199">
            Sealed values
          </text>
          <text className="hosting-note" x="355" y="199">
            Injected
          </text>
        </>
      )}
    </svg>
  );
}
