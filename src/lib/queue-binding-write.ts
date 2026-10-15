export interface QueueBindingWrite {
  version: 1;
  accountId: string;
  slug: string;
  appId: string;
  bindingId: string;
  action: 'update' | 'delete';
  beforeFingerprint: string;
  createdAt: number;
}

const key = (accountId: string, slug: string, bindingId: string) =>
  `gregale.queue-binding-write:${accountId}:${slug}:${bindingId}`;

export function saveQueueBindingWrite(write: QueueBindingWrite) {
  sessionStorage.setItem(
    key(write.accountId, write.slug, write.bindingId),
    JSON.stringify({
      version: 1,
      accountId: write.accountId,
      slug: write.slug,
      appId: write.appId,
      bindingId: write.bindingId,
      action: write.action,
      beforeFingerprint: write.beforeFingerprint,
      createdAt: write.createdAt,
    })
  );
}

export function readQueueBindingWrite(
  accountId: string,
  slug: string,
  bindingId: string
): QueueBindingWrite | null {
  const raw = sessionStorage.getItem(key(accountId, slug, bindingId));
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as QueueBindingWrite;
    if (
      value.version !== 1 ||
      value.accountId !== accountId ||
      value.slug !== slug ||
      value.bindingId !== bindingId ||
      typeof value.appId !== 'string' ||
      !['update', 'delete'].includes(value.action) ||
      typeof value.beforeFingerprint !== 'string' ||
      !Number.isFinite(value.createdAt)
    )
      return null;
    return {
      version: 1,
      accountId,
      slug,
      appId: value.appId,
      bindingId,
      action: value.action,
      beforeFingerprint: value.beforeFingerprint,
      createdAt: value.createdAt,
    };
  } catch {
    return null;
  }
}

export function clearQueueBindingWrite(accountId: string, slug: string, bindingId: string) {
  sessionStorage.removeItem(key(accountId, slug, bindingId));
}

export function listQueueBindingWrites(accountId: string, slug: string): QueueBindingWrite[] {
  const prefix = key(accountId, slug, '');
  const writes: QueueBindingWrite[] = [];
  for (let index = 0; index < sessionStorage.length; index += 1) {
    const storageKey = sessionStorage.key(index);
    if (!storageKey?.startsWith(prefix)) continue;
    const bindingId = storageKey.slice(prefix.length);
    const write = readQueueBindingWrite(accountId, slug, bindingId);
    if (write) writes.push(write);
  }
  return writes.sort((left, right) => left.createdAt - right.createdAt);
}
