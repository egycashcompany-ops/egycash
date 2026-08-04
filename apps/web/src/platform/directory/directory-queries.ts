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

export const useDirectoryProfile = (userId: string | null, enabled = true) =>
  useQuery({
    queryKey: directoryKey(userId ?? ''),
    queryFn: () => api.getDirectoryProfile(userId as string),
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

export const useResolveDirectory = () => {
  const qc = useQueryClient();
  return async (userIds: string[]): Promise<void> => {
    const missing = userIds.filter((id) => qc.getQueryData(directoryKey(id)) === undefined);
    if (missing.length === 0) return;
    // One request for everyone still unknown, then each lands under its own key.
    const profiles = await api.resolveDirectoryProfiles(missing);
    for (const p of profiles) qc.setQueryData(directoryKey(p.userId), p);
  };
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
