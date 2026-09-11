import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReleaseStatusLabel } from './release-status-label';

afterEach(cleanup);

describe('ReleaseStatusLabel', () => {
  it.each([
    ['live', 'var(--status-good)'],
    ['succeeded', 'var(--status-good)'],
    ['failed', 'var(--status-critical)'],
    ['deploying', 'var(--status-warning)'],
    ['queued', 'var(--chart-muted)'],
    ['superseded', 'var(--chart-muted)'],
    ['cancelled', 'var(--chart-muted)'],
    ['unknown-state', 'var(--chart-muted)'],
  ])('keeps %s explicit and uses its semantic color', (status, color) => {
    render(<ReleaseStatusLabel status={status} />);
    const label = screen.getByText(status);
    expect(label.parentElement).toHaveStyle({ color });
    expect(label.parentElement?.querySelector('svg')).toHaveAttribute('aria-hidden', 'true');
  });
});
