import { renderHook } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { useMfaAction } from './use-mfa-action';

const openMfa = vi.hoisted(() => vi.fn());
vi.mock('./mfa-provider', () => ({ useMfa: () => ({ openMfa }) }));
beforeEach(() => {
  openMfa.mockReset();
});
const refusal = () =>
  new ApiError({ status: 403, code: 'step_up_required', title: 'Verify first' });

it('does not ask optional-MFA users to enroll when the action succeeds', async () => {
  const action = vi.fn().mockResolvedValue('checkout');
  const { result } = renderHook(useMfaAction);
  await expect(result.current(action, 'Billing')).resolves.toBe('checkout');
  expect(openMfa).not.toHaveBeenCalled();
  expect(action).toHaveBeenCalledTimes(1);
});

it.each(['authenticator', 'enrolment', 'recovery'])(
  'retries once after %s establishes verification',
  async (method) => {
    const action = vi.fn().mockRejectedValueOnce(refusal()).mockResolvedValueOnce('done');
    openMfa.mockImplementation((_mode, options) => options.onVerified(method));
    const { result } = renderHook(useMfaAction);
    await expect(result.current(action, 'Billing')).resolves.toBe('done');
    expect(action).toHaveBeenCalledTimes(2);
    expect(openMfa).toHaveBeenCalledTimes(1);
  }
);

it('does not loop when the server refuses the verified retry', async () => {
  const action = vi.fn().mockRejectedValue(refusal());
  openMfa.mockImplementation((_mode, options) => options.onVerified('authenticator'));
  const { result } = renderHook(useMfaAction);
  await expect(result.current(action, 'Billing')).rejects.toHaveProperty(
    'code',
    'step_up_required'
  );
  expect(action).toHaveBeenCalledTimes(2);
  expect(openMfa).toHaveBeenCalledTimes(1);
});

it('does not retry a cancelled verification', async () => {
  const action = vi.fn().mockRejectedValue(refusal());
  openMfa.mockImplementation((_mode, options) => options.onDismissed());
  const { result } = renderHook(useMfaAction);
  await expect(result.current(action, 'Billing')).rejects.toThrow('Verification cancelled');
  expect(action).toHaveBeenCalledTimes(1);
});
