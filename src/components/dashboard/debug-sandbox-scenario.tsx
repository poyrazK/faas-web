import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { InlinePhase } from '@/components/dashboard/primitives';
import {
  getDebugSandboxScenarioDraft,
  sandboxScenarioLibraryKey,
  saveSandboxLibraryScenario,
} from '@/lib/api/api-sandboxes';
import { errorMessage } from '@/lib/api/errors';
import { SandboxScenarioEditor } from './release-page/api-sandbox-scenario';

export function DebugSandboxScenarioAction({ slug, reqId }: { slug: string; reqId: string }) {
  const [open, setOpen] = useState(false);
  return open ? (
    <DebugSandboxScenarioDraft slug={slug} reqId={reqId} onClose={() => setOpen(false)} />
  ) : (
    <Button
      type="button"
      className="self-start"
      size="sm"
      variant="outline"
      onClick={() => setOpen(true)}
    >
      Create sandbox scenario
    </Button>
  );
}

function DebugSandboxScenarioDraft({
  slug,
  reqId,
  onClose,
}: {
  slug: string;
  reqId: string;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [scenarioId] = useState(() => crypto.randomUUID());
  const [savedRelease, setSavedRelease] = useState<string>();
  const draft = useQuery({
    queryKey: ['debug-sandbox-scenario-draft', slug, reqId],
    queryFn: ({ signal }) => getDebugSandboxScenarioDraft(slug, reqId, signal),
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });

  if (savedRelease) {
    return (
      <div className="grid gap-2 text-sm">
        <p role="status">Scenario saved to this app’s library.</p>
        <Link
          to="/dashboard/apps/$appSlug/releases/$deploymentId"
          params={{ appSlug: slug, deploymentId: savedRelease }}
          search={{ sandbox: true, sandboxScenario: scenarioId }}
          className="w-fit underline underline-offset-2"
        >
          Open release sandbox checks
        </Link>
      </div>
    );
  }
  if (draft.isPending) {
    return <InlinePhase phase="loading" loadingMessage="Preparing sandbox scenario draft…" />;
  }
  if (draft.isError) {
    return (
      <div className="grid gap-2">
        <p role="alert" className="text-sm text-destructive">
          {errorMessage(draft.error)}
        </p>
        <Button
          type="button"
          className="self-start justify-self-start"
          size="sm"
          variant="outline"
          onClick={onClose}
        >
          Close draft
        </Button>
      </div>
    );
  }

  const source = draft.data;
  return (
    <SandboxScenarioEditor
      scenario={null}
      fromRequest={source}
      library
      onCancel={onClose}
      saveScenario={(input) =>
        saveSandboxLibraryScenario(slug, scenarioId, {
          ...input,
          expected_revision: '',
          source_request_id: source.source_request_id,
        })
      }
      onSave={() => {
        void client.invalidateQueries({ queryKey: sandboxScenarioLibraryKey(slug) });
        setSavedRelease(source.deployment_id);
      }}
    />
  );
}
