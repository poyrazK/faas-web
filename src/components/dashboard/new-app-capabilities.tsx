import { useState } from 'react';
import { useCapability } from '@/lib/api/capabilities';
import { capabilityEntrypoint } from '@/lib/capability-entrypoints';
import { CapabilityNotice } from './capability-notice';

function Handoff({ capabilityKey, title }: { capabilityKey: string; title: string }) {
  const availability = useCapability(capabilityKey);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-sm font-medium">{title}</h3>
      <CapabilityNotice
        capability={availability.capability}
        state={availability.state}
        onRetry={availability.refresh}
      />
      {availability.state === 'available' && (
        <p className="text-xs text-muted-foreground">
          {capabilityEntrypoint(capabilityKey).instruction}
        </p>
      )}
    </div>
  );
}
export function NewAppCapabilities() {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        className="w-fit text-xs text-muted-foreground underline"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        Container images and isolated runs
      </button>
      {open && (
        <div className="flex flex-col gap-4 border-l border-border pl-4">
          <Handoff capabilityKey="container-deployments" title="Container images" />
          <Handoff capabilityKey="disposable-runs" title="Isolated runs" />
        </div>
      )}
    </div>
  );
}
