import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { OverviewSearch } from './overview-search';

afterEach(() => vi.restoreAllMocks());
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('./nav-access', () => ({ useCapabilityOff: () => () => false }));
vi.mock('border-beam', () => ({
  BorderBeam: ({
    active,
    staticColors,
    children,
  }: {
    active: boolean;
    staticColors: boolean;
    children: ReactNode;
  }) => (
    <div data-beam-active={String(active)} data-static-colors={String(staticColors)}>
      {children}
    </div>
  ),
}));

it('stops field and result decoration on preference changes while search remains operable', async () => {
  const user = userEvent.setup();
  let reduce = false;
  const changes = new EventTarget();
  vi.spyOn(window, 'matchMedia').mockImplementation(
    () =>
      ({
        get matches() {
          return reduce;
        },
        addEventListener: changes.addEventListener.bind(changes),
        removeEventListener: changes.removeEventListener.bind(changes),
      }) as MediaQueryList
  );
  const { container } = render(<OverviewSearch workflows={[]} />);
  await user.click(screen.getByRole('combobox'));
  expect(container.querySelectorAll('[data-beam-active="true"]')).toHaveLength(2);
  act(() => {
    reduce = true;
    changes.dispatchEvent(new Event('change'));
  });
  expect(
    container.querySelectorAll('[data-beam-active="false"][data-static-colors="true"]')
  ).toHaveLength(2);
  await user.type(screen.getByRole('combobox'), 'projects');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(screen.getByRole('combobox')).toHaveFocus();
  act(() => {
    reduce = false;
    changes.dispatchEvent(new Event('change'));
  });
  expect(container.querySelectorAll('[data-beam-active="true"]')).toHaveLength(2);
});
