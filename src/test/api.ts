import { vi } from 'vitest';
import { api } from '@/lib/api/client';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type Call = (path: string, init?: unknown) => Promise<unknown>;

/**
 * Spying on the client's methods directly instantiates its generic over the
 * whole generated `paths` type; with the full upstream spec that can exceed
 * the compiler's depth limit (TS2589). This spies through a plain call
 * signature instead. Path strings are still the real ones.
 */
export function spyApi(method: Method) {
  return vi.spyOn(api as unknown as Record<Method, Call>, method);
}

/** `vi.mocked` on a client method of a module-mocked client, through the same plain signature. */
export function mockedApi(method: Method) {
  return vi.mocked((api as unknown as Record<Method, Call>)[method]);
}
