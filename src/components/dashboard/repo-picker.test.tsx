import { render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { RepoPicker } from './repo-picker';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ account: { github_install_id: '42' } }) }));
vi.mock('@/lib/api/queries', () => ({
  useInstallRepos: () => ({
    data: [{ id: 1, full_name: 'team/allowed', default_branch: 'main', private: false }],
    isPending: false,
    error: null,
  }),
}));

describe('repository handoff access', () => {
  it('displays an accessible repository when GitHub normalizes its casing', () => {
    render(<RepoPicker value="Team/Allowed" onChange={() => {}} />);
    expect(screen.getByRole('combobox')).toHaveValue('team/allowed');
    expect(screen.queryByText(/not listed in your GitHub installation/)).not.toBeInTheDocument();
  });

  it('keeps an inaccessible checked repo visible and prevents continuing until access is resolved', () => {
    function Form() {
      const [available, setAvailable] = useState(true);
      return (
        <>
          <RepoPicker
            value="team/checked"
            onChange={() => {}}
            onAvailabilityChange={setAvailable}
          />
          <button disabled={!available}>Continue</button>
        </>
      );
    }
    render(<Form />);
    expect(screen.getByRole('combobox')).toHaveValue('team/checked');
    expect(screen.getByText(/not listed in your GitHub installation/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
