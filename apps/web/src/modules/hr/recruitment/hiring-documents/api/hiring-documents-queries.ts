// TanStack Query hooks for the Hiring Documents feature (ADR-013). Reads cached by the shared key
// factory; each write applies the workflow envelope to the cache (I6), so nothing is refetched. The
// employee lookup reuses the Employees list API; the document-type catalog is read-only.
import { useQuery } from '@tanstack/react-query';
import {
  type BulkHiringDocuments,
  type CompleteHiringDocuments,
  type CreateHiringDocuments,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
import { useBulkMutation } from '../../../../../shared/lib/useBulkMutation';
import { applyBulkWorkflowResult, useWorkflowMutation } from '../../shared/useWorkflowMutation';
import { listEmployees } from '../../../employee-management/employees/api/employee-api';
import * as api from './hiring-documents-api';
import { type HiringDocsListParams } from './hiring-documents-api';

const MODULE = 'hr';
const FEATURE = 'hiringDocuments';

export const useHiringDocsList = (params: HiringDocsListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listHiringDocs(params),
    placeholderData: (prev) => prev,
  });

export const useHiringDocs = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getHiringDocs(id),
    enabled: id !== '',
  });

/** Active document-type catalog (labels + required flags; drives the per-type upload UI). */
export const useHiringDocumentTypes = () =>
  useQuery({
    queryKey: [MODULE, 'hiringDocumentTypes', 'active'],
    queryFn: () => api.listHiringDocumentTypes(),
    staleTime: 5 * 60_000,
    select: (page) => page.items,
  });

/** Employee lookup for the create flow (reuses the Employees list API). */
export const useEmployeeSearch = (term: string) =>
  useQuery({
    queryKey: [MODULE, 'employees', 'search', term],
    queryFn: () => listEmployees({ search: term, pageSize: 8 }),
    enabled: term.trim().length >= 2,
    staleTime: 30_000,
    select: (page) => page.items,
  });

/** Version history for one document type (opened on demand). */
export const useDocumentVersions = (id: string, typeId: string | null) =>
  useQuery({
    queryKey: [MODULE, FEATURE, 'versions', id, typeId ?? ''],
    queryFn: () => api.listDocumentVersions(id, typeId ?? ''),
    enabled: id !== '' && typeId !== null,
  });

export const useCreateHiringDocs = () =>
  useWorkflowMutation(FEATURE, (body: CreateHiringDocuments) => api.createHiringDocs(body));

export const useUploadHiringDoc = (id: string) =>
  useWorkflowMutation(FEATURE, (form: FormData) => api.uploadHiringDoc(id, form));

export const useReplaceHiringDoc = (id: string, typeId: string) =>
  useWorkflowMutation(FEATURE, (form: FormData) => api.replaceHiringDoc(id, typeId, form));

export const useCompleteHiringDocs = (id: string) =>
  useWorkflowMutation(FEATURE, (body: CompleteHiringDocuments) => api.completeHiringDocs(id, body));

/** RW17 — bulk complete. The envelope is reported honestly: a set still missing a mandatory
 *  document fails as that item and is named, while the rest complete. */
export const useBulkHiringDocs = (onApplied?: () => void) =>
  useBulkMutation<BulkHiringDocuments>((body) => api.bulkHiringDocs(body), {
    applyResult: (qc, result) => applyBulkWorkflowResult(qc, FEATURE, result),
    ...(onApplied === undefined ? {} : { onApplied }),
  });
