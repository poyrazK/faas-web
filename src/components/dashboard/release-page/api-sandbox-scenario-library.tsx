import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { InlinePhase } from '@/components/dashboard/primitives';
import {
  removeSandboxLibraryScenario,
  sandboxLibraryScenarioKey,
  sandboxScenarioLibraryKey,
  saveSandboxLibraryScenario,
  type APISandboxLibraryScenario,
  type APISandboxLibraryScenarioSummary,
  type APISandboxScenarioResponse,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { SandboxScenarioEditor } from './api-sandbox-scenario';

export function SandboxScenarioLibrary({
  slug,
  scenarios,
  selected,
  entry,
  loadError,
  onSelect,
}: {
  slug: string;
  scenarios: APISandboxLibraryScenarioSummary[];
  selected: string;
  entry?: APISandboxLibraryScenario;
  loadError: Error | null;
  onSelect: (id: string) => void;
}) {
  const client = useQueryClient();
  const [newId, setNewId] = useState<string>();
  const [removeTarget, setRemoveTarget] = useState<APISandboxLibraryScenario>();
  const libraryKey = sandboxScenarioLibraryKey(slug);
  const remove = useMutation({
    mutationFn: (target: APISandboxLibraryScenario) =>
      removeSandboxLibraryScenario(slug, target.id, target.scenario.revision),
    onSuccess: () => {
      setRemoveTarget(undefined);
      onSelect('');
    },
    onSettled: () => void client.invalidateQueries({ queryKey: libraryKey }),
  });

  function saved(id: string, response: APISandboxScenarioResponse) {
    const scenario = response.scenario;
    if (!scenario) return;
    client.setQueryData(sandboxLibraryScenarioKey(slug, id), { ...response, id });
    client.setQueryData(
      libraryKey,
      (previous: { scenarios: APISandboxLibraryScenarioSummary[] } | undefined) => ({
        scenarios: [
          ...(previous?.scenarios ?? []).filter((item) => item.id !== id),
          { id, name: scenario.name, revision: scenario.revision },
        ].sort((a, b) => a.name.localeCompare(b.name)),
      })
    );
    void client.invalidateQueries({ queryKey: libraryKey, exact: true });
    setNewId(undefined);
    setRemoveTarget(undefined);
    onSelect(id);
  }

  const editingId = newId ?? entry?.id;
  return (
    <section
      aria-label="Scenario library"
      className="grid max-w-lg gap-3 rounded-lg border border-border p-3"
    >
      <h3 className="text-sm font-medium">Scenario library</h3>
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-0 gap-1 text-xs">
          Scenario for this release
          <select
            value={selected}
            disabled={remove.isPending}
            onChange={(event) => {
              setNewId(undefined);
              setRemoveTarget(undefined);
              remove.reset();
              onSelect(event.target.value);
            }}
            className="min-w-0 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
          >
            <option value="">Release scenario</option>
            {selected && !scenarios.some((item) => item.id === selected) ? (
              <option value={selected} disabled>
                Unavailable library scenario
              </option>
            ) : null}
            {scenarios.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        {!newId ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={remove.isPending}
            onClick={() => {
              setRemoveTarget(undefined);
              remove.reset();
              setNewId(crypto.randomUUID());
            }}
          >
            New library scenario
          </Button>
        ) : null}
      </div>
      {editingId ? (
        <SandboxScenarioEditor
          key={editingId}
          scenario={newId ? null : (entry?.scenario ?? null)}
          sourceRequestId={newId ? undefined : entry?.source_request_id}
          library
          startEditing={!!newId}
          saveScenario={(input, revision) =>
            saveSandboxLibraryScenario(slug, editingId, { ...input, expected_revision: revision })
          }
          onSave={(response) => saved(editingId, response)}
          onCancel={newId ? () => setNewId(undefined) : undefined}
        />
      ) : selected && loadError ? (
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(loadError)}
        </p>
      ) : selected ? (
        <InlinePhase phase="loading" loadingMessage="Loading library scenario…" />
      ) : null}
      {entry && !newId ? (
        <div className="grid gap-2">
          {removeTarget ? (
            <>
              <p className="text-sm">
                Remove {removeTarget.scenario.name} from this app’s library? Existing run reports
                stay available.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant="destructive"
                  busy={remove.isPending}
                  onClick={() => remove.mutate(removeTarget)}
                >
                  Remove scenario
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={remove.isPending}
                  onClick={() => setRemoveTarget(undefined)}
                >
                  Cancel
                </Button>
              </div>
            </>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="justify-self-start"
              onClick={() => setRemoveTarget(entry)}
            >
              Remove library scenario
            </Button>
          )}
          {remove.error ? (
            <p role="alert" className="text-sm text-destructive">
              {errorMessage(remove.error)}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
