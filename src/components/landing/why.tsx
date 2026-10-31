import { Fragment, useId, useRef, useState, type KeyboardEvent } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import './report-flow.css';

const STAGES = [
  {
    title: 'Request',
    subtitle: 'Your customer',
    application: 'Check who can request the export and which data they may access.',
    platform:
      'Host the endpoint that receives the request. Authorization and data-isolation rules stay in your application.',
  },
  {
    title: 'API',
    subtitle: 'Beta hosting',
    application:
      'Accept the request and hand off the export. Keep the response small while the report is prepared.',
    platform:
      'Run your API in isolated compute and connect it to declared services. Background hand-off uses preview capabilities.',
  },
  {
    title: 'Background work',
    subtitle: 'Preview',
    application:
      'Write the report logic: gather data, call your internal service and prepare the file. Make external effects safe to retry.',
    platform:
      'Queue work, keep attempt history and handle retries within the configured policy. Managed connections reach your internal service.',
  },
  {
    title: 'Result',
    subtitle: 'Your application',
    application:
      'Make the finished report available with your access rules and customer experience.',
    platform:
      'Keep execution history available for inspection. Your application decides how the customer receives the result.',
  },
] as const;

function StageIcon({ index }: { index: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      {index === 0 && (
        <>
          <path d="M5 18V6a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2Z" />
          <path d="M9 8h6M9 12h6M9 16h3" />
        </>
      )}
      {index === 1 && <path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-12-2 14" />}
      {index === 2 && (
        <>
          <path d="M19 7a8 8 0 1 0 1 9M19 3v5h-5" />
          <path d="M12 7v5l3 2" />
        </>
      )}
      {index === 3 && (
        <>
          <path d="M6 3h9l4 4v14H6ZM15 3v5h4" />
          <path d="m9 14 2 2 5-5" />
        </>
      )}
    </svg>
  );
}

export function Why() {
  const id = useId();
  const [active, setActive] = useState(1);
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const reduce = useReducedMotion();
  const stage = STAGES[active];

  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (index + 1) % STAGES.length;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (index + STAGES.length - 1) % STAGES.length;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = STAGES.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setActive(next);
    tabs.current[next]?.focus();
  };

  return (
    <section id="report" className="relative scroll-mt-24 border-t border-border">
      <div className="mx-auto max-w-6xl px-4 pb-12 pt-20 sm:px-6 sm:pb-20 sm:pt-28">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="mb-4 text-sm font-semibold text-brand">One complete feature</p>
            <h2 className="max-w-[30rem] text-balance text-[40px] font-medium leading-[1.05] tracking-[-0.02em] text-foreground sm:text-[52px]">
              A report request is more than an API call.
            </h2>
          </div>
          <p className="max-w-[26rem] text-[15px] leading-relaxed text-muted-foreground sm:text-base">
            Follow an export from the first request to the finished report. Select a step to see
            what stays in your code and what Gregale handles.
          </p>
        </div>
        <div className="report-flow mt-10 lg:mt-12">
          <div role="tablist" aria-label="Report workflow" className="report-stages">
            {STAGES.map((item, index) => (
              <Fragment key={item.title}>
                {index > 0 && (
                  <span className="report-connector" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none">
                      <path d="M2 12h19m-5-5 5 5-5 5" stroke="currentColor" strokeWidth="1.3" />
                    </svg>
                  </span>
                )}
                <button
                  type="button"
                  role="tab"
                  id={`${id}-stage-${index}`}
                  aria-controls={`${id}-detail`}
                  aria-selected={active === index}
                  tabIndex={active === index ? 0 : -1}
                  ref={(element) => {
                    tabs.current[index] = element;
                  }}
                  onClick={() => setActive(index)}
                  onKeyDown={(event) => navigate(event, index)}
                  className="report-stage"
                >
                  <span className="report-stage-icon">
                    <StageIcon index={index} />
                  </span>
                  <span className="report-stage-title">{item.title}</span>{' '}
                  <span className="report-stage-subtitle">{item.subtitle}</span>
                </button>
              </Fragment>
            ))}
          </div>
          <p className="report-flow-note">
            Service connections <span aria-hidden="true">·</span> Background execution{' '}
            <span aria-hidden="true">·</span> Retry policy
          </p>
          <div
            role="tabpanel"
            id={`${id}-detail`}
            aria-labelledby={`${id}-stage-${active}`}
            tabIndex={0}
            className="report-detail"
          >
            <motion.div
              key={active}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className="report-ownership"
            >
              <div>
                <h3>Your application</h3>
                <p>{stage.application}</p>
              </div>
              <div>
                <h3>Gregale</h3>
                <p>{stage.platform}</p>
              </div>
            </motion.div>
          </div>
        </div>
        <p className="mt-6 text-center font-mono text-[11px] leading-relaxed text-muted-foreground">
          Illustrative workflow using beta hosting and preview background-work capabilities.
        </p>
      </div>
    </section>
  );
}
