import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';
import { ObjectTags, tagProblems } from './object-tags';

const mocks = vi.hoisted(() => ({
  tags: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/api/object-storage', async (original) => ({
  ...(await original<typeof import('@/lib/api/object-storage')>()),
  useObjectTags: mocks.tags,
  setObjectTags: mocks.set,
  clearObjectTags: mocks.clear,
}));

const bucket = {
  id: 'bucket-one',
  name: 'assets',
  scope: 'default',
  region: 'us-east-1',
  state: 'ready' as const,
  public: false,
  created_at: '2026-10-01T00:00:00Z',
};
function show(writable = true) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ObjectTags slug="demo" bucket={bucket} objectKey="robots.txt" writable={writable} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tags.mockReturnValue({
    data: { tags: { team: 'web', stage: 'live' } },
    isPending: false,
    error: null,
  });
  mocks.set.mockResolvedValue({ tags: {} });
  mocks.clear.mockResolvedValue({ tags: {} });
});

it('reads the current tags and replaces the whole set', async () => {
  const user = userEvent.setup();
  show();
  expect(screen.getByText('team=web')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Edit tags' }));
  await user.click(screen.getByRole('button', { name: 'Remove tag 2' }));
  await user.click(screen.getByRole('button', { name: 'Add tag' }));
  await user.type(screen.getByLabelText('Tag 2 key'), 'retain');
  await user.type(screen.getByLabelText('Tag 2 value'), 'yes');
  await user.click(screen.getByRole('button', { name: 'Save tags' }));
  await waitFor(() =>
    expect(mocks.set).toHaveBeenCalledWith('demo', 'bucket-one', 'robots.txt', {
      team: 'web',
      retain: 'yes',
    })
  );
});

it('clears every tag with a DELETE', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Edit tags' }));
  await user.click(screen.getByRole('button', { name: 'Remove tag 1' }));
  await user.click(screen.getByRole('button', { name: 'Remove tag 1' }));
  await user.click(screen.getByRole('button', { name: 'Save tags' }));
  await waitFor(() => expect(mocks.clear).toHaveBeenCalledWith('demo', 'bucket-one', 'robots.txt'));
});

it('catches what apid would refuse', async () => {
  const user = userEvent.setup();
  show();
  await user.click(screen.getByRole('button', { name: 'Edit tags' }));
  await user.clear(screen.getByLabelText('Tag 2 key'));
  await user.type(screen.getByLabelText('Tag 2 key'), 'team');
  await user.click(screen.getByRole('button', { name: 'Save tags' }));
  expect(screen.getByText('Tag keys must be unique.')).toBeInTheDocument();
  expect(mocks.set).not.toHaveBeenCalled();
  expect(tagProblems(Array.from({ length: 11 }, (_, i) => [`k${i}`, '']))).toContain(
    'An object holds at most 10 tags.'
  );
});

it('names an object that cannot be tagged by its code', async () => {
  const user = userEvent.setup();
  mocks.set.mockRejectedValue(
    new ApiError({
      status: 405,
      code: 'object_storage_not_taggable',
      title: 'Method Not Allowed',
    } as never)
  );
  show();
  await user.click(screen.getByRole('button', { name: 'Edit tags' }));
  await user.click(screen.getByRole('button', { name: 'Save tags' }));
  await waitFor(() =>
    expect(mocks.toast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'This object version does not support tags.' })
    )
  );
});

it('reads but does not edit while signing is off', () => {
  show(false);
  expect(screen.getByRole('button', { name: 'Edit tags' })).toBeDisabled();
});
