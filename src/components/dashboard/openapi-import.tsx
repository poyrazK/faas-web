import { useState } from 'react';
import { Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm';
import { FieldError, Select, Textarea } from '@/components/ui/field';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { PlanGated } from '@/components/dashboard/plan-gated';
import { Pill } from '@/components/dashboard/resource-table';
import { ApiError, errorMessage } from '@/lib/api/errors';
import {
  useAppEdgeRules,
  useAppDeployments,
  useAppOpenAPI,
  useCreateEdgeRule,
  useDeleteAppOpenAPI,
  useDeploymentOpenAPIDoc,
  useDryRunAppOpenAPI,
  useImportAppOpenAPI,
  type EdgeRuleSuggestion,
  type OpenAPIDocument,
} from '@/lib/api/queries';

/**
 * OpenAPI import (ADR-126) and per-deployment discovery (ADR-122).
 *
 * The import is preview-then-confirm because the API makes that possible:
 * `dry-run` validates the document and lists the edge rules it would
 * suggest without persisting anything, so the customer sees exactly what
 * the import means before it lands. Only then does `POST /openapi` store the
 * document, and the suggestions are turned into edge rules one by one through
 * the ordinary create-edge-rule endpoint, ticked or not by the customer.
 *
 * `manual_import` is the customer's own document; a 404 there is "nothing
 * imported", not a fault. `auto` is the platform's merged view (import ∪
 * observed routes ∪ edge rules) and always answers. The per-deployment
 * document is what the cold-boot probe captured from the running app; Free
 * answers `402 openapi_docs_not_allowed`, so that section uses the plan panel.
 *
 * Import limits are abuse caps, not plan tiers (256 KiB, 50 endpoints); each
 * has its own code and its own sentence.
 */

type Parsed = { doc: OpenAPIDocument; error?: undefined } | { doc?: undefined; error: string };

/** A pasted document has to be JSON with the three keys the API requires. */
export function parseOpenAPIDocument(text: string): Parsed {
  const trimmed = text.trim();
  if (!trimmed) return { error: 'Paste an OpenAPI 3.0 or 3.1 document as JSON.' };
  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { error: 'That is not valid JSON. YAML documents need converting to JSON first.' };
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return { error: 'The document must be a JSON object.' };
  const doc = value as Record<string, unknown>;
  if (typeof doc.openapi !== 'string')
    return { error: 'Missing the top-level "openapi" version string.' };
  if (typeof doc.info !== 'object' || doc.info === null)
    return { error: 'Missing the top-level "info" object.' };
  if (typeof doc.paths !== 'object' || doc.paths === null)
    return { error: 'Missing the top-level "paths" object.' };
  return { doc: doc as unknown as OpenAPIDocument };
}

function explainImportError(err: unknown): {
  kind: 'info' | 'error';
  title: string;
  description?: string;
} {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'openapi_import_invalid':
        return {
          kind: 'error',
          title: 'Not a valid OpenAPI document',
          description: errorMessage(err),
        };
      case 'openapi_import_too_many_endpoints':
        return { kind: 'error', title: 'Too many endpoints', description: errorMessage(err) };
      case 'openapi_import_too_large':
        return { kind: 'error', title: 'Document too large', description: errorMessage(err) };
      case 'openapi_import_quota_reached':
        return { kind: 'info', title: 'Import limit reached', description: errorMessage(err) };
      case 'empty_body':
        return { kind: 'error', title: 'Nothing to import' };
    }
  }
  return { kind: 'error', title: 'Could not process the document', description: errorMessage(err) };
}

function isNotFound(error: unknown): boolean {
  return error instanceof ApiError && error.code === 'not_found';
}

function countPaths(doc: unknown): number {
  const paths = (doc as { paths?: unknown } | null)?.paths;
  return typeof paths === 'object' && paths !== null ? Object.keys(paths).length : 0;
}

function DocumentView({ doc }: { doc: unknown }) {
  return (
    <details className="text-xs">
      <summary className="cursor-pointer text-muted-foreground">Show document</summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-md bg-muted p-3 font-mono">
        {JSON.stringify(doc, null, 2)}
      </pre>
    </details>
  );
}

export function OpenAPIImport({ slug }: { slug: string }) {
  return (
    <div className="flex flex-col gap-6">
      <ImportedDocument slug={slug} />
      <ImportFlow slug={slug} />
      <DeploymentDocument slug={slug} />
    </div>
  );
}

function ImportedDocument({ slug }: { slug: string }) {
  const { toast } = useToast();
  const confirm = useConfirm();
  const [source, setSource] = useState<'manual_import' | 'auto'>('manual_import');
  const manual = useAppOpenAPI(slug, 'manual_import');
  const auto = useAppOpenAPI(slug, source === 'auto' ? 'auto' : 'manual_import');
  const remove = useDeleteAppOpenAPI(slug);
  const imported = manual.data;
  const nothingImported = manual.error !== null && isNotFound(manual.error);

  const onDelete = async () => {
    if (
      !(await confirm({
        title: 'Delete the imported document?',
        description:
          'The platform-merged view falls back to observed routes and edge rules. Existing edge rules are kept.',
        confirmLabel: 'Delete',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync();
      toast({ kind: 'success', title: 'Imported document deleted' });
    } catch (err) {
      toast({ kind: 'error', title: 'Could not delete', description: errorMessage(err) });
    }
  };

  return (
    <Panel
      title="Imported document"
      description="Your own description of the API, kept verbatim. The platform merges it with observed routes and edge rules."
      actions={
        <div className="flex items-center gap-2">
          <Select
            value={source}
            onChange={(e) => setSource(e.target.value as 'manual_import' | 'auto')}
            aria-label="Document source"
            className="h-8 text-xs"
          >
            <option value="manual_import">As imported</option>
            <option value="auto">Platform-merged</option>
          </Select>
          {imported && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void onDelete()}
              disabled={remove.isPending}
            >
              <Trash className="h-3.5 w-3.5" />
              Delete
            </Button>
          )}
        </div>
      }
    >
      {manual.isPending ? (
        <p className="text-sm text-muted-foreground">Reading the imported document…</p>
      ) : nothingImported && source === 'manual_import' ? (
        <p className="text-sm text-muted-foreground">
          No document has been imported for this app. Paste one below to preview what it would
          change.
        </p>
      ) : manual.error && source === 'manual_import' ? (
        <p className="text-sm text-muted-foreground">{errorMessage(manual.error)}</p>
      ) : source === 'auto' ? (
        auto.isPending ? (
          <p className="text-sm text-muted-foreground">Merging routes and edge rules…</p>
        ) : auto.error ? (
          <p className="text-sm text-muted-foreground">{errorMessage(auto.error)}</p>
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {countPaths(auto.data)} paths after merging the import with observed routes and edge
              rules.
            </p>
            <DocumentView doc={auto.data} />
          </div>
        )
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Pill
              label={`OpenAPI ${String((imported as { openapi?: unknown })?.openapi ?? '')}`}
              color="var(--status-good)"
            />
            <span className="text-muted-foreground">{countPaths(imported)} paths</span>
          </div>
          <DocumentView doc={imported} />
        </div>
      )}
    </Panel>
  );
}

function ImportFlow({ slug }: { slug: string }) {
  const { toast } = useToast();
  const [text, setText] = useState('');
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<{
    doc: OpenAPIDocument;
    version: string;
    endpoints: number;
    suggestions: EdgeRuleSuggestion[];
  } | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const dryRun = useDryRunAppOpenAPI(slug);
  const importDoc = useImportAppOpenAPI(slug);
  const createRule = useCreateEdgeRule();
  const rules = useAppEdgeRules(slug);
  const parsed = parseOpenAPIDocument(text);

  const onPreview = async () => {
    setTouched(true);
    if (!parsed.doc) return;
    try {
      const result = await dryRun.mutateAsync(parsed.doc);
      setPreview({
        doc: parsed.doc,
        version: result.openapi_version,
        endpoints: result.endpoint_count,
        suggestions: result.suggestions,
      });
      setSelected(new Set(result.suggestions.map((_, i) => i)));
    } catch (err) {
      toast(explainImportError(err));
    }
  };

  const onImport = async () => {
    if (!preview) return;
    try {
      const stored = await importDoc.mutateAsync(preview.doc);
      const chosen = preview.suggestions.filter((_, i) => selected.has(i));
      let created = 0;
      let priority = rules.data?.length ? Math.max(...rules.data.map((r) => r.priority)) + 10 : 10;
      const failures: string[] = [];
      for (const s of chosen) {
        try {
          await createRule.mutateAsync({
            slug,
            match_host: '*',
            match_path: s.path,
            match_methods: s.methods.map((m) => m.toUpperCase()),
            priority,
            enabled: true,
            kind: s.kind,
            validate_mode:
              typeof s.action.validate_mode === 'string' &&
              ['block', 'observe', 'warn'].includes(s.action.validate_mode)
                ? (s.action.validate_mode as 'block' | 'observe' | 'warn')
                : 'observe',
            action: s.action as never,
          });
          created += 1;
          priority += 10;
        } catch (err) {
          failures.push(`${s.path}: ${errorMessage(err)}`);
        }
      }
      toast({
        kind: failures.length ? 'info' : 'success',
        title: `Imported ${stored.endpoint_count} endpoints`,
        description:
          chosen.length === 0
            ? 'No edge rules were created.'
            : failures.length
              ? `${created} of ${chosen.length} edge rules created. ${failures.join(' ')}`
              : `${created} edge rule${created === 1 ? '' : 's'} created.`,
      });
      setPreview(null);
      setText('');
      setTouched(false);
    } catch (err) {
      toast(explainImportError(err));
    }
  };

  return (
    <Panel
      title="Import a document"
      description="Preview first: the API validates the document and lists the edge rules it would suggest, without storing anything."
    >
      <div className="flex flex-col gap-4">
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted-foreground">OpenAPI 3.0 / 3.1 document (JSON)</span>
          <Textarea
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setPreview(null);
            }}
            onBlur={() => setTouched(true)}
            placeholder='{"openapi":"3.1.0","info":{"title":"api","version":"1.0.0"},"paths":{}}'
            className="min-h-40 font-mono text-xs"
            aria-invalid={(touched && !!parsed.error) || undefined}
            aria-describedby={touched && parsed.error ? 'openapi-doc-error' : undefined}
          />
          {touched && parsed.error && (
            <FieldError id="openapi-doc-error">{parsed.error}</FieldError>
          )}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void onPreview()}
            disabled={!text.trim()}
            busy={dryRun.isPending}
          >
            Preview
          </Button>
          {preview && (
            <Button
              size="sm"
              onClick={() => void onImport()}
              busy={importDoc.isPending || createRule.isPending}
            >
              Import document
              {selected.size > 0
                ? ` and create ${selected.size} edge rule${selected.size === 1 ? '' : 's'}`
                : ''}
            </Button>
          )}
        </div>

        {preview && (
          <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
            <p className="text-sm">
              OpenAPI {preview.version}, {preview.endpoints} endpoint
              {preview.endpoints === 1 ? '' : 's'}.{' '}
              {preview.suggestions.length === 0
                ? 'Every endpoint is already covered by a validate rule; nothing to suggest.'
                : `${preview.suggestions.length} suggested edge rule${preview.suggestions.length === 1 ? '' : 's'} for endpoints no validate rule covers yet.`}
            </p>
            {preview.suggestions.length > 0 && (
              <ul className="flex flex-col divide-y divide-border">
                {preview.suggestions.map((s, i) => (
                  <li
                    key={`${s.path}-${i}`}
                    className="flex flex-wrap items-center gap-3 py-2 first:pt-0 last:pb-0"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(i)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) next.add(i);
                        else next.delete(i);
                        setSelected(next);
                      }}
                      aria-label={`Create ${s.kind} rule for ${s.path}`}
                    />
                    <Pill label={s.kind} color="var(--status-idle)" />
                    <span className="font-mono text-xs">{s.path}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {s.methods.map((m) => m.toUpperCase()).join(' ')}
                    </span>
                    <details className="ml-auto text-xs text-muted-foreground">
                      <summary className="cursor-pointer">Action</summary>
                      <pre className="mt-1 max-w-md overflow-x-auto rounded-md bg-muted p-2 font-mono">
                        {JSON.stringify(s.action, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Panel>
  );
}

function DeploymentDocument({ slug }: { slug: string }) {
  const deployments = useAppDeployments(slug);
  const own = deployments.data?.pages.flatMap((page) => page.items) ?? [];
  const [chosen, setChosen] = useState('');
  // Derived, not synchronised: a selection that is not in the current list
  // must never reach the path parameter, or one app is asked for another's
  // deployment and the 404 reads as "nothing was captured".
  const deploymentId = own.some((d) => d.id === chosen) ? chosen : (own[0]?.id ?? '');
  const doc = useDeploymentOpenAPIDoc(slug, deploymentId);
  const listError = own.length === 0 ? deployments.error : undefined;
  const listPhase = queryPhase({
    error: listError,
    loading: deployments.isPending,
    isEmpty: own.length === 0,
  });

  return (
    <Panel
      title="Captured from the app"
      description="What the cold-boot probe read from the app's own /openapi.json for one deployment."
      actions={
        own.length > 0 || deployments.hasNextPage ? (
          <div className="flex items-center gap-2">
            {own.length > 0 && (
              <Select
                value={deploymentId}
                onChange={(e) => setChosen(e.target.value)}
                aria-label="Deployment"
                className="h-8 text-xs"
              >
                {own.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.id.slice(0, 8)} · {d.status}
                  </option>
                ))}
              </Select>
            )}
            {deployments.hasNextPage && (
              <Button
                size="xs"
                variant="outline"
                busy={deployments.isFetchingNextPage}
                onClick={() => void deployments.fetchNextPage().catch(() => undefined)}
              >
                Load older deployments
              </Button>
            )}
          </div>
        ) : undefined
      }
    >
      {listPhase !== 'ready' ? (
        <InlinePhase
          phase={listPhase}
          error={listError}
          loadingMessage="Looking for deployments…"
          emptyMessage="No deployments to read from yet."
        />
      ) : (
        <div className="flex flex-col gap-3">
          {Boolean(deployments.error) && (
            <InlinePhase
              phase={queryPhase({ error: deployments.error })}
              error={deployments.error}
            />
          )}
          <PlanGated error={doc.error} feature="Endpoint discovery">
            {doc.isPending ? (
              <p className="text-sm text-muted-foreground">Reading the captured document…</p>
            ) : doc.error && isNotFound(doc.error) ? (
              <p className="text-sm text-muted-foreground">
                No document was captured for this deployment. The probe reads /openapi.json during
                cold boot; an app that does not serve one leaves nothing here.
              </p>
            ) : doc.error ? (
              <p className="text-sm text-muted-foreground">{errorMessage(doc.error)}</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-muted-foreground">
                  {countPaths(doc.data)} paths captured.
                </p>
                <DocumentView doc={doc.data} />
              </div>
            )}
          </PlanGated>
        </div>
      )}
    </Panel>
  );
}
