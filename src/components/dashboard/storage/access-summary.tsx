import { useId, useState } from 'react';
import { cn } from '@/lib/utils';
import type { AccessConnection, Permission } from '@/lib/storage-access';
import { AccessMap } from './access-map';

const VERB: Record<Permission, string> = {
  read: 'reads',
  write: 'writes',
  read_write: 'reads and writes',
};

const LANE: Record<AccessConnection['lane'], string> = {
  app: 'App code',
  'api-key': 'API key',
  's3-key': 'S3 key',
};

const WORDS = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const count = (n: number, noun: string) =>
  `${n < WORDS.length ? WORDS[n] : n} ${noun}${n === 1 ? '' : 's'}`;
const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** "your app", "2 keys", "your app and one key". Empty when nobody is in the group. */
function who(group: AccessConnection[]): string {
  const app = group.some((c) => c.lane === 'app');
  const keys = group.filter((c) => c.lane !== 'app').length;
  const parts = [...(app ? ['your app'] : []), ...(keys ? [count(keys, 'key')] : [])];
  return parts.join(' and ');
}

/**
 * Who can reach a bucket, as one or two plain sentences built from its
 * bindings, grants and S3 keys: "Your app and 2 keys can read these files.
 * One key can also change them."
 */
export function accessSentence(connections: AccessConnection[]): {
  lead: string;
  rest: string;
} {
  if (connections.length === 0) return { lead: 'Nothing can reach these files yet.', rest: '' };
  const readers = connections.filter((c) => c.permission !== 'write');
  const writers = connections.filter((c) => c.permission !== 'read');
  const lead = readers.length ? `${capital(who(readers))} can read these files.` : '';
  if (!writers.length) return { lead, rest: '' };
  // "also" only when everyone who can change the files can read them too.
  if (!readers.length)
    return {
      lead: `${capital(who(writers))} can add or change files here but not read them.`,
      rest: '',
    };
  const also = writers.every((c) => c.permission === 'read_write');
  return { lead, rest: `${capital(who(writers))} can ${also ? 'also ' : ''}change them.` };
}

/**
 * The bucket's access in words, a chip per thing that holds a key, and the
 * cable map behind "Show map" for whoever wants the picture.
 */
export function AccessSummary({
  bucket,
  app,
  connections,
  loading,
  failed,
  onManage,
}: {
  bucket: string;
  app: string;
  connections: AccessConnection[];
  /** Any of the three access reads has not answered yet. */
  loading: boolean;
  /** Any of the three access reads failed; the sentence would undercount. */
  failed: boolean;
  /** Where grants, bindings and keys are edited today. */
  onManage: () => void;
}) {
  const [map, setMap] = useState(false);
  const mapId = useId();
  const { lead, rest } = accessSentence(connections);
  return (
    <div className="flex flex-col gap-3">
      {loading ? (
        <p className="text-sm text-muted-foreground">Checking who can reach these files…</p>
      ) : failed ? (
        <p className="text-sm text-muted-foreground">
          Could not read everything that can reach these files. Open Manage access to see each one.
        </p>
      ) : (
        <p className="text-[0.9375rem] leading-relaxed text-foreground">
          {lead} {rest && <span className="text-muted-foreground">{rest}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!loading && connections.length > 0 && (
          <ul aria-label={`What can reach ${bucket}`} className="flex flex-wrap gap-2">
            {connections.map((c) => (
              <li
                key={c.id}
                title={`${LANE[c.lane]}: ${c.label}`}
                data-permission={c.permission}
                className="storage-grant inline-flex max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs"
              >
                <span aria-hidden="true" className="storage-grant__dot size-1.5 rounded-full" />
                <span className="min-w-0 truncate">
                  {c.lane === 'app' ? `${app}'s code` : c.label}
                </span>
                <span className="shrink-0 text-muted-foreground">
                  · {c.pending ? 'rotating key' : VERB[c.permission]}
                </span>
              </li>
            ))}
          </ul>
        )}
        <span className="flex items-center gap-3 text-xs">
          <button
            type="button"
            onClick={onManage}
            className="pressable rounded text-[color:var(--brand)] underline-offset-4 hover:underline"
          >
            {connections.length === 0 && !loading ? `Connect ${app}` : 'Manage access'}
          </button>
          <button
            type="button"
            aria-expanded={map}
            aria-controls={mapId}
            onClick={() => setMap(!map)}
            className="pressable rounded text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {map ? 'Hide map' : 'Show map'}
          </button>
        </span>
      </div>
      <div id={mapId} className={cn(!map && 'hidden')}>
        {map && (
          <AccessMap
            bucket={bucket}
            app={app}
            connections={connections}
            onSelect={onManage}
            onConnect={onManage}
          />
        )}
      </div>
    </div>
  );
}
