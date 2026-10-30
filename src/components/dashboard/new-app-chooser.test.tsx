import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewAppChooser } from './new-app-chooser';

const setup = (props: Partial<Parameters<typeof NewAppChooser>[0]> = {}) => {
  const onSelect = vi.fn();
  const view = render(
    <>
      <form id="f" />
      <NewAppChooser uid="u" formId="f" onSelect={onSelect} {...props} />
    </>
  );
  return { onSelect, ...view };
};

describe('NewAppChooser', () => {
  // Most people arrive with code in a repository: Git leads, on its own,
  // and the other five follow as one compact list.
  it('leads with Git, then lists the other ways to start in order', () => {
    setup();
    const order = screen.getAllByRole('button').map((b) => b.getAttribute('data-source'));
    expect(order).toEqual(['git', 'template', 'empty', 'container', 'worker', 'import']);
    const others = screen.getByRole('group', { name: 'Other ways to start' });
    expect(within(others).queryByRole('button', { name: 'Git repository' })).toBeNull();
    expect(within(others).getAllByRole('button')).toHaveLength(5);
  });

  it('names each choice by its source and describes it in one line', () => {
    setup();
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAccessibleDescription(
      'Build and deploy a branch, tag, or commit.'
    );
    expect(screen.getByRole('button', { name: 'Import' })).toHaveAccessibleDescription(
      'Turn a repository with several services into a project.'
    );
  });

  it('shows an icon for each source and no pictures', () => {
    const { container } = setup();
    expect(container.querySelectorAll('[data-source] svg')).toHaveLength(6 + 5 + 1);
    expect(container.querySelector('canvas, [data-preview]')).toBeNull();
  });

  it('reports a choice, and marks the selected one pressed', async () => {
    const { onSelect } = setup({ selected: 'worker' });
    expect(screen.getByRole('button', { name: 'Long-lived worker' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    await userEvent.click(screen.getByRole('button', { name: 'Template' }));
    expect(onSelect).toHaveBeenCalledWith('template');
  });

  it('joins the source form by name, so validation can focus a choice', () => {
    const { container } = setup();
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form.elements.namedItem('source-git')).toBe(
      screen.getByRole('button', { name: 'Git repository' })
    );
  });

  it('shows Git alone in onboarding', () => {
    setup({ single: true, selected: 'git' });
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(screen.queryByRole('group')).toBeNull();
  });
});
