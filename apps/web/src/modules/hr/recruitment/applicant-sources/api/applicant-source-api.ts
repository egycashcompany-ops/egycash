// The applicant-source catalog: the platforms candidates come from.
//
// The link belonging to each source is NOT here. A link lives on the intake form document, so
// publishing one goes through the form's own endpoints — see `recruitment-form-api`. Duplicating
// those calls would give the two screens two ways to publish the same link.
import {
  type ApplicantSourceDto,
  type CreateApplicantSource,
  type Paginated,
  type UpdateApplicantSource,
} from '@ecms/contracts';
import { get, patch, post } from '../../../../../shared/lib/api-client';

/** No `active` filter: the management screen is the one place that must show disabled ones too. */
export const listApplicantSources = (): Promise<Paginated<ApplicantSourceDto>> =>
  get<Paginated<ApplicantSourceDto>>('/hr/applicant-sources?pageSize=100&sortBy=key&sortDir=asc');

export const createApplicantSource = (body: CreateApplicantSource): Promise<ApplicantSourceDto> =>
  post<ApplicantSourceDto>('/hr/applicant-sources', body);

export const updateApplicantSource = (
  id: string,
  body: UpdateApplicantSource,
): Promise<ApplicantSourceDto> => patch<ApplicantSourceDto>(`/hr/applicant-sources/${id}`, body);
