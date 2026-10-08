import { useState } from 'react';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { AppTabNavigation, type AppTab } from './app-tab-navigation';

function Navigation({ initial }: { initial: AppTab }) {
  const [tab, select] = useState(initial);
  return <AppTabNavigation tab={tab} onSelect={select} panelId="panel" />;
}
it('opens the right group from a deep linked tab and supports keyboard navigation', async () => {
  render(<Navigation initial="Edge rules" />);
  expect(screen.getByRole('button', { name: 'Connect app section' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const edge = screen.getByRole('tab', { name: 'Edge rules' });
  expect(edge).toHaveAttribute('aria-selected', 'true');
  edge.focus();
  await userEvent.keyboard('{ArrowRight}');
  expect(screen.getByRole('tab', { name: 'Mirrors' })).toHaveFocus();
  await userEvent.click(screen.getByRole('button', { name: 'Automate app section' }));
  expect(screen.getByRole('tab', { name: 'Automations' })).toHaveAttribute('aria-selected', 'true');
  expect(within(screen.getByRole('tablist')).getAllByRole('tab')).toHaveLength(3);
  await userEvent.click(screen.getByRole('button', { name: 'Connect app section' }));
  expect(screen.getByRole('tab', { name: 'Mirrors' })).toHaveAttribute('aria-selected', 'true');
});
