// Screening feature api/ surface (ADR-013). Uses the shared api-client; the hooks in
// screening-queries.ts wrap these in TanStack Query with keys + invalidation.
import {
  type AddScreeningNote,
  type CreateScreening,
  type DecideScreening,
  type Paginated,
  type ScreeningDto,
  type BulkActionResultDto,
  type BulkScreenings,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patchWorkflow,
  post,
  postWorkflow,
} from '../../../../../shared/lib/api-client';

export type ScreeningListParams = Record<string, string | number | boolean | undefined | null>;

export const listScreenings = (params: ScreeningListParams): Promise<Paginated<ScreeningDto>> =>
  getPage<ScreeningDto>(`/hr/screenings${buildQuery(params)}`);

/** Live applicants who registered but have no screening yet (pipeline entry). */
export const getScreening = (id: string): Promise<ScreeningDto> => get<ScreeningDto>(`/hr/screenings/${id}`);

export const createScreening = (body: CreateScreening): Promise<ScreeningDto> =>
  postWorkflow<ScreeningDto>('/hr/screenings', body);

export const addScreeningNote = (id: string, body: AddScreeningNote): Promise<ScreeningDto> =>
  postWorkflow<ScreeningDto>(`/hr/screenings/${id}/notes`, body);

export const decideScreening = (id: string, body: DecideScreening): Promise<ScreeningDto> =>
  postWorkflow<ScreeningDto>(`/hr/screenings/${id}/decide`, body);

/** Edit an already-decided screening (D7: a decision is not final; fully audited). */
export const redecideScreening = (id: string, body: DecideScreening): Promise<ScreeningDto> =>
  patchWorkflow<ScreeningDto>(`/hr/screenings/${id}/decision`, body);

/** Bulk approve/reject a screening selection (RW17/I4) — answers a partial-success envelope. */
export const bulkScreenings = (body: BulkScreenings): Promise<BulkActionResultDto> =>
  post<BulkActionResultDto>('/hr/screenings/bulk', body);
