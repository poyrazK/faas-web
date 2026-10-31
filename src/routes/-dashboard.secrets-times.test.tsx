import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@tanstack/react-router', () => ({ createFileRoute: () => (options: unknown) => options }));
vi.mock('@/lib/api/queries', () => ({
  useAppSecrets: () => ({
    data: { secrets: [{ key: 'API_TOKEN', updated_at: '2026-09-11T00:00:00Z' }] },
    isPending: false,
    error: null,
    refetch: vi.fn(),
  }),
  useSetSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRotateSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFreshRestart: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => vi.fn() }));
vi.mock('@/components/dashboard/env-import', () => ({ EnvImportButton: () => null }));
vi.mock('@/components/dashboard/app-select', () => ({
  AppScope: () => null,
  AppSelect: () => null,
  useSelectedApp: () => ({}),
}));

const { SecretsBody } = await import('./dashboard.secrets');

describe('Secrets table', () => {
  it('shows when a secret was updated, with the exact time on hover', () => {
    render(<SecretsBody slug="api" />);

    const when = screen.getByRole('time');
    expect(when).toHaveAttribute('dateTime', '2026-09-11T00:00:00.000Z');
    expect(when).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(when).toHaveTextContent(/ago$/);
  });
});
