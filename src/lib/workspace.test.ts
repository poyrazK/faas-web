import { afterEach, describe, expect, it } from 'vitest';
import { activeOrgHeader, bindWorkspaceAccount, setActiveOrg } from './workspace';

afterEach(() => {
  window.localStorage.clear();
  bindWorkspaceAccount('');
});

describe('workspace store', () => {
  it('sends no org until one is chosen, so apid uses the personal org', () => {
    bindWorkspaceAccount('acct-1');
    expect(activeOrgHeader()).toBeNull();
  });

  it('remembers the choice per account and never leaks it to another account', () => {
    bindWorkspaceAccount('acct-1');
    setActiveOrg('team-a');
    expect(activeOrgHeader()).toBe('team-a');
    bindWorkspaceAccount('acct-2');
    expect(activeOrgHeader()).toBeNull();
    bindWorkspaceAccount('acct-1');
    expect(activeOrgHeader()).toBe('team-a');
  });

  it('returns to the personal org when cleared', () => {
    bindWorkspaceAccount('acct-1');
    setActiveOrg('team-a');
    setActiveOrg(null);
    expect(activeOrgHeader()).toBeNull();
    expect(window.localStorage.getItem('gregale.active-org.acct-1')).toBeNull();
  });
});

describe('workspace readiness', () => {
  it('is not ready until the signed-in account is bound, so a company choice is never read as personal', async () => {
    const { workspaceBound } = await import('./workspace');
    bindWorkspaceAccount('');
    expect(workspaceBound()).toBe(false);
    window.localStorage.setItem('gregale.active-org.acct-ready', 'acme');
    bindWorkspaceAccount('acct-ready');
    expect(workspaceBound()).toBe(true);
    expect(activeOrgHeader()).toBe('acme');
    window.localStorage.removeItem('gregale.active-org.acct-ready');
  });
});
