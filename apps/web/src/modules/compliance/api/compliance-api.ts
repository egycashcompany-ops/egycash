// The files page's calls (ADR-013), one typed function per endpoint
// `apps/api/src/modules/compliance` serves, and nothing else. A file's bytes and a folder's picture
// are guarded, so they are fetched with the session and shown through an object URL: an `<img>` or
// a new tab cannot carry the token. Every opening and download goes through the module's own
// endpoint, which is what the seen report is read from.
import {
  type ComplianceAccessAction,
  type ComplianceDocumentDto,
  type ComplianceFolderDto,
  type CompliancePersonDto,
  type CompliancePreviewDto,
  type ComplianceSeenReportDto,
  type CreateComplianceFolder,
  type Paginated,
  type UpdateComplianceFolder,
} from '@ecms/contracts';
import {
  buildQuery,
  del,
  fetchBlob,
  get,
  getPage,
  patch,
  post,
  upload,
  uploadWithProgress,
  type UploadProgressOptions,
} from '../../../shared/lib/api-client';

const BASE = '/compliance';

export interface FolderListParams {
  page: number;
  pageSize: number;
  search?: string;
}

export const listFolders = (params: FolderListParams): Promise<Paginated<ComplianceFolderDto>> =>
  getPage<ComplianceFolderDto>(`${BASE}/folders${buildQuery({ ...params })}`);

export const getFolder = (id: string): Promise<ComplianceFolderDto> =>
  get<ComplianceFolderDto>(`${BASE}/folders/${id}`);

export const createFolder = (body: CreateComplianceFolder): Promise<ComplianceFolderDto> =>
  post<ComplianceFolderDto>(`${BASE}/folders`, body);

export const updateFolder = (
  id: string,
  body: UpdateComplianceFolder,
): Promise<ComplianceFolderDto> => patch<ComplianceFolderDto>(`${BASE}/folders/${id}`, body);

export const deleteFolder = (id: string, version: number): Promise<void> =>
  del<void>(`${BASE}/folders/${id}?version=${String(version)}`);

/** Put a picture on the folder, or change it — multipart, with the version the person saw. */
export const setFolderCover = (
  id: string,
  file: File,
  version: number,
): Promise<ComplianceFolderDto> => {
  const form = new FormData();
  form.append('file', file);
  form.append('version', String(version));
  return upload<ComplianceFolderDto>(`${BASE}/folders/${id}/cover`, form);
};

export const removeFolderCover = (id: string, version: number): Promise<ComplianceFolderDto> =>
  del<ComplianceFolderDto>(`${BASE}/folders/${id}/cover?version=${String(version)}`);

/** The picture's bytes. `v` names which picture, so a changed one is fetched afresh. */
export const folderCoverBlob = (id: string, version: string): Promise<Blob> =>
  fetchBlob(`${BASE}/folders/${id}/cover?v=${encodeURIComponent(version)}`);

/** The most files one read returns (`ListComplianceDocumentsQuerySchema`). */
const DOCUMENTS_PAGE = 100;

export const listDocuments = (
  folderId: string,
  page = 1,
): Promise<Paginated<ComplianceDocumentDto>> =>
  getPage<ComplianceDocumentDto>(
    `${BASE}/folders/${folderId}/documents${buildQuery({ page, pageSize: DOCUMENTS_PAGE })}`,
  );

/** Every file of a folder, page after page — what «تنزيل الكل» saves. */
export const listAllDocuments = async (folderId: string): Promise<ComplianceDocumentDto[]> => {
  const all: ComplianceDocumentDto[] = [];
  for (let page = 1; ; page += 1) {
    const read = await listDocuments(folderId, page);
    all.push(...read.items);
    if (read.meta.page >= read.meta.totalPages) return all;
  }
};

/** One file into a folder, with how far it has gone — a 20 MB file takes a moment. */
export const addDocument = (
  folderId: string,
  file: File,
  name: string,
  options: UploadProgressOptions = {},
): Promise<ComplianceDocumentDto> => {
  const form = new FormData();
  form.append('file', file);
  if (name.trim() !== '') form.append('name', name.trim());
  return uploadWithProgress<ComplianceDocumentDto>(
    `${BASE}/folders/${folderId}/documents`,
    form,
    options,
  );
};

export const renameDocument = (
  id: string,
  name: string,
  version: number,
): Promise<ComplianceDocumentDto> =>
  patch<ComplianceDocumentDto>(`${BASE}/documents/${id}`, { name, version });

export const deleteDocument = (id: string, version: number): Promise<void> =>
  del<void>(`${BASE}/documents/${id}?version=${String(version)}`);

/** A file's bytes — `view` to open it, `download` to save it; each is counted for a reader. */
export const documentBlob = (id: string, mode: ComplianceAccessAction): Promise<Blob> =>
  fetchBlob(`${BASE}/documents/${id}/content?mode=${mode}`);

export const documentPreview = (id: string): Promise<CompliancePreviewDto> =>
  get<CompliancePreviewDto>(`${BASE}/documents/${id}/preview`);

export const seenReport = (id: string): Promise<ComplianceSeenReportDto> =>
  get<ComplianceSeenReportDto>(`${BASE}/documents/${id}/views`);

export const searchPeople = (search: string): Promise<Paginated<CompliancePersonDto>> =>
  getPage<CompliancePersonDto>(`${BASE}/people${buildQuery({ search, pageSize: 20 })}`);
