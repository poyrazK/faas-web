import { useState } from 'react';
import { Plus, Trash } from 'iconoir-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/modal';
import { useConfirm } from '@/components/ui/confirm';
import { useToast } from '@/components/ui/toast';
import { InlinePhase, Panel, queryPhase } from '@/components/dashboard/primitives';
import { Pill } from '@/components/dashboard/resource-table';
import {
  useCreateEdgeRuleList,
  useDeleteEdgeRuleList,
  useEdgeRuleList,
  useEdgeRuleLists,
  useUpdateEdgeRuleList,
  type EdgeRuleList,
  type EdgeRuleListKind,
} from '@/lib/api/edge-rules';
import { useWorkspaceTarget } from '@/lib/api/workspace-apps';
import { useCapabilityStage } from '@/lib/api/capabilities';
import { ApiError, errorMessage } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { LinesField, SelectField, TextField } from './fields';

/**
 * Reusable edge-rule lists (faas ADR-963, pkg/apid/edgerules/lists.go): named
 * sets of IPs, countries, hosts, strings or ASNs that rule conditions name
 * with `in_list`. They belong to the signed-in account — `/v1/edge-rule-lists`
 * reads no workspace and company members do not reach it through an app
 * (pkg/apid/appaccess has no route for it) — so a company workspace shows
 * none. An edit reapplies every rule that uses the list within seconds and
 * records no rule-set version; a list in use cannot be deleted (409
 * `edge_rule_list_in_use`).
 */

const KINDS: { value: EdgeRuleListKind; label: string; hint: string }[] = [
  { value: 'ip', label: 'IP addresses and CIDRs', hint: 'For client_ip conditions.' },
  { value: 'country', label: 'Countries', hint: 'ISO 3166-1 alpha-2 codes, such as DE.' },
  { value: 'host', label: 'Hosts', hint: 'Exact hosts or *.suffix patterns.' },
  { value: 'string', label: 'Strings', hint: 'Exact values for path, header, cookie or query.' },
  { value: 'asn', label: 'Networks (ASN)', hint: 'Autonomous system numbers, such as AS13335.' },
];

// lists.go via edge_rule_list.go:30.
const NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function EdgeRuleLists() {
  const stage = useCapabilityStage('edge-rule-lists');
  const { account } = useAuth();
  const workspace = useWorkspaceTarget();
  const personal = workspace.ready && !workspace.org;
  // Free allows no lists (faas limits.go:5171), so it is not offered one.
  const canCreate = personal && (account?.plan ?? 'free') !== 'free';
  const lists = useEdgeRuleLists(account?.id ?? '', personal);
  const remove = useDeleteEdgeRuleList();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [editing, setEditing] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const rows = lists.data?.lists ?? [];
  const phase = queryPhase({
    error: lists.error,
    loading: lists.isPending,
    isEmpty: !rows.length,
  });

  const del = async (l: EdgeRuleList) => {
    if (
      !(await confirm({
        title: `Delete ${l.name}?`,
        description: `The list and its ${l.item_count} items are deleted. No rule uses it.`,
        confirmLabel: 'Delete list',
        destructive: true,
      }))
    )
      return;
    try {
      await remove.mutateAsync(l.name);
      toast({ kind: 'success', title: 'List deleted' });
    } catch (err) {
      toast({
        kind: 'error',
        title: 'Could not delete the list',
        ...(err instanceof ApiError && err.code === 'edge_rule_list_in_use'
          ? { description: 'A rule uses this list now. Remove it from that rule first.' }
          : {}),
        error: err,
      });
    }
  };

  return (
    <Panel
      title="Rule lists"
      description={`${stage ? `${stage} · ` : ''}IPs, countries, hosts, values or networks that many rules can share. Account-wide: an edit applies to every rule that uses the list within seconds.`}
      actions={
        canCreate ? (
          <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)}>
            <Plus className="h-3.5 w-3.5" />
            New list
          </Button>
        ) : undefined
      }
      padded={false}
    >
      {!personal ? (
        <p className="p-5 text-sm text-muted-foreground">
          {workspace.ready
            ? `Rule lists belong to your personal account, so ${workspace.label} has none to show. Switch to Personal to manage them.`
            : 'Checking the workspace…'}
        </p>
      ) : phase !== 'ready' ? (
        <div className="p-5">
          <InlinePhase
            phase={phase}
            error={lists.error}
            loadingMessage="Reading lists…"
            emptyMessage={
              canCreate
                ? 'No lists yet.'
                : 'No lists yet. Rule lists are on Hobby and above; the Free plan has none.'
            }
            onRetry={() => void lists.refetch()}
          />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border">
          {rows.map((l) => (
            <li
              key={l.id}
              role="group"
              aria-label={l.name}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-2.5"
            >
              <span className="font-mono text-sm">{l.name}</span>
              <Pill label={l.kind} />
              <span className="text-xs text-muted-foreground">
                {l.item_count} {l.item_count === 1 ? 'item' : 'items'}
              </span>
              <span className="text-xs text-muted-foreground">
                {l.referenced_by.length
                  ? `Used by ${l.referenced_by.length} ${l.referenced_by.length === 1 ? 'rule' : 'rules'}`
                  : 'Unused'}
              </span>
              {l.description && (
                <span className="min-w-0 basis-full truncate text-xs text-muted-foreground">
                  {l.description}
                </span>
              )}
              <span className="ml-auto flex items-center gap-3">
                <button
                  type="button"
                  aria-label={`Edit ${l.name}`}
                  onClick={() => setEditing(l.name)}
                  className="text-xs text-brand transition-colors hover:text-brand-hover"
                >
                  Edit
                </button>
                <button
                  type="button"
                  aria-label={`Delete ${l.name}`}
                  title={
                    l.referenced_by.length
                      ? 'Remove it from the rules that use it first'
                      : undefined
                  }
                  disabled={l.referenced_by.length > 0}
                  onClick={() => void del(l)}
                  className="text-muted-foreground transition-colors hover:text-foreground disabled:opacity-30"
                >
                  <Trash className="h-3.5 w-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
      {creating && <ListDialog onClose={() => setCreating(false)} />}
      {editing && (
        <ListDialog
          key={editing}
          name={editing}
          accountId={account?.id ?? ''}
          onClose={() => setEditing(null)}
        />
      )}
    </Panel>
  );
}

function ListDialog({
  name: editingName,
  accountId = '',
  onClose,
}: {
  name?: string;
  accountId?: string;
  onClose: () => void;
}) {
  const existing = useEdgeRuleList(accountId, editingName ?? null);
  const create = useCreateEdgeRuleList();
  const update = useUpdateEdgeRuleList();
  const confirm = useConfirm();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<EdgeRuleListKind>('ip');
  const [description, setDescription] = useState<string | null>(null);
  const [items, setItems] = useState<string[] | null>(null);
  const [nameError, setNameError] = useState<string>();
  const [problem, setProblem] = useState<unknown>(null);
  const list = existing.data;
  const loaded = !editingName || list !== undefined;
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setProblem(null);
    if (!editingName) {
      if (!NAME.test(name)) {
        setNameError(
          'Up to 64 lowercase letters, digits, _ and -, starting with a letter or digit.'
        );
        return;
      }
      setNameError(undefined);
      try {
        await create.mutateAsync({
          name,
          kind,
          ...(description?.trim() ? { description: description.trim() } : {}),
          items: items ?? [],
        });
        toast({ kind: 'success', title: 'List created' });
        onClose();
      } catch (err) {
        setProblem(err);
      }
      return;
    }
    if (!list) return;
    const used = list.referenced_by.length;
    if (
      used &&
      !(await confirm({
        title: `Change ${list.name}?`,
        description: `${used} ${used === 1 ? 'rule uses' : 'rules use'} this list. The new items apply to ${used === 1 ? 'it' : 'them'} within seconds, for every request those rules match.`,
        confirmLabel: 'Save list',
      }))
    )
      return;
    try {
      await update.mutateAsync({
        name: list.name,
        ...(items !== null ? { items } : {}),
        ...(description !== null ? { description: description.trim() } : {}),
      });
      toast({ kind: 'success', title: 'List saved' });
      onClose();
    } catch (err) {
      setProblem(err);
    }
  };

  const kindHint = KINDS.find((k) => k.value === (list?.kind ?? kind))?.hint;
  return (
    <Modal
      open
      onClose={onClose}
      title={editingName ?? 'New list'}
      description={
        editingName
          ? `${KINDS.find((k) => k.value === list?.kind)?.label ?? ''}. Items are stored deduplicated and sorted.`
          : 'Items are checked for the kind and stored deduplicated and sorted.'
      }
      width="max-w-xl"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" disabled={pending || !loaded} onClick={() => void submit()}>
            {pending ? 'Saving…' : editingName ? 'Save list' : 'Create list'}
          </Button>
        </>
      }
    >
      {!loaded ? (
        <InlinePhase
          phase={queryPhase({ error: existing.error, loading: existing.isPending })}
          error={existing.error}
          loadingMessage="Reading the list…"
        />
      ) : (
        <div className="flex flex-col gap-4">
          {problem != null && (
            <p role="alert" className="text-xs text-[color:var(--status-critical)]">
              {errorMessage(problem)}
            </p>
          )}
          {!editingName && (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField
                label="Name"
                hint="Rules name the list by this; it cannot change."
                error={nameError}
                value={name}
                onChange={setName}
                placeholder="office-ips"
              />
              <SelectField
                label="Kind"
                value={kind}
                onChange={setKind}
                options={KINDS.map((k) => ({ value: k.value, label: k.label }))}
              />
            </div>
          )}
          <TextField
            label="Description"
            hint="Optional, up to 500 characters."
            mono={false}
            value={description ?? list?.description ?? ''}
            onChange={setDescription}
          />
          <LinesField
            label="Items"
            hint={`One per line. ${kindHint ?? ''}`}
            rows={6}
            value={items ?? list?.items ?? []}
            onChange={setItems}
          />
        </div>
      )}
    </Modal>
  );
}
