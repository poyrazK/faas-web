import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { AuditEventBody } from './audit-event-drawer';

describe('AuditEventBody', () => {
  it('shows the headline fields and the payload as JSON', () => {
    render(
      <AuditEventBody
        event={{
          id: '9',
          at: '2026-08-30T10:00:00Z',
          actor: 'apid',
          kind: 'auth.login',
          subject: 'acct-1',
          severity: 'info',
          data: { ip: '203.0.113.9' },
        }}
      />
    );
    expect(screen.getByText('auth.login')).toBeInTheDocument();
    expect(screen.getByText(/"ip": "203\.0\.113\.9"/)).toBeInTheDocument();
    expect(screen.getByText('info')).toBeInTheDocument();
  });
});
