import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  policyBaseline,
  readRuntimePolicy,
  type PolicyComponent,
  type PolicyReceipt,
} from '@/lib/api/runtime-policy';

/** Optional evidence must not block a save, or continue a write in a new context. */
export function usePolicyOperation(
  accountId: string,
  slug: string,
  appId: string,
  action: PolicyReceipt['action']
) {
  const identity = `${accountId}:${slug}:${appId}`;
  const current = useRef(identity);
  useLayoutEffect(() => {
    current.current = identity;
  }, [identity]);
  const alive = useRef(true);
  const flight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [record, setRecord] = useState<{ identity: string; receipt: PolicyReceipt }>();
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async <T>(
    keys: PolicyComponent[],
    write: () => Promise<T>
  ): Promise<T | undefined> => {
    if (flight.current || !alive.current || current.current !== identity) return undefined;
    flight.current = true;
    setBusy(true);
    setRecord(undefined);
    const valid = () => alive.current && current.current === identity;
    try {
      const before =
        keys.length && accountId && appId
          ? await readRuntimePolicy(slug, 0, AbortSignal.timeout(10_000)).catch(() => undefined)
          : undefined;
      if (!valid()) return undefined;
      if (before && before.app_id !== appId)
        throw new Error('The slug now belongs to a different app. Reload before saving.');
      const result = await write();
      if (!valid()) return undefined;
      setRecord({
        identity,
        receipt: {
          id: crypto.randomUUID(),
          appId,
          acceptedAt: Date.now(),
          components: [...keys],
          baseline: policyBaseline(before, appId, keys),
          action,
        },
      });
      return result;
    } catch (error) {
      if (valid()) throw error;
      return undefined;
    } finally {
      flight.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { run, busy, receipt: record?.identity === identity ? record.receipt : undefined };
}
