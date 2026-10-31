import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EnvImportButton } from './env-import';

const mocks = vi.hoisted(() => ({ set: vi.fn(), toast: vi.fn() }));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/queries', () => ({
  useSetSecret: () => ({ mutateAsync: mocks.set, isPending: false }),
}));

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue({});
  mocks.toast.mockReset();
});

async function importEnv(onChanged: () => void) {
  const user = userEvent.setup();
  render(<EnvImportButton slug="alpha" existingKeys={[]} onChanged={onChanged} />);
  await user.click(screen.getByRole('button', { name: /import \.env/i }));
  await user.click(screen.getByLabelText('.env contents'));
  await user.paste('A_KEY=1\nB_KEY=2');
  await user.click(screen.getByRole('button', { name: /import 2 secrets/i }));
}

describe('Import .env', () => {
  it('reports a change once the values are written', async () => {
    const onChanged = vi.fn();
    await importEnv(onChanged);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('still reports a change when only some values were written', async () => {
    mocks.set.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('nope'));
    const onChanged = vi.fn();
    await importEnv(onChanged);
    await waitFor(() => expect(onChanged).toHaveBeenCalledTimes(1));
  });

  it('does not report a change when nothing was written', async () => {
    mocks.set.mockRejectedValue(new Error('nope'));
    const onChanged = vi.fn();
    await importEnv(onChanged);
    await waitFor(() =>
      expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ kind: 'error' }))
    );
    expect(onChanged).not.toHaveBeenCalled();
  });
});
