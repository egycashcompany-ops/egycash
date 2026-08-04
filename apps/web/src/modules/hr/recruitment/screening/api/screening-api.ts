// Screening feature api/ surface (ADR-013). Uses the shared api-client; the hooks in
// screening-queries.ts wrap these in TanStack Query.
//
// I6 — a workflow action answers with the whole envelope, and the type says so: the caller gets
// `{ data, workflow, timeline, counters }`, not just the screening.
import {
  type AddScreeningNote,
  type BulkWorkflowResultDto,
  type CreateScreening,
  type DecideScreening,
  type Paginated,
  type ScreeningDto,
  type WorkflowEnvelopeDto,
  type BulkScreenings,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  patchWorkflow,
  post,
  postWorkflow,
  type QueryParams,
} from '../../../../../shared/lib/api-client';

export type ScreeningListParams = QueryParams;

type ScreeningEnvelope = Promise<WorkflowEnvelopeDto<ScreeningDto>>;

export const listScreenings = (params: ScreeningListParams): Promise<Paginated<ScreeningDto>> =>
  getPage<ScreeningDto>(`/hr/screenings${buildQuery(params)}`);

/** Live applicants who registered but have no screening yet (pipeline entry). */
export const getScreening = (id: string): Promise<ScreeningDto> => get<ScreeningDto>(`/hr/screenings/${id}`);

export const createScreening = (body: CreateScreening): ScreeningEnvelope =>
  postWorkflow<ScreeningDto>('/hr/screenings', body);

export const addScreeningNote = (id: string, body: AddScreeningNote): ScreeningEnvelope =>
  postWorkflow<ScreeningDto>(`/hr/screenings/${id}/notes`, body);

export const decideScreening = (id: string, body: DecideScreening): ScreeningEnvelope =>
  postWorkflow<ScreeningDto>(`/hr/screenings/${id}/decide`, body);

/** Edit an already-decided screening (D7: a decision is not final; fully audited). */
export const redecideScreening = (id: string, body: DecideScreening): ScreeningEnvelope =>
  patchWorkflow<ScreeningDto>(`/hr/screenings/${id}/decision`, body);

/** Bulk approve/reject a screening selection (RW17/I4) — partial success + what the batch wrote. */
export const bulkScreenings = (body: BulkScreenings): Promise<BulkWorkflowResultDto> =>
  post<BulkWorkflowResultDto>('/hr/screenings/bulk', body);
