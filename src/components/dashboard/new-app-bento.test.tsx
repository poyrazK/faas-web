import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { NewAppBento } from './new-app-bento';

const setup = (props: Partial<Parameters<typeof NewAppBento>[0]> = {}) => {
  const onSelect = vi.fn();
  const view = render(
    <>
      <form id="f" />
      <NewAppBento uid="u" formId="f" onSelect={onSelect} {...props} />
    </>
  );
  return { onSelect, ...view };
};

describe('NewAppBento', () => {
  it('keeps the three labelled groups and every cell named by its title, in source order', () => {
    setup();
    const groups = screen.getAllByRole('group');
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveAccessibleName('From code');
    expect(groups[1]).toHaveAccessibleName('From an image');
    expect(groups[2]).toHaveAccessibleName('Bring an existing project');
    const names = screen.getAllByRole('button').map((b) => b.getAttribute('data-source'));
    expect(names).toEqual(['git', 'template', 'empty', 'container', 'worker', 'import']);
    expect(
      within(groups[0]).getByRole('button', { name: 'Git repository' })
    ).toHaveAccessibleDescription(/one service from a branch, tag, or commit/);
  });

  it('numbers the cells and names their group in an eyebrow', () => {
    setup();
    const git = screen.getByRole('button', { name: 'Git repository' });
    expect(git).toHaveTextContent('01');
    expect(git).toHaveTextContent('From code');
    expect(screen.getByRole('button', { name: 'Import' })).toHaveTextContent('06');
  });

  it('joins the source form by name, so focus-first-error can find a cell', () => {
    const { container } = setup();
    const form = container.querySelector('form') as HTMLFormElement;
    expect(form.elements.namedItem('source-git')).toBe(
      screen.getByRole('button', { name: 'Git repository' })
    );
  });

  it('marks only the selected cell pressed and reports a choice', async () => {
    const { onSelect } = setup({ selected: 'git' });
    expect(screen.getByRole('button', { name: 'Git repository' })).toHaveAttribute(
      'aria-pressed',
      'true'
    );
    expect(screen.getAllByRole('button', { pressed: false })).toHaveLength(5);
    await userEvent.click(screen.getByRole('button', { name: 'Template' }));
    expect(onSelect).toHaveBeenCalledWith('template');
  });

  it('adds the source error to every description when one is shown', () => {
    render(
      <>
        <form id="f" />
        <p id="err">Choose where the code comes from to continue.</p>
        <NewAppBento uid="u" formId="f" onSelect={vi.fn()} errorId="err" />
      </>
    );
    expect(screen.getByRole('button', { name: 'Empty app' })).toHaveAccessibleDescription(
      /Choose where the code comes from to continue\./
    );
  });

  it('hides every preview and draws four corner marks per cell', () => {
    const { container } = setup();
    const previews = container.querySelectorAll('[data-preview]');
    expect(previews).toHaveLength(6);
    previews.forEach((p) => expect(p).toHaveAttribute('aria-hidden', 'true'));
    expect(container.querySelectorAll('.nab-mark')).toHaveLength(24);
  });

  it('shows Git alone in onboarding, without groups', () => {
    const { container } = setup({ single: true, selected: 'git' });
    expect(screen.queryAllByRole('group')).toHaveLength(0);
    expect(screen.getAllByRole('button')).toHaveLength(1);
    expect(container.querySelector('.nab-grid')).toHaveAttribute('data-single');
  });
});
