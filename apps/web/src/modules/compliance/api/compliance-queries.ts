// TanStack Query hooks for the files page (ADR-013). Every write re-reads the `folders` subtree —
// the shelf, the folder and its files alike, since a file counts on its folder — and a refusal for a
// moved `version` (409 `STALE_DOCUMENT`) re-reads it too, so the screen behind a dialog shows the
// folder as it now is.
//
// A reader's shelf has no realtime signal (they join no topic room), so the shelf, the open folder
// and its files read themselves again when the window regains focus — switched on here, against the
// app's default, on purpose.
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from '@tanstack/react-query';
import {
  ErrorCodes,
  type CreateComplianceFolder,
  type UpdateComplianceFolder,
} from '@ecms/contracts';
import { ApiError } from '../../../shared/lib/api-client';
import {
  complianceKeys,
  folderDocumentsKey,
  folderKey,
  folderListKey,
  peopleSearchKey,
  seenReportKey,
} from './compliance-keys';
import * as api from './compliance-api';

/** A success re-reads the shelf; so does a refusal for a moved version; any other changed nothing. */
export const complianceWriteCallbacks = (
  qc: QueryClient,
): { onSuccess: () => void; onError: (error: unknown) => void } => {
  const reread = (): void => {
    void qc.invalidateQueries({ queryKey: complianceKeys.folders });
  };
  return {
    onSuccess: reread,
    onError: (error) => {
      if (error instanceof ApiError && error.code === ErrorCodes.STALE_DOCUMENT) reread();
    },
  };
};

const useComplianceWrite = <TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) => {
  const qc = useQueryClient();
  return useMutation({ mutationFn, ...complianceWriteCallbacks(qc) });
};

export const useComplianceFolders = (params: api.FolderListParams) =>
  useQuery({
    queryKey: folderListKey(params),
    queryFn: () => api.listFolders(params),
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: true,
  });

/** One folder, kept fresh while its dialog is open — its name, its picture, who sees it. */
export const useComplianceFolder = (id: string) =>
  useQuery({
    queryKey: folderKey(id),
    queryFn: () => api.getFolder(id),
    enabled: id !== '',
    retry: false,
    refetchOnWindowFocus: true,
  });

/**
 * A folder's files, a hundred at a time (the most one read returns), newest first. The dialog
 * offers the next hundred; «تنزيل الكل» reads every page itself (`api.listAllDocuments`).
 */
export const useFolderDocuments = (folderId: string) =>
  useInfiniteQuery({
    queryKey: folderDocumentsKey(folderId),
    queryFn: ({ pageParam }) => api.listDocuments(folderId, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.meta.page < last.meta.totalPages ? last.meta.page + 1 : undefined,
    enabled: folderId !== '',
    retry: false,
    refetchOnWindowFocus: true,
  });

export const useSeenReport = (documentId: string) =>
  useQuery({
    queryKey: seenReportKey(documentId),
    queryFn: () => api.seenReport(documentId),
    enabled: documentId !== '',
    retry: false,
  });

/** A Word or Excel file read into the page. Not cached between openings: each one is counted. */
export const useDocumentPreview = (documentId: string) =>
  useQuery({
    queryKey: ['compliance', 'preview', documentId],
    queryFn: () => api.documentPreview(documentId),
    enabled: documentId !== '',
    retry: false,
    gcTime: 0,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

/** The sharing picker's search: asked only once something is typed. */
export const usePeopleSearch = (search: string, enabled: boolean) =>
  useQuery({
    queryKey: peopleSearchKey(search),
    queryFn: () => api.searchPeople(search),
    enabled: enabled && search.trim() !== '',
    staleTime: 30_000,
  });

export const useCreateFolder = () =>
  useComplianceWrite((body: CreateComplianceFolder) => api.createFolder(body));

export const useUpdateFolder = () =>
  useComplianceWrite(({ id, body }: { id: string; body: UpdateComplianceFolder }) =>
    api.updateFolder(id, body),
  );

/**
 * A folder's deletion: its own reads are dropped BEFORE the shelf is read again, so a dialog still
 * open on it does not ask for a folder that is gone and say «not found».
 */
export const useDeleteFolder = () => {
  const qc = useQueryClient();
  const { onError } = complianceWriteCallbacks(qc);
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) => api.deleteFolder(id, version),
    onSuccess: (_result, { id }) => {
      qc.removeQueries({ queryKey: folderKey(id) });
      void qc.invalidateQueries({ queryKey: complianceKeys.folders });
    },
    onError,
  });
};

export const useSetFolderCover = () =>
  useComplianceWrite(({ id, file, version }: { id: string; file: File; version: number }) =>
    api.setFolderCover(id, file, version),
  );

export const useRemoveFolderCover = () =>
  useComplianceWrite(({ id, version }: { id: string; version: number }) =>
    api.removeFolderCover(id, version),
  );

export const useAddDocument = () =>
  useComplianceWrite(
    ({
      folderId,
      file,
      name,
      onProgress,
    }: {
      folderId: string;
      file: File;
      name: string;
      onProgress?: (percent: number) => void;
    }) => api.addDocument(folderId, file, name, onProgress === undefined ? {} : { onProgress }),
  );

export const useRenameDocument = () =>
  useComplianceWrite(({ id, name, version }: { id: string; name: string; version: number }) =>
    api.renameDocument(id, name, version),
  );

export const useDeleteDocument = () =>
  useComplianceWrite(({ id, version }: { id: string; version: number }) =>
    api.deleteDocument(id, version),
  );
