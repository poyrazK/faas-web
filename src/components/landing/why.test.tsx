import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Why } from './why';

/** The connected journey stays visible while click or keyboard selects details. */
describe('report feature flow', () => {
  it('shows the connected request-to-result journey and the API explanation first', () => {
    render(<Why />);
    const steps = screen.getByRole('tablist', { name: 'Report workflow' });
    expect(
      within(steps)
        .getAllByRole('tab')
        .map((tab) => tab.textContent?.replace(/\s+/g, ' ').trim())
    ).toEqual([
      'Request Your customer',
      'API Beta hosting',
      'Background work Preview',
      'Result Your application',
    ]);
    expect(within(steps).getByRole('tab', { name: /API/ })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    const panel = screen.getByRole('tabpanel', { name: /API/ });
    expect(within(panel).getByRole('heading', { name: 'Your application' })).toBeInTheDocument();
    expect(within(panel).getByRole('heading', { name: 'Gregale' })).toBeInTheDocument();
    expect(panel).toHaveTextContent(/accept.*request/i);
    expect(
      screen.getByText(/Illustrative workflow using beta hosting and preview/)
    ).toBeInTheDocument();
  });

  it('changes ownership explanations on click without hiding the connected stages', async () => {
    const user = userEvent.setup();
    render(<Why />);
    await user.click(screen.getByRole('tab', { name: /Background work/ }));
    const panel = screen.getByRole('tabpanel', { name: /Background work/ });
    expect(panel).toHaveTextContent(/report logic/i);
    expect(panel).toHaveTextContent(/retries/i);
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    await user.click(screen.getByRole('tab', { name: /Result/ }));
    expect(screen.getByRole('tabpanel', { name: /Result/ })).toHaveTextContent(
      /customer experience/i
    );
    expect(screen.getByRole('tab', { name: /Background work/ })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('moves focus and selection together with arrows, Home and End', async () => {
    const user = userEvent.setup();
    render(<Why />);
    screen.getByRole('tab', { name: /API/ }).focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Background work/ })).toHaveFocus();
    expect(screen.getByRole('tabpanel', { name: /Background work/ })).toBeInTheDocument();
    await user.keyboard('{End}');
    expect(screen.getByRole('tab', { name: /Result/ })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: /Request/ })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('tab', { name: /Request/ })).toHaveAttribute('aria-selected', 'true');
  });
});
