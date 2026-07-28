// Hiring Documents feature api/ surface (ADR-013). Endpoints match the backend contract exactly
// (`/hr/hiring-documents`, `/hr/hiring-document-types`). PDF bytes flow through the aggregate's
// multipart endpoints (Files service server-side); downloads reuse the platform signed-URL ticket.
import {
  type BulkHiringDocuments,
  type BulkWorkflowResultDto,
  type CompleteHiringDocuments,
  type CreateHiringDocuments,
  type FileDto,
  type HiringDocumentsDto,
  type HiringDocumentTypeDto,
  type Paginated,
  type WorkflowEnvelopeDto,
} from '@ecms/contracts';
import {
  buildQuery,
  get,
  getPage,
  post,
  postWorkflow,
  uploadWorkflow,
} from '../../../../../shared/lib/api-client';

export type HiringDocsListParams = Record<string, string | number | boolean | undefined | null>;

type HiringDocsEnvelope = Promise<WorkflowEnvelopeDto<HiringDocumentsDto>>;

export const listHiringDocs = (params: HiringDocsListParams): Promise<Paginated<HiringDocumentsDto>> =>
  getPage<HiringDocumentsDto>(`/hr/hiring-documents${buildQuery(params)}`);

export const getHiringDocs = (id: string): Promise<HiringDocumentsDto> =>
  get<HiringDocumentsDto>(`/hr/hiring-documents/${id}`);

export const createHiringDocs = (body: CreateHiringDocuments): HiringDocsEnvelope =>
  postWorkflow<HiringDocumentsDto>('/hr/hiring-documents', body);

/** Upload a PDF for a document type (multipart: file + typeId + version + optional notes). */
export const uploadHiringDoc = (id: string, form: FormData): HiringDocsEnvelope =>
  uploadWorkflow<HiringDocumentsDto>(`/hr/hiring-documents/${id}/documents`, form);

/** Replace an uploaded document with a new PDF version (multipart: file + version). */
export const replaceHiringDoc = (id: string, typeId: string, form: FormData): HiringDocsEnvelope =>
  uploadWorkflow<HiringDocumentsDto>(`/hr/hiring-documents/${id}/documents/${typeId}/replace`, form);

export const listDocumentVersions = (id: string, typeId: string): Promise<FileDto[]> =>
  get<FileDto[]>(`/hr/hiring-documents/${id}/documents/${typeId}/versions`);

export const completeHiringDocs = (id: string, body: CompleteHiringDocuments): HiringDocsEnvelope =>
  postWorkflow<HiringDocumentsDto>(`/hr/hiring-documents/${id}/complete`, body);

/** The admin document-type catalog — consumed read-only here to label + require types. */
export const listHiringDocumentTypes = (): Promise<Paginated<HiringDocumentTypeDto>> =>
  getPage<HiringDocumentTypeDto>(`/hr/hiring-document-types${buildQuery({ active: true, pageSize: 100 })}`);

/** RW17 — complete a whole selection through the shared bulk executor. */
export const bulkHiringDocs = (body: BulkHiringDocuments): Promise<BulkWorkflowResultDto> =>
  post<BulkWorkflowResultDto>('/hr/hiring-documents/bulk', body);
