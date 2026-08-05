// The directory's DATA layer — not a fetch inside a drawer.
//
// The same person appears dozens of times across a session, so profiles are cached by user id and
// shared by every surface that shows a name. Re-opening the same card inside `STALE_MS` costs no
// request at all, and a page that already knows someone's name PRIMES the cache with it, so the
// card opens instantly and the network is only used for the fields the row did not carry.
import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { type ActorSnapshotDto, type DirectoryProfileDto } from '@ecms/contracts';
import * as api from './directory-api';

/** Five minutes: long enough that navigating around never refetches, short enough to stay current. */
const STALE_MS = 5 * 60 * 1000;

export const directoryKey = (userId: string): readonly unknown[] => ['platform', 'directory', userId];

// ── Request coalescing ──────────────────────────────────────────────────────
//
// A page of 100 events by 8 people must cost ONE request, and it must cost one whether or not the
// page remembered to ask for its ids up front. Asking each row to fetch its own author is the N+1
// this layer exists to prevent — and a page-level prefetch alone does not prevent it, because the
// rows mount and start fetching before that prefetch lands.
//
// So the batching lives in the LOADER, not in the caller: every id wanted in the same tick joins
// one pending request. Nothing above this line can reintroduce the N+1 by forgetting a step.
let batch: { ids: Set<string>; promise: Promise<Map<string, DirectoryProfileDto>> } | null = null;

const loadProfiles = (userIds: string[]): Promise<Map<string, DirectoryProfileDto>> => {
  if (batch === null) {
    const ids = new Set<string>();
    batch = {
      ids,
      promise: new Promise((resolve) => {
        // One turn of the event loop: long enough for every row in a commit to add its id,
        // short enough to be invisible.
        setTimeout(() => {
          batch = null;
          const wanted = [...ids];
          resolve(
            wanted.length === 0
              ? Promise.resolve(new Map())
              : api
                  .resolveDirectoryProfiles(wanted)
                  .then((profiles) => new Map(profiles.map((p) => [p.userId, p])))
                  // A directory that is briefly unreachable must not break a page: the rows keep
                  // whatever they already showed, and the next render tries again.
                  .catch(() => new Map<string, DirectoryProfileDto>()),
          );
        }, 0);
      }),
    };
  }
  for (const id of userIds) batch.ids.add(id);
  return batch.promise;
};

export const useDirectoryProfile = (userId: string | null, enabled = true) =>
  useQuery({
    queryKey: directoryKey(userId ?? ''),
    // Joins the tick's batch instead of fetching alone — see the note above.
    queryFn: async () => (await loadProfiles([userId as string])).get(userId as string) ?? null,
    enabled: enabled && userId !== null && userId !== '',
    staleTime: STALE_MS,
    retry: false,
  });

/**
 * Seed the cache from what a row already knows. The card then opens with a name immediately and
 * only the missing fields are ever fetched.
 */
export const primeFromSnapshot = (qc: QueryClient, actor: ActorSnapshotDto | null): void => {
  if (actor === null || actor.userId === null) return;
  if (qc.getQueryData(directoryKey(actor.userId)) !== undefined) return;
  qc.setQueryData<DirectoryProfileDto>(directoryKey(actor.userId), {
    userId: actor.userId,
    displayName: actor.displayName,
    avatarFileId: actor.avatarFileId,
    jobTitle: actor.jobTitle,
    department: null,
    branch: null,
    active: actor.deletedAt === null,
    workEmail: null,
  });
};

/** Invalidate one person — for when a user record changes under us. */
export const useInvalidateDirectory = () => {
  const qc = useQueryClient();
  return (userId: string) => qc.invalidateQueries({ queryKey: directoryKey(userId) });
};

/**
 * Fill the cache for these people, skipping anyone already known. Goes through the same coalescer
 * as the rows themselves, so a page-level prefetch and the rows' own demand merge into one request
 * rather than racing each other into two.
 */
export const resolveInto = async (qc: QueryClient, userIds: string[]): Promise<void> => {
  const missing = userIds.filter((id) => qc.getQueryData(directoryKey(id)) === undefined);
  if (missing.length === 0) return;
  const found = await loadProfiles(missing);
  for (const p of found.values()) qc.setQueryData(directoryKey(p.userId), p);
};

export const useResolveDirectory = () => {
  const qc = useQueryClient();
  return async (userIds: string[]): Promise<void> => resolveInto(qc, userIds);
};

/**
 * Fill the cache for a whole page of actor ids in ONE request, before the rows render. This is the
 * sanctioned way to give a list identity: every `<ActorById />` under it is then a cache hit.
 */
export const useDirectoryPage = (userIds: (string | null)[]): void => {
  const resolve = useResolveDirectory();
  const ids = [...new Set(userIds.filter((id): id is string => id !== null && id !== ''))];
  const key = ids.sort().join(',');
  // Keyed on the id SET, not the array's identity: a fresh array every render would otherwise
  // re-request the same people on every keystroke elsewhere on the page.
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;
  useEffect(() => {
    const set = key === '' ? [] : key.split(',');
    if (set.length > 0) void resolveRef.current(set);
  }, [key]);
};
