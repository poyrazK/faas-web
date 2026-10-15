import { render, screen, within } from '@testing-library/react';
import { expect, it } from 'vitest';
import { PolicyStatusView } from './policy-status';
import { status } from '@/test/runtime-policy';
import type { PolicyReceipt } from '@/lib/api/runtime-policy';
const receipt: PolicyReceipt = {
  id: 'save-1',
  appId: 'app-1',
  acceptedAt: Date.now(),
  action: 'configuration',
  components: ['request_policy', 'cpu_limit', 'scheduler_scaling'],
  baseline: { request_policy: 4, cpu_limit: 4, scheduler_scaling: 4 },
};
it('shows saved intent and independent observed statuses without implying replica targets were reached', () => {
  render(<PolicyStatusView data={status} receipt={receipt} checkedAt={Date.now()} />);
  expect(screen.getByText('Settings saved')).toBeVisible();
  expect(within(screen.getByTestId('policy-request_policy')).getByText('Active')).toBeVisible();
  expect(within(screen.getByTestId('policy-cpu_limit')).getByText('Pending')).toBeVisible();
  expect(within(screen.getByTestId('policy-scheduler_scaling')).getByText('Active')).toBeVisible();
  expect(screen.getByText(/does not confirm replica count/i)).toBeVisible();
  expect(screen.getAllByText(/Desired revision 5/i)).toHaveLength(3);
});
it('does not mark a 204 purge applied when cache convergence is pending', () => {
  render(
    <PolicyStatusView
      data={status}
      receipt={{
        ...receipt,
        action: 'purge',
        components: ['response_cache'],
        baseline: { response_cache: 4 },
      }}
    />
  );
  expect(screen.getByText('Purge requested')).toBeVisible();
  expect(screen.getByText('Pending')).toBeVisible();
  expect(screen.queryByText('Applied')).not.toBeInTheDocument();
});
it('requires a newer revision than the pre-save read, and never treats missing baseline as applied', () => {
  const view = render(
    <PolicyStatusView
      data={status}
      receipt={{ ...receipt, components: ['request_policy'], baseline: { request_policy: 5 } }}
    />
  );
  expect(screen.getByText('Pending')).toBeVisible();
  view.rerender(
    <PolicyStatusView
      data={status}
      receipt={{ ...receipt, components: ['request_policy'], baseline: undefined }}
    />
  );
  expect(screen.getByText('Unverified')).toBeVisible();
  expect(screen.queryByText('Active')).not.toBeInTheDocument();
});
