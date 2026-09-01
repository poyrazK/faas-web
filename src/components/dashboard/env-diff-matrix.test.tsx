import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { EnvDiffMatrix } from './env-diff-matrix';

describe('EnvDiffMatrix', () => {
  it('draws one column per scope and names each cell state', () => {
    render(
      <EnvDiffMatrix
        scopes={['default', 'prod']}
        rows={[
          {
            key: 'DATABASE_URL',
            kind: 'secret',
            cells: { default: { present: true, value_hash: 'a' }, prod: { present: false } },
          },
        ]}
      />
    );
    expect(screen.getByRole('columnheader', { name: 'prod' })).toBeInTheDocument();
    expect(screen.getByLabelText('DATABASE_URL in default: only')).toBeInTheDocument();
    expect(screen.getByLabelText('DATABASE_URL in prod: missing')).toBeInTheDocument();
  });
});
