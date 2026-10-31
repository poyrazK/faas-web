import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { KINDS, KIND_ORDER, summarise } from './kinds';

it('offers a cache rule with all three timing windows and safe request dimensions', async () => {
  expect(KIND_ORDER).toContain('cache');
  const cache = KINDS.cache;
  expect(cache.empty()).toEqual({
    max_age_seconds: 60,
    stale_while_revalidate_seconds: 0,
    stale_if_error_seconds: 300,
    methods: ['GET', 'HEAD'],
    vary_on: [],
  });
  expect(
    summarise('cache', {
      max_age_seconds: 120,
      stale_while_revalidate_seconds: 30,
      stale_if_error_seconds: 0,
      methods: ['GET'],
      vary_on: [],
    })
  ).toMatch(/120.*30.*0/);

  const onChange = vi.fn();
  render(<>{cache.Form({ value: cache.empty(), onChange, errors: {}, apps: [], slug: 'api' })}</>);
  expect(screen.getByLabelText(/Fresh for \(seconds\)/)).toHaveValue(60);
  expect(screen.getByLabelText(/Stale while revalidate \(seconds\)/)).toHaveValue(0);
  expect(screen.getByLabelText(/Stale if error \(seconds\)/)).toHaveValue(300);
  expect(screen.getByRole('button', { name: 'GET' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByRole('button', { name: 'HEAD' })).toHaveAttribute('aria-pressed', 'true');
  expect(screen.queryByRole('button', { name: 'POST' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Authorization' })).not.toBeInTheDocument();
  expect(screen.getByText(/Authorization.*Cookie.*bypass/)).toBeInTheDocument();
  expect(screen.getByText(/Set-Cookie.*private.*no-store/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Accept-Language' }));
  expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ vary_on: ['Accept-Language'] }));
});

it('rejects unsafe cache values but permits disabling stale on error', () => {
  const cache = KINDS.cache;
  expect(cache.validate({ ...cache.empty(), stale_if_error_seconds: 0 })).toEqual({});
  expect(cache.validate({ ...cache.empty(), max_age_seconds: 3601 })).toHaveProperty(
    'max_age_seconds'
  );
  expect(cache.validate({ ...cache.empty(), methods: ['POST'] as never })).toHaveProperty(
    'methods'
  );
});
