import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it } from 'vitest';
import { FormField } from './form-field';
import { Input } from './input';

it('keeps an untouched field descriptive but not invalid', () => {
  render(
    <FormField id="name" label="App name" hint="Used in your URL." error="Enter an app name.">
      {(props) => <Input {...props} />}
    </FormField>
  );
  expect(screen.getByLabelText('App name')).toHaveAccessibleDescription('Used in your URL.');
  expect(screen.getByLabelText('App name')).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

it('retains the hint and associates the visible error', async () => {
  render(
    <FormField
      id="name"
      label="App name"
      hint="Used in your URL."
      error="Enter an app name."
      showError
    >
      {(props) => <Input {...props} />}
    </FormField>
  );
  const input = screen.getByLabelText('App name');
  expect(input).toHaveAttribute('aria-invalid', 'true');
  expect(input).toHaveAccessibleDescription('Used in your URL. Enter an app name.');
  expect(screen.getByRole('alert')).toHaveTextContent('Enter an app name.');
  await userEvent.setup().click(screen.getByText('App name'));
  expect(input).toHaveFocus();
});

it('removes obsolete error associations when corrected', () => {
  const field = (error?: string) => (
    <FormField id="name" label="App name" error={error} showError>
      {(props) => <Input {...props} />}
    </FormField>
  );
  const { rerender } = render(field('Enter an app name.'));
  rerender(field());
  expect(screen.getByLabelText('App name')).not.toHaveAttribute('aria-describedby');
  expect(screen.getByLabelText('App name')).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});
