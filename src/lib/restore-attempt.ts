export type RestoreIdentity = {
  accountId: string;
  appId: string;
  slug: string;
  expectedDeletedAt: string;
  expectedDeadline: string;
};
export type RestoreAttempt = RestoreIdentity & {
  attemptId: string;
  startedAt: string;
  phase: 'pending' | 'accepted' | 'uncertain';
};
const prefix = 'gregale.restore-attempt.v1:';
const keyFor = (accountId: string, appId: string) =>
  prefix + encodeURIComponent(accountId) + ':' + encodeURIComponent(appId);

function project(value: RestoreAttempt): RestoreAttempt {
  return {
    accountId: value.accountId,
    appId: value.appId,
    slug: value.slug,
    expectedDeletedAt: value.expectedDeletedAt,
    expectedDeadline: value.expectedDeadline,
    attemptId: value.attemptId,
    startedAt: value.startedAt,
    phase: value.phase,
  };
}
function valid(value: RestoreAttempt | null): value is RestoreAttempt {
  return Boolean(
    value &&
    typeof value.accountId === 'string' &&
    value.accountId.length > 0 &&
    value.accountId.length <= 128 &&
    typeof value.appId === 'string' &&
    /^[a-f0-9-]{32,36}$/i.test(value.appId) &&
    typeof value.slug === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,62}$/.test(value.slug) &&
    typeof value.attemptId === 'string' &&
    /^[a-f0-9-]{36}$/i.test(value.attemptId) &&
    ['pending', 'accepted', 'uncertain'].includes(value.phase) &&
    Number.isFinite(Date.parse(value.expectedDeletedAt)) &&
    Number.isFinite(Date.parse(value.expectedDeadline)) &&
    Number.isFinite(Date.parse(value.startedAt))
  );
}

export function readRestoreAttempt(accountId: string, appId: string): RestoreAttempt | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(keyFor(accountId, appId));
    const value = raw ? (JSON.parse(raw) as RestoreAttempt) : null;
    return valid(value) && value.accountId === accountId && value.appId === appId
      ? project(value)
      : null;
  } catch {
    return null;
  }
}

export function listRestoreAttempts(accountId: string): RestoreAttempt[] {
  if (typeof window === 'undefined') return [];
  const rows: RestoreAttempt[] = [];
  try {
    const owned = prefix + encodeURIComponent(accountId) + ':';
    for (let i = 0; i < window.sessionStorage.length && rows.length < 50; i++) {
      const key = window.sessionStorage.key(i);
      if (!key?.startsWith(owned)) continue;
      const id = decodeURIComponent(key.slice(owned.length));
      const row = readRestoreAttempt(accountId, id);
      if (row) rows.push(row);
    }
  } catch {
    return rows;
  }
  return rows;
}

export function beginRestoreAttempt(identity: RestoreIdentity): RestoreAttempt {
  if (readRestoreAttempt(identity.accountId, identity.appId))
    throw new Error('Inspect the pending restore before reviewing a new attempt.');
  if (listRestoreAttempts(identity.accountId).length >= 50)
    throw new Error('Inspect existing restore recovery records before starting another.');
  const row = project({
    ...identity,
    attemptId: crypto.randomUUID(),
    startedAt: new Date().toISOString(),
    phase: 'pending',
  });
  if (!valid(row)) throw new Error('The restore recovery identity is unavailable. Review again.');
  try {
    window.sessionStorage.setItem(keyFor(row.accountId, row.appId), JSON.stringify(row));
    if (readRestoreAttempt(row.accountId, row.appId)?.attemptId !== row.attemptId)
      throw new Error();
  } catch {
    throw new Error(
      'This browser could not retain restore recovery identity. Enable session storage before restoring.'
    );
  }
  return row;
}

export function updateRestoreAttempt(row: RestoreAttempt, phase: RestoreAttempt['phase']) {
  if (readRestoreAttempt(row.accountId, row.appId)?.attemptId !== row.attemptId) return;
  try {
    window.sessionStorage.setItem(
      keyFor(row.accountId, row.appId),
      JSON.stringify(project({ ...row, phase }))
    );
  } catch {
    // The original pending identity is sufficient for inspection after reload.
  }
}

export function clearRestoreAttempt(row: RestoreAttempt) {
  if (readRestoreAttempt(row.accountId, row.appId)?.attemptId !== row.attemptId) return;
  try {
    window.sessionStorage.removeItem(keyFor(row.accountId, row.appId));
  } catch {
    throw new Error('The recovery identity could not be cleared. No new restore was sent.');
  }
}
