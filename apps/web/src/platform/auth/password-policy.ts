// The password policy, read from the server.
//
// `GET /auth/password-policy` is public because `/activate` — the one screen where somebody chooses
// a password for the first time — has no session. It answers only the two configurable values, both
// organization-level, so there is nothing per-account in it.
//
// **Nothing here decides anything.** The values describe what `assertPasswordPolicy` will do; the
// rules are `evaluatePasswordPolicy` from the contracts, which is the same function the server
// derives its refusal from. A client that could not read the policy shows no checklist and submits
// anyway — the server still refuses, with the message it always did.
import { useQuery } from '@tanstack/react-query';
import { type PasswordPolicyDto } from '@ecms/contracts';
import { get } from '../../shared/lib/api-client';

export const passwordPolicyKey = ['platform', 'auth', 'password-policy'] as const;

/**
 * Cached for the session: the policy changes only when an administrator edits it in
 * `/system/settings`, and re-fetching it on every keystroke-heavy screen would be noise. `retry:
 * false` so a screen never sits waiting on it — the checklist is an aid, not a gate.
 */
export const usePasswordPolicy = () =>
  useQuery<PasswordPolicyDto>({
    queryKey: passwordPolicyKey,
    queryFn: () => get<PasswordPolicyDto>('/auth/password-policy'),
    staleTime: Infinity,
    retry: false,
  });
