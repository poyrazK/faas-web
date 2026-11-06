import { useState } from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { SegmentedControl, Tabs } from './tabs';

afterEach(() => vi.restoreAllMocks());

const options = [
  { key: 'one', label: 'One' },
  { key: 'two', label: 'Two' },
  { key: 'three', label: 'Three' },
];
function Example() {
  const [value, setValue] = useState('one');
  return (
    <div className="console">
      <Tabs label="Pages" value={value} options={options} onChange={setValue} panelId="panel" />
      <SegmentedControl label="Range" value={value} options={options} onChange={setValue} />
    </div>
  );
}

it('keeps keyboard selection and focus immediate across repeated arrow keys', async () => {
  const user = userEvent.setup();
  render(<Example />);
  screen.getByRole('tab', { name: 'One' }).focus();
  await user.keyboard('{ArrowRight}{ArrowRight}{Home}{End}');
  expect(screen.getByRole('tab', { name: 'Three' })).toHaveFocus();
  expect(screen.getByRole('tab', { name: 'Three' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('tab', { name: 'One' })).toHaveAttribute('tabindex', '-1');
  expect(screen.getByRole('button', { name: 'Three' })).toHaveAttribute('aria-pressed', 'true');
});

it('places each strip indicator at its own selection and removes stale indicators', async () => {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const left = this.textContent === 'Two' ? 80 : 0;
    return {
      left,
      top: 0,
      width: 60,
      height: 30,
      right: left + 60,
      bottom: 30,
      x: left,
      y: 0,
      toJSON() {},
    };
  });
  const { container, rerender } = render(
    <div className="console">
      <Tabs label="Pages" value="one" options={options} onChange={() => {}} panelId="panel" />
    </div>
  );
  const indicator = container.querySelector<HTMLElement>('.console-selection-indicator')!;
  expect(indicator.style.transform).toContain('0px');
  rerender(
    <div className="console">
      <Tabs label="Pages" value="two" options={options} onChange={() => {}} panelId="panel" />
    </div>
  );
  await waitFor(() => expect(indicator.style.transform).toContain('80px'));
  await act(async () => {
    rerender(
      <div className="console">
        <Tabs label="Pages" value="missing" options={options} onChange={() => {}} panelId="panel" />
      </div>
    );
  });
  expect(screen.getByRole('tablist')).not.toHaveAttribute('data-indicator-ready');
});
