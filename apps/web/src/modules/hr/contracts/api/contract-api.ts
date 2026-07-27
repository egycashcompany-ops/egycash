// Contracts api/ surface (ADR-013). Endpoints mirror the backend contract exactly
// (frozen design §3): contracts lifecycle, versioned templates, the types catalog and
// the server-owned variable catalog. Document HTML rides outside the JSON envelope.
import {
  type AddContractAttachment,
  type AmendOrRenewContract,
  type CloneContractTemplate,
  type ContractBrandingDto,
  type ContractDto,
  type ContractPreviewDto,
  type ContractTemplateDto,
  type ContractTypeDto,
  type ContractVariableDto,
  type CreateContract,
  type CreateContractTemplate,
  type CreateContractType,
  type DecideContractApproval,
  type DownloadTicketDto,
  type Paginated,
  type PreviewContract,
  type SignContractBlock,
  type TerminateContract,
  type UpdateContractBranding,
  type UpdateContractDraft,
  type UpdateContractTemplate,
  type UpdateContractType,
} from '@ecms/contracts';
import { api, buildQuery, get, getPage, getText, patch, post, upload } from '../../../../shared/lib/api-client';

export type ContractListParams = Record<string, string | number | boolean | undefined | null>;

/** UI state keeps overrides as a record; the wire carries PAIRS (dotted keys would be
 *  stripped from a keyed record by the server's mongo-sanitize middleware). */
export const toOverridePairs = (record: Record<string, string>): { key: string; value: string }[] =>
  Object.entries(record).map(([key, value]) => ({ key, value }));

// ── Contracts ───────────────────────────────────────────────────────────────
export const listContracts = (params: ContractListParams): Promise<Paginated<ContractDto>> =>
  getPage<ContractDto>(`/hr/contracts${buildQuery(params)}`);
export const getContract = (id: string): Promise<ContractDto> => get<ContractDto>(`/hr/contracts/${id}`);
export const createContract = (body: CreateContract): Promise<ContractDto> =>
  post<ContractDto>('/hr/contracts', body);
export const previewContract = (body: PreviewContract): Promise<ContractPreviewDto> =>
  post<ContractPreviewDto>('/hr/contracts/preview', body);
export const updateContractDraft = (id: string, body: UpdateContractDraft): Promise<ContractDto> =>
  patch<ContractDto>(`/hr/contracts/${id}`, body);
export const deleteContractDraft = (id: string): Promise<void> =>
  api<void>(`/hr/contracts/${id}`, { method: 'DELETE' });
export const submitContract = (id: string, version: number): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/submit`, { version });
export const decideContractApproval = (id: string, body: DecideContractApproval): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/approval`, body);
export const generateContract = (id: string, version: number): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/generate`, { version });
export const retryContractPdf = (id: string, version: number): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/generate/retry`, { version });
export const signContractBlock = (id: string, body: SignContractBlock): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/sign`, body);
export const amendContract = (id: string, body: AmendOrRenewContract): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/amend`, body);
export const renewContract = (id: string, body: AmendOrRenewContract): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/renew`, body);
export const terminateContract = (id: string, body: TerminateContract): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/terminate`, body);
export const archiveContract = (id: string, version: number): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/archive`, { version });

// Attachments (bytes via the platform Files service; multipart on the module route).
export const addContractAttachment = (id: string, body: AddContractAttachment & { version: number }): Promise<ContractDto> =>
  post<ContractDto>(`/hr/contracts/${id}/attachments`, body);
export const uploadContractAttachment = (
  id: string,
  fields: { category: string; label: string; version: number },
  file: File,
): Promise<ContractDto> => {
  const form = new FormData();
  form.append('category', fields.category);
  form.append('label', fields.label);
  form.append('version', String(fields.version));
  form.append('file', file);
  return upload<ContractDto>(`/hr/contracts/${id}/attachments/upload`, form);
};
export const removeContractAttachment = (id: string, attachmentId: string, version: number): Promise<ContractDto> =>
  api<ContractDto>(`/hr/contracts/${id}/attachments/${attachmentId}`, {
    method: 'DELETE',
    body: JSON.stringify({ version }),
  });

// Exports (audited server-side under contract.print).
export const contractDocumentHtml = (id: string): Promise<string> => getText(`/hr/contracts/${id}/document`);
export const contractPdfTicket = (id: string): Promise<{ ready: boolean; ticket: DownloadTicketDto | null }> =>
  get<{ ready: boolean; ticket: DownloadTicketDto | null }>(`/hr/contracts/${id}/pdf`);

// ── Variable catalog (D5) ───────────────────────────────────────────────────
export const listContractVariables = (): Promise<ContractVariableDto[]> =>
  get<ContractVariableDto[]>('/hr/contracts/variables');

// ── Types catalog ───────────────────────────────────────────────────────────
export const listContractTypes = (): Promise<ContractTypeDto[]> => get<ContractTypeDto[]>('/hr/contract-types');
export const createContractType = (body: CreateContractType): Promise<ContractTypeDto> =>
  post<ContractTypeDto>('/hr/contract-types', body);
export const updateContractType = (id: string, body: UpdateContractType): Promise<ContractTypeDto> =>
  patch<ContractTypeDto>(`/hr/contract-types/${id}`, body);

// ── Templates (latest per key; the version chain via /keys/:key/versions) ───
export const listContractTemplates = (): Promise<ContractTemplateDto[]> =>
  get<ContractTemplateDto[]>('/hr/contract-templates');
export const listTemplateVersions = (key: string): Promise<ContractTemplateDto[]> =>
  get<ContractTemplateDto[]>(`/hr/contract-templates/keys/${key}/versions`);
export const getContractTemplate = (id: string): Promise<ContractTemplateDto> =>
  get<ContractTemplateDto>(`/hr/contract-templates/${id}`);
export const createContractTemplate = (body: CreateContractTemplate): Promise<ContractTemplateDto> =>
  post<ContractTemplateDto>('/hr/contract-templates', body);
export const updateContractTemplate = (id: string, body: UpdateContractTemplate): Promise<ContractTemplateDto> =>
  patch<ContractTemplateDto>(`/hr/contract-templates/${id}`, body);
export const publishContractTemplate = (id: string, version: number): Promise<ContractTemplateDto> =>
  post<ContractTemplateDto>(`/hr/contract-templates/${id}/publish`, { version });
export const cloneContractTemplate = (id: string, body: CloneContractTemplate): Promise<ContractTemplateDto> =>
  post<ContractTemplateDto>(`/hr/contract-templates/${id}/clone`, body);
export const archiveContractTemplate = (id: string, version: number): Promise<ContractTemplateDto> =>
  post<ContractTemplateDto>(`/hr/contract-templates/${id}/archive`, { version });

// ── Branding profile (A24) ──────────────────────────────────────────────────
export const getContractBranding = (): Promise<ContractBrandingDto> =>
  get<ContractBrandingDto>('/hr/contract-templates/branding');
export const updateContractBranding = (body: UpdateContractBranding): Promise<ContractBrandingDto> =>
  patch<ContractBrandingDto>('/hr/contract-templates/branding', body);
export const uploadContractBrandingLogo = (file: File): Promise<ContractBrandingDto> => {
  const form = new FormData();
  form.append('file', file);
  return upload<ContractBrandingDto>('/hr/contract-templates/branding/logo', form);
};
