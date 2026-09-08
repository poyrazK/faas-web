import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const destroy = vi.fn();
const toast = vi.fn();
const confirm = vi.fn();
const navigate = vi.fn();

vi.mock('@/lib/api/queries', () => ({
  useDestroyPreview: () => ({ mutateAsync: destroy, isPending: false }),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast }) }));
vi.mock('@/components/ui/confirm', () => ({ useConfirm: () => confirm }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));

const { TearDownPreviewButton, isPreviewSlug } = await import('./preview-actions');

beforeEach(() => {
  destroy.mockReset().mockResolvedValue(undefined);
  toast.mockReset();
  confirm.mockReset().mockResolvedValue(true);
  navigate.mockReset();
});

describe('isPreviewSlug', () => {
  it("matches githubd's pr-{number}-{parent} convention only", () => {
    expect(isPreviewSlug('pr-42-api-gateway')).toBe(true);
    expect(isPreviewSlug('api-gateway')).toBe(false);
    expect(isPreviewSlug('pr-api')).toBe(false);
  });
});

describe('TearDownPreviewButton', () => {
  it('is offered only for preview apps', () => {
    const { rerender } = render(<TearDownPreviewButton slug="api-gateway" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    rerender(<TearDownPreviewButton slug="pr-42-api-gateway" />);
    expect(screen.getByRole('button', { name: /tear down preview/i })).toBeInTheDocument();
  });

  it('requires typing the slug, then tears down and leaves the page', async () => {
    render(<TearDownPreviewButton slug="pr-42-api-gateway" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() =>
      expect(confirm).toHaveBeenCalledWith(
        expect.objectContaining({ typeToConfirm: 'pr-42-api-gateway' })
      )
    );
    await waitFor(() => expect(destroy).toHaveBeenCalledWith('pr-42-api-gateway'));
    expect(navigate).toHaveBeenCalledWith({ to: '/dashboard/workflows' });
  });

  it('explains preview_not_found instead of reporting a failure', async () => {
    destroy.mockRejectedValue(
      new ApiError({ status: 404, code: 'preview_not_found', title: 'Nope' })
    );
    render(<TearDownPreviewButton slug="pr-42-api-gateway" />);
    await userEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(toast).toHaveBeenCalled());
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'info', title: 'Not a preview app' })
    );
  });
});
