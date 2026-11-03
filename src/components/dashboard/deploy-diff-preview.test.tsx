import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DeployDiffPreview, diffValue } from './deploy-diff-preview';
import type { components } from '@/lib/api/schema';

type DiffResponse = components['schemas']['DiffResponse'];

const preview = (over: Partial<DiffResponse['diff']> = {}, blocking = false): DiffResponse => ({
  slug: 'alpha',
  plan: 'hobby',
  blocking,
  diff: { slug: 'alpha', plan: 'hobby', changes: [], breaks: [], ...over },
});

describe('diffValue', () => {
  it('prints the engine’s polymorphic values without "[object Object]"', () => {
    expect(diffValue(undefined)).toBe('—');
    expect(diffValue(null)).toBe('—');
    expect(diffValue(512)).toBe('512');
    expect(diffValue(false)).toBe('false');
    expect(diffValue(['10.0.0.0/8', '1.1.1.1/32'])).toBe('10.0.0.0/8, 1.1.1.1/32');
    expect(diffValue({ min: 1, max: 3 })).toBe('{"min":1,"max":3}');
  });
});

describe('DeployDiffPreview', () => {
  it('lists each change with its before and after', () => {
    render(
      <DeployDiffPreview
        preview={preview({
          changes: [
            { field: 'memory', kind: 'modify', before: 256, after: 512 },
            { field: 'egress_allowlist', kind: 'add', after: ['10.0.0.0/8'] },
          ],
        })}
      />
    );
    const changes = screen.getByRole('list', { name: 'Changes' });
    expect(within(changes).getAllByRole('listitem')[0]).toHaveTextContent('memory256→512');
    expect(changes).toHaveTextContent('10.0.0.0/8');
  });

  it('shows each break with its severity, code, reason and the limit it crosses', () => {
    render(
      <DeployDiffPreview
        preview={preview(
          {
            changes: [{ field: 'concurrency', kind: 'modify', before: 10, after: 30 }],
            breaks: [
              {
                code: 'plan_limit_concurrency',
                severity: 'error',
                reason: 'max_concurrency exceeds plan cap',
                field: 'concurrency',
                observed: 30,
                limit: 20,
              },
              { code: 'handler_changed', severity: 'warn', reason: 'the handler changes' },
            ],
          },
          true
        )}
      />
    );
    const breaks = screen.getByRole('list', { name: 'What it would break' });
    const [error, warn] = within(breaks).getAllByRole('listitem');
    expect(error).toHaveTextContent('Blocks the deploy');
    expect(error).toHaveTextContent('plan_limit_concurrency');
    expect(error).toHaveTextContent('max_concurrency exceeds plan cap');
    expect(error).toHaveTextContent('30 against a limit of 20');
    expect(warn).toHaveTextContent('Warning');
    expect(screen.getByText(/the deploy would be refused/i)).toBeInTheDocument();
    expect(screen.queryByText(/object Object/)).toBeNull();
  });

  it('says so when nothing would change', () => {
    render(<DeployDiffPreview preview={preview()} />);
    expect(screen.getByText('No effective changes.')).toBeInTheDocument();
  });
});
