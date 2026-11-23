import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { withRouter } from '@/test/router';
import { ReleasePinningDemo } from './release-pinning-demo';

it('keeps an open tab on its original release until the pin expires or the page reloads', async () => {
  const user = userEvent.setup();
  render(withRouter(<ReleasePinningDemo />));

  const first = within(await screen.findByRole('article', { name: 'First tab' }));
  const second = within(screen.getByRole('article', { name: 'Second tab' }));
  const firstCheck = first.getByRole('button', { name: 'Check order' });
  expect(first.getByText('Awaiting request')).toBeVisible();
  expect(first.queryByRole('list', { name: 'Delivery progress' })).toBeNull();
  expect(second.queryByRole('button', { name: 'Check order' })).toBeNull();

  await user.click(screen.getByRole('button', { name: 'Publish release B' }));
  await user.click(firstCheck);
  expect(first.getByRole('list', { name: 'Delivery progress' })).toBeVisible();
  expect(first.getByText('In transit')).toHaveAttribute('aria-current', 'step');
  await user.click(first.getByText('Request details'));
  expect(first.getByText('release-a')).toBeVisible();
  expect(first.getByText('orders-api-v1')).toBeVisible();
  expect(first.getByText('inventory-v1')).toBeVisible();

  await user.click(second.getByRole('button', { name: 'Check order' }));
  await user.click(second.getByText('Request details'));
  expect(second.getByText('release-b')).toBeVisible();
  expect(second.getByText('orders-api-v2')).toBeVisible();
  expect(second.getByText('inventory-v2')).toBeVisible();

  await user.click(screen.getByRole('button', { name: 'Expire release A' }));
  await user.click(firstCheck);
  expect(first.getAllByText('410 Gone')).toHaveLength(2);
  expect(first.getByText('Gateway')).toBeVisible();
  expect(first.queryByText('inventory-v1')).toBeNull();
  expect(second.getByText('inventory-v2')).toBeVisible();

  await user.click(first.getByRole('button', { name: 'Reload tab' }));
  expect(first.getByText('release-b')).toBeVisible();
  expect(first.getByText('inventory-v2')).toBeVisible();
  expect(firstCheck).toHaveFocus();

  await user.click(screen.getByRole('button', { name: 'Restart demo' }));
  expect(first.getByText('Release A')).toBeVisible();
  expect(second.queryByRole('button', { name: 'Check order' })).toBeNull();
});
