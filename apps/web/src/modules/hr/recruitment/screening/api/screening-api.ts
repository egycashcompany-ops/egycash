// Screening feature api/ surface (ADR-013). Uses the shared api-client; the hooks in
// screening-queries.ts wrap these in TanStack Query with keys + invalidation.
import {
  type AddScreeningNote,
  type AwaitingScreeningDto,
  type CreateScreening,
  type DecideScreening,
  type Paginated,
  type ScreeningDto,
} from '@ecms/contracts';
import { buildQuery, get, getPage, post } from '../../../../../shared/lib/api-client';

export type ScreeningListParams = Record<string, string | number | boolean | undefined | null>;

export const listScreenings = (params: ScreeningListParams): Promise<Paginated<ScreeningDto>> =>
  getPage<ScreeningDto>(`/hr/screenings${buildQuery(params)}`);

/** Live applicants who registered but have no screening yet (pipeline entry). */
export const listAwaitingScreenings = (
  params: ScreeningListParams,
): Promise<AwaitingScreeningDto[]> =>
  get<AwaitingScreeningDto[]>(`/hr/screenings/awaiting${buildQuery(params)}`);

export const getScreening = (id: string): Promise<ScreeningDto> => get<ScreeningDto>(`/hr/screenings/${id}`);

export const createScreening = (body: CreateScreening): Promise<ScreeningDto> =>
  post<ScreeningDto>('/hr/screenings', body);

export const addScreeningNote = (id: string, body: AddScreeningNote): Promise<ScreeningDto> =>
  post<ScreeningDto>(`/hr/screenings/${id}/notes`, body);

export const decideScreening = (id: string, body: DecideScreening): Promise<ScreeningDto> =>
  post<ScreeningDto>(`/hr/screenings/${id}/decide`, body);
