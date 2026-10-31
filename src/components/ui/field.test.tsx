import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FieldError, fieldErrorProps, useFormValidation } from './field';

function ExampleForm({ onSave }: { onSave: () => void }) {
  const validation = useFormValidation<'email' | 'port'>();
  const emailError = validation.submitAttempted ? 'Enter an email address.' : undefined;
  const portError = validation.submitAttempted ? 'Enter a port from 1 to 65535.' : undefined;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (
          !validation.validate(
            { email: emailError ?? 'Enter an email address.', port: portError },
            event.currentTarget
          )
        )
          return;
        onSave();
      }}
    >
      <label>
        Email
        <input name="email" {...fieldErrorProps(emailError, 'email-error')} />
      </label>
      {emailError && <FieldError id="email-error">{emailError}</FieldError>}
      <label>
        Port
        <input name="port" {...fieldErrorProps(portError, 'port-error')} />
      </label>
      {portError && <FieldError id="port-error">{portError}</FieldError>}
      <button type="submit">Save</button>
    </form>
  );
}

describe('form validation helpers', () => {
  it('reveals accessible inline errors and focuses the first invalid field on submit', async () => {
    const onSave = vi.fn();
    render(<ExampleForm onSave={onSave} />);

    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const email = screen.getByRole('textbox', { name: 'Email' });
    expect(email).toHaveFocus();
    expect(email).toHaveAttribute('aria-invalid', 'true');
    expect(email).toHaveAccessibleDescription('Enter an email address.');
    expect(screen.getByText('Enter an email address.')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });
});

describe('validation over a group of radios', () => {
  // A list of choices (the New app repository list) is several controls under
  // one name; the form hands back a RadioNodeList, not an element.
  it('focuses the chosen radio, or the first one, when the group is invalid', async () => {
    function Choices({ chosen }: { chosen?: string }) {
      const validation = useFormValidation<'repository'>();
      return (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            validation.validate({ repository: 'Choose a repository.' }, event.currentTarget);
          }}
        >
          {['a/one', 'a/two'].map((r) => (
            <label key={r}>
              {r}
              <input type="radio" name="repository" value={r} defaultChecked={chosen === r} />
            </label>
          ))}
          <button type="submit">Go</button>
        </form>
      );
    }
    const { unmount } = render(<Choices />);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('radio', { name: 'a/one' })).toHaveFocus();
    unmount();
    render(<Choices chosen="a/two" />);
    await userEvent.click(screen.getByRole('button', { name: 'Go' }));
    expect(screen.getByRole('radio', { name: 'a/two' })).toHaveFocus();
  });
});
