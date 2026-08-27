// HR's side of the candidate documents. The staff surface, not the portal's.
//
// Every call here names an applicant, which is exactly the difference from
// `applicant-portal-api.ts`: a reviewer works through other people's files by definition, and it
// is a permission that lets them, not a session that happens to be theirs.
import {
  type ApplicantDocumentSetDto,
  type Paginated,
  type ReviewApplicantDocument,
} from '@ecms/contracts';
import { buildQuery, get, getPage, post } from '../../../../../shared/lib/api-client';

const BASE = '/hr/applicant-documents';

export interface ApplicantDocumentSetParams {
  page: number;
  pageSize: number;
  pendingOnly?: boolean;
  search?: string;
  [key: string]: string | number | boolean | undefined;
}

export const fetchApplicantDocumentSets = (
  params: ApplicantDocumentSetParams,
): Promise<Paginated<ApplicantDocumentSetDto>> => getPage(`${BASE}${buildQuery(params)}`);

export const fetchApplicantDocumentSet = (applicantId: string): Promise<ApplicantDocumentSetDto> =>
  get(`${BASE}/${applicantId}`);

export const reviewApplicantDocument = (input: {
  applicantId: string;
  typeId: string;
  body: ReviewApplicantDocument;
}): Promise<ApplicantDocumentSetDto> =>
  post(`${BASE}/${input.applicantId}/documents/${input.typeId}/review`, input.body);
