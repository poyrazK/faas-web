import { useState } from 'react';
import { Modal } from '@/components/ui/modal';
import { BudgetsSection } from '../budgets/budgets-page';
import { CapabilityGate } from '../capability-gate';
import { PageHeader } from '../primitives';
import { SpendCapEditor } from '../spend-cap';
import { StatusStrip } from './status-strip';
import { useBillFacts } from './use-bill-facts';
import { YourBill } from './your-bill';

/**
 * Billing › Spending limits: every limit on what the workspace can be billed,
 * and what happens when one is reached. The answer comes first; then the hard
 * limits on the bill; then budgets. Design: docs/superpowers/specs/
 * 2026-11-23-spending-limits-design.md.
 */
export function LimitsPage() {
  const data = useBillFacts();
  const [editingCap, setEditingCap] = useState(false);
  const [egressOpen, setEgressOpen] = useState(false);
  const capCents = data.facts?.cap.state === 'ready' ? data.facts.cap.capCents : undefined;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Spending limits"
        help="Every limit on what you can be billed, and what happens when one is reached."
      />
      <StatusStrip
        data={data}
        onAction={(action) => (action === 'cap' ? setEditingCap(true) : setEgressOpen(true))}
      />
      <YourBill
        data={data}
        onEditCap={() => setEditingCap(true)}
        egressOpen={egressOpen}
        onEgressOpenChange={setEgressOpen}
      />
      <CapabilityGate capability="budgets" title="Budgets">
        <BudgetsSection />
      </CapabilityGate>
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
