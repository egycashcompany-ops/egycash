// Delegated grants (ADR-032): the three calls the «الصلاحيات» tab makes.
//
// Platform-level rather than inside a module, because two screens mount the same panel — the
// employee profile in HR and the account page in System Administration — and modules never import
// each other.
import {
  type DelegationCatalogDto,
  type SetDelegation,
  type UserDelegationsDto,
} from '@ecms/contracts';
import { get, put } from '../../../shared/lib/api-client';

/** The caller's own ceiling: the sites they delegate in, and the keys they may hand out in each. */
export const getMyDelegationCatalog = (): Promise<DelegationCatalogDto> =>
  get<DelegationCatalogDto>('/platform/delegations/me');

export const getUserDelegations = (userId: string): Promise<UserDelegationsDto> =>
  get<UserDelegationsDto>(`/platform/delegations/users/${userId}`);

/** Replace one unit's table — a department in a branch, or the whole branch. An empty list removes it. */
export const setUserDelegation = (userId: string, body: SetDelegation): Promise<UserDelegationsDto> =>
  put<UserDelegationsDto>(`/platform/delegations/users/${userId}/grants`, body);
