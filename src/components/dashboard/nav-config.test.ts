import { describe, expect, it } from 'vitest';
import { railGroupFor } from './nav-config';

describe('railGroupFor', () => {
  it.each([
    ['/dashboard/projects', 'Projects', 'Compute'],
    ['/dashboard/instances', 'Instances', 'Compute'],
    ['/dashboard/builds', 'Builds', 'Compute'],
    ['/dashboard/postgres', 'Postgres', 'Storage'],
    ['/dashboard/edge-rules', 'Edge rules', 'Networking'],
    ['/dashboard/integrations', 'Integrations', 'Messaging'],
    ['/dashboard/customers', 'Customers', 'Monetize'],
    ['/dashboard/debug', 'Debugger', 'Observe'],
    ['/dashboard/invoices', 'Invoices', 'Account'],
    ['/dashboard/settings', 'Members', 'Account'],
  ])('files %s (%s) under %s', (to, label, heading) => {
    expect(railGroupFor({ to, label })).toBe(heading);
  });

  it.each([
    ['/dashboard', 'Overview'],
    ['/dashboard/apps', 'Apps'],
    ['/dashboard/logs', 'Logs'],
    ['/dashboard/templates', 'Templates'],
  ])('gives %s (%s) no heading', (to, label) => {
    expect(railGroupFor({ to, label })).toBeUndefined();
  });

  it('tells a Settings section apart from the hub of the same name', () => {
    expect(railGroupFor({ to: '/dashboard/settings', label: 'Integrations' })).toBe('Account');
    expect(railGroupFor({ to: '/dashboard/integrations', label: 'Integrations' })).toBe(
      'Messaging'
    );
  });
});
