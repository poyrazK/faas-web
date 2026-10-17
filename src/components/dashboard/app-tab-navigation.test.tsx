import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { AppTabNavigation, resolveAppTab, type AppTab } from './app-tab-navigation';

function Navigation({ initial }: { initial: AppTab }) {
  const [tab, select] = useState(initial);
  return <AppTabNavigation tab={tab} onSelect={select} panelId="panel" />;
}

const pages = (group: string) => screen.getByRole('group', { name: `${group} pages` });

it('opens the right group from a deep linked page', () => {
  render(<Navigation initial="Edge rules" />);
  expect(screen.getByRole('tab', { name: 'Connect' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pages('Connect')).getByRole('button', { name: 'Edge rules' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  expect(screen.getAllByRole('tab')).toHaveLength(7);
});

it('moves between groups with the arrow keys and lands on the first page', async () => {
  render(<Navigation initial="Configuration" />);
  screen.getByRole('tab', { name: 'Configure' }).focus();
  await userEvent.keyboard('{ArrowLeft}');
  expect(screen.getByRole('tab', { name: 'Automate' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Automate' })).toHaveAttribute('aria-selected', 'true');
  expect(within(pages('Automate')).getByRole('button', { name: 'Automations' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  await userEvent.keyboard('{Home}');
  expect(screen.getByRole('tab', { name: 'Overview' })).toHaveFocus();
});

it('remembers the page last open in each group', async () => {
  render(<Navigation initial="Edge rules" />);
  await userEvent.click(within(pages('Connect')).getByRole('button', { name: 'Mirrors' }));
  await userEvent.click(screen.getByRole('tab', { name: 'Automate' }));
  expect(within(pages('Automate')).getAllByRole('button')).toHaveLength(3);
  await userEvent.click(screen.getByRole('tab', { name: 'Connect' }));
  expect(within(pages('Connect')).getByRole('button', { name: 'Mirrors' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
});

it('offers env vars and secrets as one Environment page', () => {
  render(<Navigation initial="Environment" />);
  expect(
    within(pages('Configure'))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Environment', 'Configuration']);
});

it('resolves retired tab names so old links still land', () => {
  expect(resolveAppTab('Secrets')).toBe('Environment');
  expect(resolveAppTab('Env vars')).toBe('Environment');
  expect(resolveAppTab('Logs')).toBe('Logs');
  expect(resolveAppTab('nope')).toBeUndefined();
  expect(resolveAppTab(3)).toBeUndefined();
});

it('groups the consumer pages under Monetize', () => {
  render(<Navigation initial="Consumer plans" />);
  expect(screen.getByRole('tab', { name: 'Monetize' })).toHaveAttribute('aria-selected', 'true');
  expect(
    within(pages('Monetize'))
      .getAllByRole('button')
      .map((b) => b.textContent)
  ).toEqual(['Consumers', 'Consumer plans']);
});
