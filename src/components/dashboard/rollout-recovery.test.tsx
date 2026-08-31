import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RolloutRecovery } from './rollout-recovery';

describe('RolloutRecovery', () => {
  it('offers three actions and passes the reason', () => {
    const onAct = vi.fn();
    render(<RolloutRecovery trafficPercent={75} busy={false} onAct={onAct} />);
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'latency regression' } });
    fireEvent.click(screen.getByRole('button', { name: 'Advance' }));
    expect(onAct).toHaveBeenCalledWith('advance', 'latency regression');
    expect(screen.getByText(/75% still on the previous deployment/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Promote' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Abort' })).toBeInTheDocument();
  });
});
