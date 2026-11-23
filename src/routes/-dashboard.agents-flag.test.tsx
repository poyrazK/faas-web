import { isRedirect } from '@tanstack/react-router';
import { describe, expect, it } from 'vitest';
import { featureFlags } from '@/lib/feature-flags';
import { Route as AgentsList } from './dashboard.agents.index';
import { Route as AgentDetail } from './dashboard.agents.$agentId';

const beforeLoad = (route: { options: { beforeLoad?: unknown } }) => () =>
  (route.options.beforeLoad as () => void)();

describe('the agents build flag', () => {
  it('is off in tests, as in a customer build', () => {
    expect(featureFlags.agents).toBe(false);
  });

  it.each([
    ['the list', AgentsList],
    ['one agent', AgentDetail],
  ])('sends a bookmarked URL for %s to the Overview while off', (_, route) => {
    let thrown: unknown;
    try {
      beforeLoad(route)();
    } catch (error) {
      thrown = error;
    }
    expect(isRedirect(thrown)).toBe(true);
    expect((thrown as { options: { to: string } }).options.to).toBe('/dashboard');
  });
});
