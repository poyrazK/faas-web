import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { FUNCTION_STARTERS } from '@/lib/function-starters';
import { FunctionSource } from './function-source';

const setup = (props: Partial<Parameters<typeof FunctionSource>[0]> = {}) => {
  const handlers = {
    onLanguage: vi.fn(),
    onCode: vi.fn(),
    onReset: vi.fn(),
    onBrowseStarters: vi.fn(),
  };
  render(
    <>
      <form id="f" />
      <FunctionSource
        formId="f"
        language="node"
        code={FUNCTION_STARTERS.node.code}
        edited={false}
        {...handlers}
        {...props}
      />
    </>
  );
  return handlers;
};

describe('FunctionSource', () => {
  it('offers Node.js and Python as choices, the current one checked', async () => {
    const { onLanguage } = setup();
    expect(screen.getByRole('radiogroup', { name: 'Language' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Node.js' })).toBeChecked();
    await userEvent.click(screen.getByRole('radio', { name: 'Python' }));
    expect(onLanguage).toHaveBeenCalledWith('python');
  });

  it('edits the handler in a named field, in the form, under its file name', async () => {
    const { onCode } = setup();
    const editor = screen.getByRole('textbox', { name: 'handler.js' });
    expect(editor).toHaveValue(FUNCTION_STARTERS.node.code);
    expect(editor).toHaveAttribute('name', 'handler');
    expect(editor).toHaveAttribute('form', 'f');
    await userEvent.type(editor, 'x');
    expect(onCode).toHaveBeenCalled();
  });

  it('offers a reset only once the starter has been edited', async () => {
    setup();
    expect(screen.queryByRole('button', { name: 'Reset to starter' })).toBeNull();
    const { onReset } = setup({ edited: true });
    await userEvent.click(screen.getByRole('button', { name: 'Reset to starter' }));
    expect(onReset).toHaveBeenCalled();
  });

  it('reads a dropped-in file, switching to its language', async () => {
    const { onLanguage, onCode } = setup();
    const file = new File(['async def handler(event, ctx):\n    return {}\n'], 'handler.py', {
      type: 'text/x-python',
    });
    await userEvent.upload(screen.getByLabelText('Upload a handler file'), file);
    expect(onLanguage).toHaveBeenCalledWith('python');
    expect(onCode).toHaveBeenCalledWith('async def handler(event, ctx):\n    return {}\n');
  });

  it('shows its error under the editor and points the editor at it', () => {
    setup({ error: 'Write the handler, or upload a file.', errorId: 'e' });
    const editor = screen.getByRole('textbox', { name: 'handler.js' });
    expect(editor).toHaveAttribute('aria-invalid', 'true');
    expect(editor).toHaveAccessibleDescription(/Write the handler, or upload a file\./);
  });

  it('sends Go and Rust to the starters, which build with the CLI', async () => {
    const { onBrowseStarters } = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Use a function starter' }));
    expect(onBrowseStarters).toHaveBeenCalled();
  });
});

describe('the starters', () => {
  // Copied from the CLI's templates: the runner calls an exported handler.
  it('export the handler the runner calls', () => {
    expect(FUNCTION_STARTERS.node.code).toMatch(/export async function handler\(event, ctx\)/);
    expect(FUNCTION_STARTERS.python.code).toMatch(/async def handler\(event, ctx\):/);
    expect(FUNCTION_STARTERS.node.extra[0].content).toMatch(/"type": "module"/);
  });
});
