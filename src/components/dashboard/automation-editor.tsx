import { useEffect, useId, useMemo, useRef, useState, type Ref } from 'react';
import { CheckCircle, Plus, Trash, WarningTriangle } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { FIELD, Select } from '@/components/ui/field';
import { useConfirm } from '@/components/ui/confirm';
import { Timestamp } from '@/components/ui/timestamp';
import { Modal } from '@/components/ui/modal';
import { Panel } from './primitives';
import { ScheduleField } from './schedule-field';
import { useUnsavedGuard } from '@/lib/use-unsaved-guard';
import { useAppRoutes } from '@/lib/api/queries';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useValidateAutomation,
  useSimulateAutomation,
  useWriteAutomation,
  type Automation,
  type Definition,
  type Validation,
  type Simulation,
} from '@/lib/api/automations';
import {
  candidateDefinition,
  definitionDraft,
  newDefinition,
  parseDefinition,
  jsonObject,
  jsonText,
  jsonValue,
  stepKind,
  changeStepKind,
  observedRoutes,
  renameStep,
  AUTOMATION_TEMPLATES,
  type AutomationTemplate,
  type DefinitionDraft,
  type ObservedRoute,
  type StepDraft,
  type StepKind,
} from './automation-definition';

export function JsonReadout({ value }: { value: unknown }) {
  if (value === undefined)
    return <p className="text-xs text-muted-foreground">No value reported.</p>;
  return (
    <pre className="max-h-64 overflow-auto rounded-md border border-border bg-background p-3 font-mono text-xs whitespace-pre-wrap break-all">
      {jsonText(value)}
    </pre>
  );
}

function TextField({
  label,
  value,
  onChange,
  disabled,
  placeholder,
  inputRef,
  list,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  /** Id of a `<datalist>` offering suggestions; free text still works. */
  list?: string;
  hint?: string;
}) {
  const hintId = useId();
  const field = (
    <label className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <input
        ref={inputRef}
        className={FIELD}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        list={list}
        autoComplete={list ? 'off' : undefined}
        aria-describedby={hint ? hintId : undefined}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
  if (!hint) return field;
  return (
    <div className="flex flex-col gap-1.5">
      {field}
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

export function JsonField({
  label,
  value,
  onChange,
  rows = 4,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  rows?: number;
  disabled?: boolean;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label-mono text-muted-foreground">{label}</span>
      <textarea
        className={`${FIELD} h-auto w-full py-2 font-mono text-xs`}
        rows={rows}
        disabled={disabled}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

/**
 * "Runs after" as a checkbox list over the other steps. Names already in the
 * definition that match no step stay listed (checked) so saving never drops
 * them silently; unchecking removes them.
 */
/** The runtime's IANA zones, when it can list them; free text works either way. */
const timeZones: readonly string[] =
  typeof Intl.supportedValuesOf === 'function'
    ? ['UTC', ...Intl.supportedValuesOf('timeZone').filter((zone) => zone !== 'UTC')]
    : [];

function DependencyPicker({
  index,
  value,
  others,
  onChange,
}: {
  index: number;
  value: string[];
  others: string[];
  onChange: (value: string[]) => void;
}) {
  const unknown = value.filter((name) => !others.includes(name));
  const options = [...new Set(others)];
  if (options.length === 0 && unknown.length === 0) return null;
  const toggle = (name: string, checked: boolean) =>
    onChange(checked ? [...value, name] : value.filter((current) => current !== name));
  return (
    <fieldset className="flex flex-col gap-2 sm:col-span-2">
      <legend className="label-mono mb-1.5 text-muted-foreground">
        Runs after (step {index + 1})
      </legend>
      <div className="flex flex-wrap gap-2">
        {options.map((name) => (
          <label
            key={name}
            className="flex items-center gap-2 rounded-md border border-border px-2.5 py-1.5 text-sm has-checked:border-brand/50 has-checked:bg-brand/5"
          >
            <input
              type="checkbox"
              checked={value.includes(name)}
              onChange={(event) => toggle(name, event.target.checked)}
            />
            <span className="font-mono">{name}</span>
          </label>
        ))}
        {unknown.map((name) => (
          <label
            key={`unknown-${name}`}
            className="flex items-center gap-2 rounded-md border border-dashed border-border px-2.5 py-1.5 text-sm"
          >
            <input type="checkbox" checked onChange={() => toggle(name, false)} />
            <span className="font-mono">{name}</span>
            <span className="text-xs text-muted-foreground">not a step in this definition</span>
          </label>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">
        {value.length === 0
          ? 'No dependencies: this step can start as soon as the run starts.'
          : 'This step starts after every checked step succeeds.'}
      </p>
    </fieldset>
  );
}

function StepFields({
  step,
  index,
  onChange,
  onRename,
  onRemove,
  others,
  routes,
}: {
  step: StepDraft;
  index: number;
  onChange: (step: StepDraft) => void;
  onRename: (name: string) => void;
  onRemove: () => void;
  /** Names of the other steps, for the dependency picker. */
  others: string[];
  /** Observed app routes and the `<datalist>` that offers them. */
  routes: { list: string; observed: ObservedRoute[] };
}) {
  const kind = stepKind(step.spec);
  const observed = routes.observed.find((route) => route.path === step.spec.path);
  const patch = (value: Partial<StepDraft['spec']>) =>
    onChange({ ...step, spec: { ...step.spec, ...value } });
  return (
    <fieldset className="rounded-lg border border-border bg-background/40 p-4">
      <legend className="px-1 text-xs text-muted-foreground">Step {index + 1}</legend>
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="font-mono text-sm">{step.spec.name || 'Unnamed step'}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`Remove step ${index + 1}`}
          onClick={onRemove}
        >
          <Trash className="h-4 w-4" />
          Remove
        </Button>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <TextField label="Step name" value={step.spec.name} onChange={onRename} />
        <label className="flex flex-col gap-1.5">
          <span className="label-mono text-muted-foreground">Action</span>
          <Select
            value={kind}
            onChange={(event) =>
              onChange({
                ...step,
                input: '',
                spec: changeStepKind(step.spec, event.target.value as StepKind),
              })
            }
          >
            <option value="path">App handler</option>
            <option value="duration">Wait for duration</option>
            <option value="event">Wait for event</option>
            <option value="callback">Wait for callback</option>
            {kind === 'advanced' && <option value="advanced">Advanced action (edit JSON)</option>}
          </Select>
        </label>
        {kind === 'path' && (
          <>
            <TextField
              label="Handler path"
              value={step.spec.path ?? ''}
              onChange={(path) => patch({ path })}
              placeholder="/process"
              list={routes.observed.length ? routes.list : undefined}
              hint={
                observed
                  ? `Observed as ${observed.methods.join(', ')}.`
                  : routes.observed.length
                    ? 'Choose an observed route or type any path.'
                    : undefined
              }
            />
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">HTTP method</span>
              <Select
                value={step.spec.method ?? 'POST'}
                onChange={(event) =>
                  patch({ method: event.target.value as StepDraft['spec']['method'] })
                }
              >
                {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((method) => (
                  <option key={method}>{method}</option>
                ))}
              </Select>
            </label>
          </>
        )}
        {kind === 'duration' && (
          <TextField
            label="Wait duration"
            value={step.spec.wait_for_duration ?? ''}
            onChange={(wait_for_duration) => patch({ wait_for_duration })}
            placeholder="5m"
          />
        )}
        {kind === 'event' && (
          <TextField
            label="Event name"
            value={step.spec.wait_for_event ?? ''}
            onChange={(wait_for_event) => patch({ wait_for_event })}
          />
        )}
        <DependencyPicker
          index={index}
          value={step.dependencies}
          others={others}
          onChange={(dependencies) => onChange({ ...step, dependencies })}
        />
      </div>
      <details
        className="mt-4 rounded-md border border-border p-3"
        open={Boolean(step.input || step.spec.timeout || step.spec.retry)}
      >
        <summary className="cursor-pointer text-sm text-muted-foreground">
          Advanced step settings
        </summary>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {kind !== 'duration' && (
            <TextField
              label="Timeout"
              value={step.spec.timeout ?? ''}
              onChange={(timeout) => patch({ timeout: timeout || undefined })}
              placeholder="30s"
            />
          )}
          {kind === 'path' && (
            <>
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Maximum attempts</span>
                <input
                  className={FIELD}
                  type="number"
                  min={1}
                  max={25}
                  value={step.spec.retry?.max_attempts ?? 3}
                  onChange={(event) =>
                    patch({
                      retry: { ...step.spec.retry, max_attempts: Number(event.target.value) },
                    })
                  }
                />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="label-mono text-muted-foreground">Retry backoff</span>
                <Select
                  value={step.spec.retry?.backoff ?? 'fixed'}
                  onChange={(event) =>
                    patch({
                      retry: {
                        max_attempts: step.spec.retry?.max_attempts ?? 3,
                        backoff: event.target.value as 'fixed' | 'exponential',
                      },
                    })
                  }
                >
                  <option value="fixed">Fixed</option>
                  <option value="exponential">Exponential</option>
                </Select>
              </label>
            </>
          )}
          {(kind === 'path' || (kind === 'advanced' && !step.spec.wait_for_condition)) && (
            <div className="sm:col-span-2">
              <JsonField
                label="Input mapping (JSON)"
                value={step.input}
                onChange={(input) => onChange({ ...step, input })}
              />
              <p className="mt-1.5 text-xs text-muted-foreground">
                Leave blank to omit input. Templates can reference workflow input and dependency
                outputs.
              </p>
            </div>
          )}
        </div>
      </details>
      {kind === 'advanced' && (
        <div className="sm:col-span-2 text-xs text-muted-foreground">
          This action is preserved. Use Advanced JSON to edit its operation, loop, integration, or
          condition.
        </div>
      )}
    </fieldset>
  );
}

export type SaveOutcome = { published?: boolean; error?: string };

/** Says exactly which writes a publish will make, and what they change. */
function publishConfirmation({
  name,
  isNew,
  saving,
  takeOver,
  version,
  trigger,
}: {
  name: string;
  isNew: boolean;
  saving: boolean;
  takeOver: boolean;
  version: number;
  trigger?: string;
}) {
  const effect = `It becomes the definition for future runs; runs that already started keep their captured definition.${
    trigger === 'schedule'
      ? ' Scheduled starts use it while automatic starts are enabled.'
      : trigger === 'event'
        ? ' Matching events start it while automatic starts are enabled.'
        : ''
  }`;
  if (isNew)
    return {
      title: `Create and publish ${name}?`,
      description: `This saves ${name} as a new draft, then publishes that draft. ${effect}`,
      confirmLabel: 'Create and publish',
    };
  const what = saving
    ? `Your unsaved edits are saved as a new draft over revision ${version}, then published.`
    : `Saved draft revision ${version} is published.`;
  return {
    title: saving ? `Save and publish ${name}?` : `Publish ${name}?`,
    description: takeOver
      ? `This takes ownership from the app manifest. Future deployments will preserve this API publication. ${what}`
      : `${what} ${effect}`,
    confirmLabel: takeOver
      ? 'Take over and publish'
      : saving
        ? 'Save and publish'
        : 'Publish draft',
    typeToConfirm: takeOver ? name : undefined,
  };
}

export function AutomationEditor({
  account,
  slug,
  automation,
  onSaved,
  onReload,
  onClose,
}: {
  account: string;
  slug: string;
  automation?: Automation;
  /** `outcome` reports a publication, or a saved draft whose publication failed. */
  onSaved: (automation: Automation, outcome?: SaveOutcome) => void;
  onReload: () => void;
  /** New definitions can be authored in a dialog; existing drafts stay inline. */
  onClose?: () => void;
}) {
  const initial = automation?.draft ?? newDefinition();
  const [draft, setDraft] = useState(() => definitionDraft(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(definitionDraft(initial)));
  const [version, setVersion] = useState(automation?.version ?? 0);
  const [savedName, setSavedName] = useState(automation?.name ?? '');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reloadRequired, setReloadRequired] = useState(false);
  const [validation, setValidation] = useState<Validation>();
  const [simulation, setSimulation] = useState<Simulation>();
  const [sample, setSample] = useState('{}');
  const [outputs, setOutputs] = useState('{}');
  const [raw, setRaw] = useState('');
  const [rawOpen, setRawOpen] = useState(false);
  const [template, setTemplate] = useState<AutomationTemplate>('handler');
  const confirm = useConfirm();
  const bypassGuard = useRef(false);
  const closing = useRef(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const errorRef = useRef<HTMLParagraphElement>(null);
  const write = useWriteAutomation(account, slug);
  const validate = useValidateAutomation(slug);
  const simulate = useSimulateAutomation(slug);
  const appRoutes = useAppRoutes(slug);
  const timeZoneList = useId();
  const routeList = useId();
  const routes = useMemo(
    () => ({ list: routeList, observed: observedRoutes(appRoutes.data?.routes) }),
    [routeList, appRoutes.data?.routes]
  );
  const [progress, setProgress] = useState<{
    step: 'saving' | 'publishing';
    publish: boolean;
    /** Whether a publish was preceded by a save in the same action. */
    twoStep?: boolean;
  }>();
  const busy = write.isPending || validate.isPending || simulate.isPending || Boolean(progress);
  const inDialog = Boolean(onClose);
  const dirty = JSON.stringify(draft) !== baseline || rawOpen;
  const discardEdits = () =>
    confirm({
      title: 'Discard automation edits?',
      description: 'Your changes have not been saved as a draft.',
      confirmLabel: 'Discard changes',
      destructive: true,
    });
  useUnsavedGuard(dirty || (inDialog && busy), () =>
    bypassGuard.current
      ? Promise.resolve(true)
      : inDialog && busy
        ? Promise.resolve(false)
        : discardEdits()
  );
  useEffect(() => {
    if (!inDialog) return;
    const frame = requestAnimationFrame(() => nameRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [inDialog]);
  useEffect(() => {
    if (inDialog && error) errorRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [inDialog, error]);

  const close = async () => {
    if (!onClose || busy || closing.current) return;
    closing.current = true;
    try {
      if (dirty && !(await discardEdits())) return;
      bypassGuard.current = true;
      onClose();
    } finally {
      closing.current = false;
    }
  };

  const edit = (next: DefinitionDraft) => {
    bypassGuard.current = false;
    setDraft(next);
    setValidation(undefined);
    setSimulation(undefined);
    setMessage('');
    setError('');
  };
  /**
   * `saved` is set when a save-then-publish saved the draft but the publish
   * did not succeed, so the message says what did happen.
   */
  const failure = (err: unknown, saved?: Automation) => {
    const conflict = err instanceof ApiError && err.code === 'automation_version_conflict';
    // A lost write response needs a fresh read before sending another publication.
    const uncertain = !(err instanceof ApiError) || err.isRetryable;
    setReloadRequired(conflict || uncertain);
    const text = conflict
      ? 'Another editor changed this automation. Reload the saved definition before writing again.'
      : uncertain
        ? `The ${saved ? 'publish' : 'write'} outcome is unknown. Reload the saved definition before writing again.`
        : errorMessage(err);
    const message = !saved
      ? text
      : uncertain && !conflict
        ? `Draft revision ${saved.version} was saved. ${text}`
        : `Draft revision ${saved.version} was saved but not published. ${text}`;
    setError(message);
    return message;
  };
  const adopt = (next: Automation) => {
    const model = definitionDraft(next.draft);
    bypassGuard.current = true;
    setDraft(model);
    setBaseline(JSON.stringify(model));
    setVersion(next.version);
    setSavedName(next.name);
    setReloadRequired(false);
    setError('');
    setValidation(undefined);
    setSimulation(undefined);
  };
  const accept = (next: Automation, outcome?: SaveOutcome) => {
    adopt(next);
    onSaved(next, outcome);
  };
  const candidate = () => {
    if (rawOpen) throw new Error('Apply or cancel your Advanced JSON edits first.');
    const definition = candidateDefinition(draft);
    if (!definition.name.trim()) throw new Error('Give this automation a name.');
    if (savedName && definition.name !== savedName)
      throw new Error('An existing automation cannot be renamed.');
    return definition;
  };
  /** Clears old feedback and builds the definition, or reports why it cannot. */
  const prepare = (): Definition | undefined => {
    setError('');
    setMessage('');
    try {
      return candidate();
    } catch (err) {
      setError(errorMessage(err));
    }
  };
  const save = async () => {
    const definition = prepare();
    if (!definition) return;
    setProgress({ step: 'saving', publish: false });
    try {
      accept(
        await write.mutateAsync({
          kind: 'save',
          name: definition.name,
          body: { expected_version: version, definition },
        })
      );
      setMessage('Draft saved. Publish it to change future runs.');
    } catch (err) {
      failure(err);
    } finally {
      setProgress(undefined);
    }
  };
  /**
   * Publish in one action: unsaved edits (or a definition that does not exist
   * yet) are saved first against the observed version, then the revision that
   * save returned is published. Nothing is written before confirmation.
   */
  const publish = async () => {
    const saving = dirty || !savedName;
    const definition = saving ? prepare() : undefined;
    if (saving && !definition) return;
    if (!saving) {
      setError('');
      setMessage('');
    }
    const name = savedName || definition!.name;
    const takeOver = automation?.source === 'manifest';
    if (
      !(await confirm(
        publishConfirmation({
          name,
          isNew: !savedName,
          saving,
          takeOver,
          version,
          trigger: (definition ?? draft.spec).trigger?.type,
        })
      ))
    )
      return;
    let expected = version;
    let saved: Automation | undefined;
    if (definition) {
      setProgress({ step: 'saving', publish: true, twoStep: true });
      try {
        saved = await write.mutateAsync({
          kind: 'save',
          name,
          body: { expected_version: version, definition },
        });
      } catch (err) {
        setProgress(undefined);
        failure(err);
        return;
      }
      adopt(saved);
      expected = saved.version;
    }
    setProgress({ step: 'publishing', publish: true, twoStep: Boolean(saved) });
    try {
      accept(
        await write.mutateAsync({
          kind: 'publish',
          name,
          body: { expected_version: expected, take_over_manifest: takeOver },
        }),
        { published: true }
      );
      setMessage(
        saved ? 'Saved and published for future runs.' : 'Draft published for future runs.'
      );
    } catch (err) {
      const message = failure(err, saved);
      // The draft exists now; a new-automation dialog hands over to its workspace.
      if (saved) onSaved(saved, { error: message });
    } finally {
      setProgress(undefined);
    }
  };
  const reload = async () => {
    if (
      dirty &&
      !(await confirm({
        title: 'Reload saved definition?',
        description: 'Local edits will be discarded.',
        confirmLabel: 'Reload',
        destructive: true,
      }))
    )
      return;
    bypassGuard.current = true;
    onReload();
  };

  const content = (
    <div className="flex flex-col gap-5">
      <Panel
        title={onClose ? 'Definition' : savedName ? 'Draft definition' : 'New automation'}
        description={
          onClose
            ? undefined
            : `App: ${slug} · ${savedName ? `Editing revision ${version}` : 'Save a draft before publishing'}`
        }
      >
        <fieldset disabled={busy} className="flex min-w-0 flex-col gap-5">
          {inDialog && !savedName && (
            <div>
              <p className="mb-2 text-xs text-muted-foreground">
                Start with a template, then customize your handlers.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                {AUTOMATION_TEMPLATES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    aria-pressed={template === item.id}
                    className="rounded-lg border border-border bg-background/40 p-3 text-left transition-colors hover:border-brand/50 aria-pressed:border-brand/50 aria-pressed:bg-brand/5"
                    onClick={async () => {
                      if (item.id === template) return;
                      if (
                        dirty &&
                        !(await confirm({
                          title: 'Replace the current steps?',
                          description:
                            'This template replaces the trigger and steps. Your automation name will be kept.',
                          confirmLabel: 'Use template',
                        }))
                      )
                        return;
                      const definition = newDefinition(item.id);
                      edit(definitionDraft({ ...definition, name: draft.spec.name }));
                      setTemplate(item.id);
                      setRawOpen(false);
                    }}
                  >
                    <span className="block text-sm font-medium">{item.title}</span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {item.description}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            <TextField
              label="Automation name"
              inputRef={nameRef}
              value={draft.spec.name}
              disabled={Boolean(savedName)}
              placeholder="process-order"
              onChange={(name) => edit({ ...draft, spec: { ...draft.spec, name } })}
            />
            <label className="flex flex-col gap-1.5">
              <span className="label-mono text-muted-foreground">Start trigger</span>
              <Select
                value={draft.spec.trigger?.type ?? 'manual'}
                onChange={(event) => {
                  const type = event.target.value as 'manual' | 'schedule' | 'event';
                  edit({
                    ...draft,
                    spec: {
                      ...draft.spec,
                      trigger:
                        type === 'schedule'
                          ? { type, schedule: '0 * * * *', timezone: 'UTC', overlap: 'skip' }
                          : type === 'event'
                            ? { type, source: '', event_type: '' }
                            : { type },
                    },
                  });
                }}
              >
                <option value="manual">Manual</option>
                <option value="schedule">Scheduled</option>
                <option value="event">Event</option>
              </Select>
            </label>
            {draft.spec.trigger?.type === 'schedule' && (
              <>
                <ScheduleField
                  value={draft.spec.trigger.schedule ?? ''}
                  timezone={draft.spec.trigger.timezone ?? 'UTC'}
                  onChange={(schedule) =>
                    edit({
                      ...draft,
                      spec: { ...draft.spec, trigger: { ...draft.spec.trigger!, schedule } },
                    })
                  }
                />
                <div className="flex flex-col gap-1.5">
                  <TextField
                    label="Timezone"
                    value={draft.spec.trigger.timezone ?? 'UTC'}
                    list={timeZones.length ? timeZoneList : undefined}
                    hint="IANA name, such as Europe/Istanbul. The schedule runs in this zone."
                    onChange={(timezone) =>
                      edit({
                        ...draft,
                        spec: { ...draft.spec, trigger: { ...draft.spec.trigger!, timezone } },
                      })
                    }
                  />
                  {timeZones.length > 0 && (
                    <datalist id={timeZoneList}>
                      {timeZones.map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                  )}
                </div>
                <details
                  className="rounded-md border border-border p-3 sm:col-span-2"
                  open={draft.spec.trigger.overlap === 'allow' || draft.scheduledInput !== 'null'}
                >
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Advanced trigger settings
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <label className="flex flex-col gap-1.5">
                      <span className="label-mono text-muted-foreground">Overlapping runs</span>
                      <Select
                        value={draft.spec.trigger.overlap ?? 'skip'}
                        onChange={(event) =>
                          edit({
                            ...draft,
                            spec: {
                              ...draft.spec,
                              trigger: {
                                ...draft.spec.trigger!,
                                overlap: event.target.value as 'skip' | 'allow',
                              },
                            },
                          })
                        }
                      >
                        <option value="skip">Skip while active</option>
                        <option value="allow">Allow overlap</option>
                      </Select>
                    </label>
                    <JsonField
                      label="Scheduled input (JSON)"
                      value={draft.scheduledInput}
                      onChange={(scheduledInput) => edit({ ...draft, scheduledInput })}
                    />
                  </div>
                </details>
              </>
            )}
            {draft.spec.trigger?.type === 'event' && (
              <>
                <TextField
                  label="Event source"
                  value={draft.spec.trigger.source ?? ''}
                  onChange={(source) =>
                    edit({
                      ...draft,
                      spec: { ...draft.spec, trigger: { ...draft.spec.trigger!, source } },
                    })
                  }
                />
                <TextField
                  label="Event type"
                  value={draft.spec.trigger.event_type ?? ''}
                  onChange={(event_type) =>
                    edit({
                      ...draft,
                      spec: { ...draft.spec, trigger: { ...draft.spec.trigger!, event_type } },
                    })
                  }
                />
                <details
                  className="rounded-md border border-border p-3 sm:col-span-2"
                  open={draft.eventFilter !== '{}'}
                >
                  <summary className="cursor-pointer text-sm text-muted-foreground">
                    Advanced event filter
                  </summary>
                  <div className="mt-4">
                    <JsonField
                      label="Event filter (JSON)"
                      value={draft.eventFilter}
                      onChange={(eventFilter) => edit({ ...draft, eventFilter })}
                    />
                  </div>
                </details>
              </>
            )}
          </div>
          <div className="flex items-center justify-between gap-3">
            <h3 className="text-sm font-medium">Steps</h3>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const name = `step-${draft.steps.length + 1}`;
                edit({
                  ...draft,
                  steps: [
                    ...draft.steps,
                    { spec: { name, path: '/', method: 'POST' }, input: '', dependencies: [] },
                  ],
                });
              }}
            >
              <Plus className="h-4 w-4" />
              Add step
            </Button>
          </div>
          {draft.steps.length === 0 && (
            <p className="text-sm text-muted-foreground">Add at least one step before saving.</p>
          )}
          {draft.steps.map((step, index) => (
            <StepFields
              key={index}
              step={step}
              index={index}
              others={draft.steps
                .filter((_, i) => i !== index)
                .map((other) => other.spec.name)
                .filter(Boolean)}
              routes={routes}
              onRename={(name) => edit({ ...draft, steps: renameStep(draft.steps, index, name) })}
              onChange={(next) =>
                edit({
                  ...draft,
                  steps: draft.steps.map((current, i) => (i === index ? next : current)),
                })
              }
              onRemove={() => edit({ ...draft, steps: draft.steps.filter((_, i) => i !== index) })}
            />
          ))}
          {routes.observed.length > 0 && (
            <datalist id={routes.list}>
              {routes.observed.map((route) => (
                <option key={route.path} value={route.path}>
                  {route.methods.join(', ')}
                </option>
              ))}
            </datalist>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {!onClose && (
              <>
                <Button
                  size="sm"
                  disabled={!savedName || reloadRequired}
                  onClick={() => void publish()}
                >
                  {progress?.publish
                    ? progress.step === 'saving'
                      ? 'Saving draft…'
                      : 'Publishing…'
                    : dirty
                      ? 'Save and publish'
                      : 'Publish draft'}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={reloadRequired || (!dirty && Boolean(savedName))}
                  onClick={() => void save()}
                >
                  {progress && !progress.publish ? 'Saving…' : 'Save draft'}
                </Button>
              </>
            )}
            <div className="flex flex-wrap gap-2 sm:ml-auto">
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  setError('');
                  setMessage('');
                  try {
                    setValidation(await validate.mutateAsync(candidate()));
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                Validate definition
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  try {
                    bypassGuard.current = false;
                    setRaw(jsonText(candidate()));
                    setRawOpen(true);
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                Advanced JSON
              </Button>
            </div>
          </div>
        </fieldset>
        {rawOpen && (
          <div className="mt-5 flex flex-col gap-3">
            <JsonField
              label="Full definition (JSON)"
              value={raw}
              onChange={(value) => {
                bypassGuard.current = false;
                setRaw(value);
              }}
              rows={14}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => {
                  try {
                    const spec = parseDefinition(raw);
                    if (savedName && spec.name !== savedName)
                      throw new Error('An existing automation cannot be renamed.');
                    edit(definitionDraft(spec));
                    setRawOpen(false);
                  } catch (err) {
                    setError(errorMessage(err));
                  }
                }}
              >
                Apply JSON
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setRawOpen(false)}>
                Cancel JSON edits
              </Button>
            </div>
          </div>
        )}
        {progress?.publish && (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            {progress.step === 'saving'
              ? 'Step 1 of 2: saving the draft…'
              : progress.twoStep
                ? 'Step 2 of 2: publishing…'
                : 'Publishing the saved draft…'}
          </p>
        )}
        {error && (
          <p
            ref={errorRef}
            role="alert"
            className="mt-4 flex items-start gap-2 text-sm"
            style={{ color: 'var(--status-critical)' }}
          >
            <WarningTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mt-4 flex items-center gap-2 text-sm text-brand">
            <CheckCircle className="h-4 w-4" />
            {message}
          </p>
        )}
        {savedName && (
          <Button
            size="sm"
            variant="ghost"
            className="mt-3"
            disabled={busy}
            onClick={() => void reload()}
          >
            Reload saved definition
          </Button>
        )}
        {validation && (
          <div role="status" className="mt-4 rounded-lg border border-border p-4">
            <p className="flex items-center gap-2 text-sm font-medium">
              {validation.valid ? (
                <CheckCircle className="h-4 w-4 text-brand" />
              ) : (
                <WarningTriangle className="h-4 w-4" />
              )}
              {validation.valid ? 'Definition is valid' : 'Definition needs changes'}
            </p>
            {validation.issues.map((issue, i) => (
              <p key={i} className="mt-2 text-sm">
                {issue}
              </p>
            ))}
            {validation.step_order.length > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                Execution order: {validation.step_order.join(' → ')}
              </p>
            )}
            {validation.next_fire_at && (
              <p className="mt-2 text-xs text-muted-foreground">
                Next scheduled start: <Timestamp value={validation.next_fire_at} />
              </p>
            )}
          </div>
        )}
      </Panel>
      <details className="rounded-lg border border-border p-4">
        <summary className="cursor-pointer text-sm font-medium">Simulate with sample data</summary>
        <div className="mt-4">
          <Panel description="Test data flow with hypothetical handler outputs. Simulation does not invoke the app or create a run.">
            <div className="grid gap-4 sm:grid-cols-2">
              <JsonField
                disabled={busy}
                label="Sample input (JSON)"
                value={sample}
                onChange={(value) => {
                  setSample(value);
                  setSimulation(undefined);
                }}
              />
              <JsonField
                disabled={busy}
                label="Mock outputs by step (JSON)"
                value={outputs}
                onChange={(value) => {
                  setOutputs(value);
                  setSimulation(undefined);
                }}
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-4"
              disabled={busy || rawOpen}
              onClick={async () => {
                setError('');
                try {
                  setSimulation(
                    await simulate.mutateAsync({
                      definition: candidate(),
                      input: jsonValue(sample, 'Sample input'),
                      mock_outputs: jsonObject(outputs, 'Mock outputs'),
                    })
                  );
                } catch (err) {
                  setError(errorMessage(err));
                }
              }}
            >
              Simulate definition
            </Button>
            {simulation && (
              <div className="mt-4 flex flex-col gap-3" role="status">
                <p className="flex items-center gap-2 text-sm font-medium">
                  {simulation.definition_valid && simulation.complete ? (
                    <CheckCircle className="h-4 w-4 text-brand" />
                  ) : (
                    <WarningTriangle className="h-4 w-4" />
                  )}
                  {!simulation.definition_valid
                    ? 'Definition needs changes'
                    : simulation.complete
                      ? 'Simulation complete'
                      : 'Partial simulation — some outcomes remain unresolved'}
                </p>
                {[...simulation.issues, ...simulation.warnings].map((issue, i) => (
                  <p key={i} className="text-xs text-muted-foreground">
                    {issue}
                  </p>
                ))}
                {simulation.trace.map((step, i) => (
                  <details key={i} className="rounded-md border border-border p-3">
                    <summary className="cursor-pointer text-sm">
                      <span className="font-mono">{step.step_name}</span> ·{' '}
                      {step.state.replaceAll('_', ' ')}
                      {step.reason && ` · ${step.reason}`}
                    </summary>
                    <div className="mt-3">
                      <JsonReadout value={step} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </Panel>
        </div>
      </details>
    </div>
  );

  if (!onClose) return content;
  return (
    <Modal
      open
      onClose={() => void close()}
      title="New automation"
      description={`App: ${slug} · Publish now, or save a draft to publish later.`}
      width="max-w-3xl"
      footer={
        <>
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => void close()}>
            Cancel
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy || reloadRequired || rawOpen}
            onClick={() => void save()}
          >
            {progress && !progress.publish ? 'Saving…' : 'Save as draft'}
          </Button>
          <Button
            size="sm"
            disabled={busy || reloadRequired || rawOpen}
            onClick={() => void publish()}
          >
            {progress?.publish
              ? progress.step === 'saving'
                ? 'Saving draft…'
                : 'Publishing…'
              : 'Create and publish'}
          </Button>
        </>
      }
    >
      <div className="max-h-[calc(100dvh-14rem)] overflow-y-auto pr-1">{content}</div>
    </Modal>
  );
}
