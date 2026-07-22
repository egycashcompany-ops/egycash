// The caller's own navigation, resolved by the backend from the applications assigned to their
// department and granted to them directly (GET /platform/me/applications). The sidebar renders this
// verbatim — categories and applications are never hardcoded on the client.
import { type MyApplicationCategoryDto } from '@ecms/contracts';
import { get } from '../../shared/lib/api-client';

export const getMyApplications = (): Promise<MyApplicationCategoryDto[]> =>
  get<MyApplicationCategoryDto[]>('/platform/me/applications');
