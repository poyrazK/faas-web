import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/api/queries', () => ({
  useAppDeployments: () => ({
    data: {
      pages: [
        {
          items: [
            {
              id: 'dep-1',
              app_id: 'app-1',
              image_digest: 'sha256:aaaaaaaa',
              kind: 'github',
              status: 'live',
              created_at: '2026-09-11T00:00:00Z',
            },
          ],
        },
      ],
    },
    isPending: false,
    error: null,
    hasNextPage: false,
    refetch: vi.fn(),
  }),
}));

const { DeploymentHistoryPanel } = await import('./deployment-history');

describe('Deployment history', () => {
  it('shows each row time with the exact time on hover', () => {
    render(<DeploymentHistoryPanel slug="api" buildTimings={new Map()} onSelect={vi.fn()} />);

    const when = screen.getByRole('time');
    expect(when).toHaveAttribute('dateTime', '2026-09-11T00:00:00.000Z');
    expect(when).toHaveAttribute('title', expect.stringContaining('2026'));
    expect(when).toHaveTextContent(/ago$/);
  });
});
