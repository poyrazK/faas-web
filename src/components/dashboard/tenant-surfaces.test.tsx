import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { SurfaceCard } from './tenant-surfaces';

describe('SurfaceCard', () => {
  it('shows the TXT record for an unverified hostname and the cert state', () => {
    render(
      <SurfaceCard
        surface={{
          id: 's1',
          account_id: 'a',
          app_id: 'app',
          name: 'customers',
          cert_kind: 'per_host_san',
          status: 'active',
          cert_state: 'pending',
          hostnames: [
            {
              hostname: 'shop.acme.test',
              verified: false,
              txt_record: '_gregale-challenge.shop.acme.test TXT abc',
            },
          ],
        }}
        onAddHostname={() => {}}
        onRemoveHostname={() => {}}
        onDelete={() => {}}
        busy={false}
      />
    );
    expect(screen.getByText('customers')).toBeInTheDocument();
    expect(screen.getByText('cert pending')).toBeInTheDocument();
    expect(screen.getByText(/_gregale-challenge\.shop\.acme\.test TXT abc/)).toBeInTheDocument();
    expect(screen.getByText('pending')).toBeInTheDocument();
  });
});
