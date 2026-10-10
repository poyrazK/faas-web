import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api/errors';

const add = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null as unknown }));
const cron = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null as unknown }));
const bucket = vi.hoisted(() => ({ mutate: vi.fn(), isPending: false, error: null as unknown }));
vi.mock('@/lib/api/queries', () => ({ useAddDomain: () => add, useCreateCron: () => cron }));
vi.mock('@/lib/api/object-storage', () => ({ useCreateObjectBucket: () => bucket }));

const { DraftNode } = await import('./draft-node');
const app = { slug: 'acme-api', id: 'id-acme', defaultRegion: 'eu' };

describe('DraftNode', () => {
  it('creates a domain on ↵ with the app id', () => {
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Hostname');
    fireEvent.change(input, { target: { value: 'api.acme.dev' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(add.mutate).toHaveBeenCalledWith(
      { domain: 'api.acme.dev', app_id: 'id-acme' },
      expect.anything()
    );
    expect(screen.getByText('→ creates on acme-api')).toBeInTheDocument();
  });

  it('dissolves on esc without calling the API', () => {
    const onCancel = vi.fn();
    add.mutate.mockClear();
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(screen.getByLabelText('Hostname'), { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(add.mutate).not.toHaveBeenCalled();
  });

  it('validates shape before sending', () => {
    add.mutate.mockClear();
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Hostname');
    fireEvent.change(input, { target: { value: 'https://x' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(add.mutate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent(/bare hostname/i);
  });

  it('submits once while the create is pending', () => {
    add.mutate.mockClear();
    add.isPending = true;
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Hostname');
    fireEvent.change(input, { target: { value: 'api.acme.dev' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(add.mutate).not.toHaveBeenCalled();
    add.isPending = false;
  });

  it('keeps the draft open with the mapped server error', () => {
    add.error = new ApiError({ status: 409, code: 'domain_exists', title: 'Conflict' });
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/already connected/i);
    add.error = null;
  });

  it('grows into a form for crons and sends only what was filled', () => {
    cron.mutate.mockClear();
    render(<DraftNode kind="cron" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '0 3 * * *' } });
    fireEvent.change(screen.getByLabelText('Path'), { target: { value: '/sync' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create cron' }));
    expect(cron.mutate).toHaveBeenCalledWith(
      { app_id: 'id-acme', schedule: '0 3 * * *', path: '/sync' },
      expect.anything()
    );
  });

  it('backs out when ↵ is pressed on Cancel instead of creating the cron', () => {
    cron.mutate.mockClear();
    const onCancel = vi.fn();
    render(<DraftNode kind="cron" app={app} onDone={vi.fn()} onCancel={onCancel} />);
    fireEvent.change(screen.getByLabelText('Schedule'), { target: { value: '0 3 * * *' } });
    const cancel = screen.getByRole('button', { name: 'Cancel' });
    cancel.focus();
    fireEvent.keyDown(cancel, { key: 'Enter' });
    expect(cron.mutate).not.toHaveBeenCalled();
  });

  it('takes focus without scrolling the canvas under it', async () => {
    const focus = vi.spyOn(HTMLInputElement.prototype, 'focus');
    render(<DraftNode kind="domain" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    await new Promise((r) => setTimeout(r, 50));
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    focus.mockRestore();
  });

  it('creates a bucket in the app’s default region', () => {
    render(<DraftNode kind="bucket" app={app} onDone={vi.fn()} onCancel={vi.fn()} />);
    const input = screen.getByLabelText('Bucket name');
    fireEvent.change(input, { target: { value: 'orders' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(bucket.mutate).toHaveBeenCalledWith({ name: 'orders', region: 'eu' }, expect.anything());
  });
});
