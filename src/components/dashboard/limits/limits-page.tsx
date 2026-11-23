import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { featureFlags } from '@/lib/feature-flags';
import { BudgetsSection } from '../budgets/budgets-page';
import { CapabilityGate } from '../capability-gate';
import { PageHeader } from '../primitives';
import { SpendCapEditor } from '../spend-cap';
import { AgentAwareStrip, AgentsSection } from './agents-section';
import { IntegrationsSection } from './integrations-section';
import { StatusStrip } from './status-strip';
import { useBillFacts } from './use-bill-facts';
import { YourBill } from './your-bill';

/**
 * Billing › Spending limits: every limit on what the workspace can be billed,
 * and what happens when one is reached. The answer comes first; then the hard
 * limits on the bill; then budgets; then agents, behind the `agents` build
 * flag (off, the agent code folds out of the bundle); then integrations and AI,
 * folded. Design: docs/superpowers/specs/
 * 2026-11-23-spending-limits-design.md.
 */
export function LimitsPage() {
  const data = useBillFacts();
  const [editingCap, setEditingCap] = useState(false);
  const [egressOpen, setEgressOpen] = useState(false);
  const capCents = data.facts?.cap.state === 'ready' ? data.facts.cap.capCents : undefined;
  const onStripAction = (action: 'cap' | 'egress') =>
    action === 'cap' ? setEditingCap(true) : setEgressOpen(true);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Spending limits"
        help={
          data.org
            ? `Every limit on what ${data.workspaceLabel} can be billed, and what happens when one is reached.`
            : 'Every limit on what you can be billed, and what happens when one is reached.'
        }
      />
      {featureFlags.agents ? (
        <AgentAwareStrip data={data} onAction={onStripAction} />
      ) : (
        <StatusStrip data={data} onAction={onStripAction} />
      )}
      <YourBill
        data={data}
        onEditCap={() => setEditingCap(true)}
        egressOpen={egressOpen}
        onEgressOpenChange={setEgressOpen}
      />
      <CapabilityGate capability="budgets" title="Budgets">
        <BudgetsSection />
      </CapabilityGate>
      {featureFlags.agents && <AgentsSection />}
      <IntegrationsSection />
      {editingCap && capCents !== undefined && (
        <Modal
          open
          onClose={() => setEditingCap(false)}
          title="Spend cap"
          description="Set $0 to allow no overage, or clear the cap to remove the ceiling."
          width="max-w-lg"
        >
          <div className="p-1">
            <SpendCapEditor
              initialCents={capCents}
              org={data.org}
              workspaceLabel={data.workspaceLabel}
            />
          </div>
        </Modal>
      )}
    </div>
  );
}
