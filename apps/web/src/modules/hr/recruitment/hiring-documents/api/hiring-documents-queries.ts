// TanStack Query hooks for the Hiring Documents feature (ADR-013). Reads cached by the shared key
// factory; each write returns the fresh aggregate, so it seeds the detail cache and invalidates only
// the list subtree. The employee lookup reuses the Employees list API; the document-type catalog is
// read-only. No new backend API.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type CompleteHiringDocuments, type CreateHiringDocuments, type HiringDocumentsDto } from '@ecms/contracts';
import { detailKey, listKey } from '../../../../../shared/lib/query-keys';
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

const useHiringDocsWriters = (
  id: string | null,
): { seedAndInvalidate: (updated: HiringDocumentsDto) => void } => {
  const qc = useQueryClient();
  return {
    seedAndInvalidate: (updated) => {
      qc.setQueryData(detailKey(MODULE, FEATURE, id ?? updated.id), updated);
      void qc.invalidateQueries({ queryKey: listKey(MODULE, FEATURE) });
    },
  };
};

export const useCreateHiringDocs = () => {
  const { seedAndInvalidate } = useHiringDocsWriters(null);
  return useMutation({
    mutationFn: (body: CreateHiringDocuments) => api.createHiringDocs(body),
    onSuccess: seedAndInvalidate,
  });
};

export const useUploadHiringDoc = (id: string) => {
  const { seedAndInvalidate } = useHiringDocsWriters(id);
  return useMutation({ mutationFn: (form: FormData) => api.uploadHiringDoc(id, form), onSuccess: seedAndInvalidate });
};

export const useReplaceHiringDoc = (id: string, typeId: string) => {
  const { seedAndInvalidate } = useHiringDocsWriters(id);
  return useMutation({
    mutationFn: (form: FormData) => api.replaceHiringDoc(id, typeId, form),
    onSuccess: seedAndInvalidate,
  });
};

export const useCompleteHiringDocs = (id: string) => {
  const { seedAndInvalidate } = useHiringDocsWriters(id);
  return useMutation({
    mutationFn: (body: CompleteHiringDocuments) => api.completeHiringDocs(id, body),
    onSuccess: seedAndInvalidate,
  });
};
