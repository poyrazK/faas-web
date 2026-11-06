import { beforeEach, expect, it } from 'vitest';
import {
  hasOnboardingRecovery,
  onboardingKey,
  readOnboarding,
  sampleVersion,
  writeOnboarding,
  validateOnboardingDraft,
} from './onboarding-draft';
const owner = { account: 'alice', workspace: null };
beforeEach(() => localStorage.clear());
it('restores only the exact account and workspace and treats interrupted writes as unknown', () => {
  writeOnboarding({
    version: 1,
    owner,
    dismissed: false,
    draft: {
      kind: 'sample',
      starter: sampleVersion(),
      name: 'hello-test',
      app: 'hello-test',
      phase: 'submitting',
    },
  });
  expect(readOnboarding(owner).draft?.phase).toBe('unknown');
  expect(readOnboarding({ account: 'bob', workspace: null }).draft).toBeUndefined();
  expect(readOnboarding({ account: 'alice', workspace: 'company' }).draft).toBeUndefined();
});
it('never restores foreign ownership, malformed IDs or unversioned records', () => {
  localStorage.setItem(
    onboardingKey(owner),
    JSON.stringify({
      version: 1,
      owner: { account: 'bob', workspace: null },
      draft: { kind: 'sample', starter: sampleVersion(), app: 'hello-test', phase: 'accepted' },
    })
  );
  expect(readOnboarding(owner).draft).toBeUndefined();
  localStorage.setItem(onboardingKey(owner), '{invalid');
  expect(readOnboarding(owner).draft).toBeUndefined();
});
it('stores only allowlisted descriptors and keeps dismissal separate from completion', () => {
  const draft = {
    kind: 'sample' as const,
    starter: sampleVersion(),
    phase: 'preparing' as const,
    code: 'SECRET_SOURCE',
    token: 'SECRET_TOKEN',
  };
  writeOnboarding({ version: 1, owner, dismissed: true, draft });
  const text = localStorage.getItem(onboardingKey(owner))!;
  expect(text).not.toMatch(/SECRET|code|token/);
  expect(readOnboarding(owner).dismissed).toBe(true);
  expect(readOnboarding(owner).draft?.phase).toBe('preparing');
});

it('keeps rollback recovery reachable when an unrelated stored workspace is corrupt', () => {
  localStorage.setItem(onboardingKey({ ...owner, workspace: 'broken' }), '{broken');
  writeOnboarding({
    version: 1,
    owner,
    dismissed: false,
    draft: { kind: 'existing', app: 'hello-test', phase: 'accepted' },
  });
  expect(hasOnboardingRecovery(owner.account)).toBe(true);
  expect(hasOnboardingRecovery('bob')).toBe(false);
});
it.each([
  { kind: 'sample', starter: 'node-old', app: '../other', phase: 'accepted' },
  {
    kind: 'sample',
    starter: 'node-old',
    app: 'hello-test',
    deployment: 'bad-id',
    phase: 'accepted',
  },
  { kind: 'git', repo: 'owner/repo', ref: 'main\nsecret', phase: 'preparing' },
  { kind: 'sample', starter: 'node-old', phase: { toString: () => 'accepted' } },
])('rejects an invalid persisted descriptor', (draft) => {
  expect(validateOnboardingDraft(draft)).toBeUndefined();
});

it('restores the selected GitHub installation without accepting malformed installation IDs', () => {
  const draft = {
    kind: 'git',
    repo: 'company/api',
    ref: 'main',
    phase: 'preparing',
    installation: '99',
  };
  expect(validateOnboardingDraft(draft)).toMatchObject({ installation: '99' });
  expect(validateOnboardingDraft({ ...draft, installation: 'private/error' })).not.toHaveProperty(
    'installation'
  );
});
