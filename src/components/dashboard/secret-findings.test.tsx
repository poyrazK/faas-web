import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { SecretFindings } from './secret-findings';

/** Names the keys, never the values; findings need an explicit acknowledgement. */
describe('SecretFindings', () => {
  it('lists findings and toggles the acknowledgement', () => {
    const onAcknowledge = vi.fn();
    render(
      <SecretFindings
        findings={[{ key: 'STRIPE', provider: 'stripe_live', severity: 'high' }]}
        acknowledged={false}
        onAcknowledge={onAcknowledge}
      />
    );
    expect(screen.getByText('STRIPE')).toBeInTheDocument();
    expect(screen.getByText(/stripe_live/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onAcknowledge).toHaveBeenCalledWith(true);
  });

  it('renders nothing for no findings', () => {
    const { container } = render(
      <SecretFindings findings={[]} acknowledged={false} onAcknowledge={() => {}} />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
