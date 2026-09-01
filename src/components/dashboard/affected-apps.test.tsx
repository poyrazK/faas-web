import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AffectedApps } from './affected-apps';

describe('AffectedApps', () => {
  it('groups rows under their bucket headings', () => {
    render(
      <AffectedApps
        rows={[
          { slug: 'api', action: 'update', bucket: 'deploy', note: 'root was services/api-old' },
          { slug: 'web', action: 'noop', bucket: 'unaffected' },
        ]}
      />
    );
    expect(screen.getByRole('heading', { name: 'Will deploy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Unaffected' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Skipped' })).not.toBeInTheDocument();
    expect(screen.getByText('root was services/api-old')).toBeInTheDocument();
    expect(screen.getByText('update')).toBeInTheDocument();
  });
});
