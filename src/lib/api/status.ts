import { useQuery } from '@tanstack/react-query';
import type { components } from './schema';
import { api, unwrap } from './client';

type S = components['schemas'];

export type PublicStatusState = S['PublicStatusOverview']['overall_status'];
export type PublicStatusDaily = S['PublicStatusDaily'];
export type PublicStatusComponent = S['PublicStatusComponent'];
export type PublicStatusIndicator = S['PublicStatusIndicator'];
export type PublicStatusUpdate = S['PublicStatusUpdate'];
export type PublicStatusEvent = S['PublicStatusEvent'];
export type PublicStatusOverview = S['PublicStatusOverview'];

export function statusRefetchInterval(): 30000 | false {
  if (typeof document === 'undefined' || document.visibilityState !== 'visible') return false;
  return 30_000;
}

export const getPublicStatus = () => unwrap(api.GET('/v1/status', {}));

export const getPublicStatusIncident = (id: string) =>
  unwrap(
    api.GET('/v1/status/incidents/{public_id}', {
      params: { path: { public_id: id } },
    })
  );

export function usePublicStatus() {
  return useQuery({
    queryKey: ['public-status'],
    queryFn: getPublicStatus,
    staleTime: 15_000,
    retry: false,
    refetchInterval: statusRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}

export function usePublicStatusIncident(id: string) {
  return useQuery({
    queryKey: ['public-status', 'incident', id],
    queryFn: () => getPublicStatusIncident(id),
    staleTime: 15_000,
    retry: false,
    refetchInterval: statusRefetchInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
  });
}
