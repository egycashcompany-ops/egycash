// Medical api/ surface (ADR-013 — P-HR-MED, phase M2).
import {
  type ListMedicalProfilesQuery,
  type MedicalProfileDto,
  type Paginated,
  type UpsertMedicalProfile,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patch,
  type QueryParams,
} from '../../../../shared/lib/api-client';

const PROFILES = '/hr/medical/profiles';

export const listMedicalProfiles = (params: QueryParams): Promise<Paginated<MedicalProfileDto>> =>
  getPage<MedicalProfileDto>(`${PROFILES}${buildQuery(params)}`);

/** Null is an ordinary answer — nobody has recorded anything about this person yet. */
export const getMedicalProfile = (employeeId: string): Promise<MedicalProfileDto | null> =>
  get<MedicalProfileDto | null>(`${PROFILES}/${employeeId}`);

/** D5 — the caller's own record, in full, needing no key. */
export const getMyMedicalProfile = (): Promise<MedicalProfileDto | null> =>
  get<MedicalProfileDto | null>(`${PROFILES}/me`);

export const upsertMedicalProfile = (
  employeeId: string,
  body: UpsertMedicalProfile,
): Promise<MedicalProfileDto> => patch<MedicalProfileDto>(`${PROFILES}/${employeeId}`, body);

export type { ListMedicalProfilesQuery };
