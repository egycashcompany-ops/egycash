import { useQuery } from '@tanstack/react-query';
import { getMyPermissions } from './my-permissions-api';

/**
 * The caller's own permissions.
 *
 * Not tied to the realtime invalidation registry, and deliberately: every entity topic there is
 * gated on a permission, `platform.role` on `role.view` — which is exactly the permission the
 * reader of this screen does not hold. An ordinary employee would never receive the event, so a
 * registry entry would be a promise the channel cannot keep. What answers instead is the visit
 * itself: the answer is stale after a minute, so opening the screen re-reads it.
 */
export const useMyPermissions = () =>
  useQuery({
    queryKey: ['me', 'permissions'],
    queryFn: getMyPermissions,
    staleTime: 60_000,
  });
