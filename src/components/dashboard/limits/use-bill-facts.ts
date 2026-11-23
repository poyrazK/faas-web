import type { components } from '@/lib/api/schema';
import { useCapabilityAccess } from '@/lib/api/capabilities';
import { useEgressOverage, useOrgEgressOverage, useOrgObjectStorageUsage } from '@/lib/api/limits';
import { useOrgOverageCap } from '@/lib/api/org-billing';
import { useAccountUsage, useOrgs, useOverageCap, useUsageSummary } from '@/lib/api/queries';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useAuth } from '@/lib/auth';
import type { BillFacts } from '@/lib/limits';
import { queryPhase, type QueryPhase } from '../primitives';

type Egress = components['schemas']['EgressOverageResponse'];
type Plan = NonNullable<BillFacts['plan']>;

interface Section {
  phase: QueryPhase;
  error: unknown;
  retry: () => void;
}

/** Everything the Your bill rows and the status strip read, for one workspace. */
export interface BillData {
  facts: BillFacts;
  /** The company's slug in a company workspace, else null. */
  org: string | null;
  workspaceLabel: string;
  /** False while any shown read is still loading: the strip waits rather than guess. */
  settled: boolean;
  egress?: Egress;
  showPostgres: boolean;
  sections: { cap: Section; egress: Section; storage: Section; usage: Section };
}

const PLANS: readonly Plan[] = ['free', 'hobby', 'pro', 'scale'];
const asPlan = (value: unknown): Plan | undefined =>
  PLANS.includes(value as Plan) ? (value as Plan) : undefined;

/**
 * Reads one subject: the signed-in account, or in a company workspace the
 * organization. Personal reads are disabled in a company workspace, so its
 * figures can never show there. faas reports no organization overage or
 * egress use, so those stay absent rather than borrowed.
 */
export function useBillFacts(): BillData {
  const workspace = useWorkspaceTarget();
  const { account } = useAuth();
  const bound = workspace.ready;
  const org = workspace.org;
  const personal = bound && !org;
  // Storage counts only once the registry says it's on; while the registry
  // loads the strip waits, and a registry that failed leaves storage unknown.
  const storageAccess = useCapabilityAccess('object-storage').access;
  const storageOn = storageAccess === 'on';
  const storageUnsure = storageAccess === 'loading' || storageAccess === 'registry-error';
  const showPostgres = useCapabilityAccess('managed-postgres').access === 'on';

  const personalCap = useOverageCap({ enabled: personal });
  const companyCap = useOrgOverageCap(org ?? '', { enabled: bound });
  const summary = useUsageSummary({ enabled: personal });
  const personalEgress = useEgressOverage({ enabled: personal });
  const companyEgress = useOrgEgressOverage(org ?? '', { enabled: bound });
  const personalStorage = useAccountUsage({ enabled: personal && storageOn });
  const companyStorage = useOrgObjectStorageUsage(org ?? '', { enabled: bound && storageOn });
  const orgs = useOrgs({ enabled: Boolean(org) });

  const cap = org ? companyCap : personalCap;
  const egress = org ? companyEgress : personalEgress;
  const storageQuery = org ? companyStorage : personalStorage;
  const storage = org
    ? companyStorage.data
    : (personalStorage.data as { object_storage?: typeof companyStorage.data } | undefined)
        ?.object_storage;

  const section = (query: {
    error: unknown;
    isPending: boolean;
    refetch: () => unknown;
  }): Section => ({
    phase: queryPhase({ error: query.error, loading: bound && query.isPending }),
    error: query.error,
    retry: () => void query.refetch(),
  });
  const sections = {
    cap: section(cap),
    egress: section(egress),
    storage: section(storageQuery),
    // Overage, egress use and compute come from the personal usage summary.
    usage: section(org ? { error: null, isPending: false, refetch: () => undefined } : summary),
  };

  const plan = org
    ? asPlan(orgs.data?.orgs.find((entry) => entry.slug === org)?.plan)
    : asPlan(account?.plan);
  const summaryData = !org && summary.data ? summary.data : undefined;

  const facts: BillFacts = {
    workspace: org ? 'org' : 'personal',
    ...(plan ? { plan } : {}),
    cap:
      sections.cap.phase === 'ready' && cap.data
        ? {
            state: 'ready',
            capCents: cap.data.overage_cap_cents ?? null,
            ...(summaryData ? { overageCents: summaryData.overage_cents } : {}),
          }
        : { state: 'unknown' },
    egress:
      sections.egress.phase === 'ready' && egress.data
        ? {
            state: 'ready',
            enabled: egress.data.enabled,
            ...(egress.data.billing === 'off' ? { billingOff: true } : {}),
            electable: egress.data.electable,
            includedGb: summaryData?.included_egress_gb ?? egress.data.included_gib,
            ...(summaryData ? { usedGb: summaryData.used_egress_gb } : {}),
          }
        : { state: 'unknown' },
    storage: !storageOn
      ? storageUnsure
        ? { state: 'unknown' }
        : { state: 'hidden' }
      : sections.storage.phase === 'ready' && storage
        ? {
            state: 'ready',
            usedBytes: storage.usage.observed_bytes,
            ceilingBytes: storage.policy.max_account_bytes,
            ...(storage.over_ceiling
              ? {
                  overCeiling: {
                    excessBytes: storage.over_ceiling.excess_bytes,
                    deletionAt: storage.over_ceiling.deletion_scheduled_at,
                  },
                }
              : {}),
          }
        : { state: 'unknown' },
    ...(summaryData
      ? {
          compute: {
            usedGbHours: summaryData.used_gb_hours,
            includedGbHours: summaryData.included_gb_hours,
          },
        }
      : {}),
    ...(!org && (sections.usage.phase === 'error' || sections.usage.phase === 'unreachable')
      ? { usageUnknown: true }
      : {}),
  };

  const shown = [
    sections.cap,
    sections.egress,
    ...(org ? [] : [sections.usage]),
    ...(storageOn ? [sections.storage] : []),
  ];
  return {
    facts,
    org,
    workspaceLabel: workspace.label,
    settled: bound && storageAccess !== 'loading' && shown.every((s) => s.phase !== 'loading'),
    ...(egress.data ? { egress: egress.data } : {}),
    showPostgres,
    sections,
  };
}
