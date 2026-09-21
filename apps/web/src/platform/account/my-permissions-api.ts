// «صلاحياتي» — what the signed-in account may do, read by that account itself.
//
// A separate endpoint from the administration one on purpose. `GET /platform/users/:id/
// effective-permissions` is gated on `user.view` + `role.view`, which an ordinary employee holds
// neither of — and must not, since they are the permissions that let somebody read OTHER people's
// authority. `GET /platform/me/permissions` takes no id, so it can only ever answer for the caller.
import { type MyPermissionsDto } from '@ecms/contracts';
import { get } from '../../shared/lib/api-client';

export const getMyPermissions = (): Promise<MyPermissionsDto> =>
  get<MyPermissionsDto>('/platform/me/permissions');
