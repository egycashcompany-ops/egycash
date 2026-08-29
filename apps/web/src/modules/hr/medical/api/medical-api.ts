// Medical api/ surface (ADR-013 — P-HR-MED, phase M2).
import {
  type ListMedicalProfilesQuery,
  type EndInsuranceCard,
  type InsuranceCardDto,
  type IssueInsuranceCard,
  type MedicalEventDto,
  type MedicalProfileDto,
  type Paginated,
  type RecordMedicalEvent,
  type UpdateInsuranceCard,
  type UpsertMedicalProfile,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patch,
  post,
  upload,
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

const EVENTS = '/hr/medical/events';

export const listMedicalEvents = (params: QueryParams): Promise<Paginated<MedicalEventDto>> =>
  getPage<MedicalEventDto>(`${EVENTS}${buildQuery(params)}`);

/**
 * Recording one — multipart, because the certificate arrives WITH the event.
 *
 * There is no «attach a document later» call and there will not be one: the row can never be
 * written again (D9), so a late upload would have nowhere to record the link.
 */
export const recordMedicalEvent = (
  body: RecordMedicalEvent,
  file: File | null,
): Promise<MedicalEventDto> => {
  const form = new FormData();
  // Dates as ISO strings — multipart carries text, and the server coerces with `z.coerce.date()`.
  for (const [key, value] of Object.entries(body)) {
    if (value === undefined || value === null) continue;
    form.append(key, value instanceof Date ? value.toISOString() : String(value));
  }
  if (file !== null) form.append('file', file);
  return upload<MedicalEventDto>(EVENTS, form);
};

const INSURANCE = '/hr/medical/insurance';

export const listInsuranceCards = (params: QueryParams): Promise<Paginated<InsuranceCardDto>> =>
  getPage<InsuranceCardDto>(`${INSURANCE}${buildQuery(params)}`);

export const issueInsuranceCard = (body: IssueInsuranceCard): Promise<InsuranceCardDto> =>
  post<InsuranceCardDto>(INSURANCE, body);

export const updateInsuranceCard = (
  id: string,
  body: UpdateInsuranceCard,
): Promise<InsuranceCardDto> => patch<InsuranceCardDto>(`${INSURANCE}/${id}`, body);

/** There is no `renew` — a renewal ends one card and issues another (see the router's note). */
export const endInsuranceCard = (id: string, body: EndInsuranceCard): Promise<InsuranceCardDto> =>
  post<InsuranceCardDto>(`${INSURANCE}/${id}/end`, body);
