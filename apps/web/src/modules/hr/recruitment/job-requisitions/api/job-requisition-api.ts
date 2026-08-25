// The job-requisition endpoints, typed from the contracts (P-HR-REQ).
import {
  type CloseJobRequisition,
  type CreateJobRequisition,
  type DecideJobRequisition,
  type JobRequisitionDto,
  type JobRequisitionFillDto,
  type ListJobRequisitionsQuery,
  type Paginated,
  type UpdateJobRequisition,
} from '@ecms/contracts';
import { buildQuery, del, get, getPage, patch, post } from '../../../../../shared/lib/api-client';

const BASE = '/hr/job-requisitions';

export const listJobRequisitions = (
  query: Partial<ListJobRequisitionsQuery>,
): Promise<Paginated<JobRequisitionDto>> =>
  getPage<JobRequisitionDto>(`${BASE}${buildQuery({ ...query })}`);

export const getJobRequisition = (id: string): Promise<JobRequisitionDto> =>
  get<JobRequisitionDto>(`${BASE}/${id}`);

/** The hires recorded against one requisition — the derived count, itemised (D-REQ-13). */
export const listJobRequisitionFills = (id: string): Promise<JobRequisitionFillDto[]> =>
  get<JobRequisitionFillDto[]>(`${BASE}/${id}/fills`);

export const createJobRequisition = (body: CreateJobRequisition): Promise<JobRequisitionDto> =>
  post<JobRequisitionDto>(BASE, body);

export const updateJobRequisition = (
  id: string,
  body: UpdateJobRequisition,
): Promise<JobRequisitionDto> => patch<JobRequisitionDto>(`${BASE}/${id}`, body);

export const submitJobRequisition = (id: string, version: number): Promise<JobRequisitionDto> =>
  post<JobRequisitionDto>(`${BASE}/${id}/submit`, { version });

/**
 * One decision, either step. The step is not sent: it is wherever the requisition stands, so the
 * screen cannot aim at the HR step while the manager step is still open.
 */
export const decideJobRequisition = (
  id: string,
  body: DecideJobRequisition,
): Promise<JobRequisitionDto> => post<JobRequisitionDto>(`${BASE}/${id}/decision`, body);

export const closeJobRequisition = (
  id: string,
  body: CloseJobRequisition,
): Promise<JobRequisitionDto> => post<JobRequisitionDto>(`${BASE}/${id}/close`, body);

export const cancelJobRequisition = (
  id: string,
  body: CloseJobRequisition,
): Promise<JobRequisitionDto> => post<JobRequisitionDto>(`${BASE}/${id}/cancel`, body);

export const deleteJobRequisition = (id: string): Promise<void> => del<void>(`${BASE}/${id}`);
