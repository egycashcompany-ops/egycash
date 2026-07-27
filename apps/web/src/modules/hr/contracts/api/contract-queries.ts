// TanStack Query hooks for the Contracts app (ADR-013). Contract mutations invalidate the
// whole hr subtree (lists, the detail, the employee tab and the templates all move together);
// the contract detail polls while an async generation is in flight (A13 UI progress).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AddContractAttachment,
  type AmendOrRenewContract,
  type CloneContractTemplate,
  type ContractDto,
  type CreateContract,
  type CreateContractTemplate,
  type CreateContractType,
  type DecideContractApproval,
  type PreviewContract,
  type SignContractBlock,
  type TerminateContract,
  type UpdateContractBranding,
  type UpdateContractDraft,
  type UpdateContractTemplate,
  type UpdateContractType,
} from '@ecms/contracts';
import { detailKey, listKey } from '../../../../shared/lib/query-keys';
import * as api from './contract-api';
import { type ContractListParams } from './contract-api';

const MODULE = 'hr';
const FEATURE = 'contracts';
const ROOT = [MODULE, FEATURE] as const;

const generationInFlight = (c: ContractDto | undefined): boolean =>
  c !== undefined && (c.generation.status === 'queued' || c.generation.status === 'rendering');

export const useContracts = (params: ContractListParams) =>
  useQuery({
    queryKey: listKey(MODULE, FEATURE, params),
    queryFn: () => api.listContracts(params),
    placeholderData: (prev) => prev,
  });

export const useContract = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, FEATURE, id),
    queryFn: () => api.getContract(id),
    enabled: id !== '',
    // A13 — keep the generation progress live without manual refreshes.
    refetchInterval: (query) => (generationInFlight(query.state.data) ? 2500 : false),
  });

export const useEmployeeContracts = (employeeId: string) =>
  useQuery({
    queryKey: [...ROOT, 'byEmployee', employeeId],
    queryFn: () => api.listContracts({ employeeId, pageSize: 50 }),
    enabled: employeeId !== '',
  });

export const useContractVariables = () =>
  useQuery({ queryKey: [...ROOT, 'variables'], queryFn: api.listContractVariables, staleTime: 5 * 60_000 });

export const useContractTypes = () =>
  useQuery({ queryKey: listKey(MODULE, 'contractTypes', {}), queryFn: api.listContractTypes, staleTime: 60_000 });

export const useContractTemplates = (enabled = true) =>
  useQuery({ queryKey: listKey(MODULE, 'contractTemplates', {}), queryFn: api.listContractTemplates, enabled });

export const useContractTemplate = (id: string) =>
  useQuery({
    queryKey: detailKey(MODULE, 'contractTemplates', id),
    queryFn: () => api.getContractTemplate(id),
    enabled: id !== '',
  });

export const useTemplateVersions = (key: string) =>
  useQuery({
    queryKey: [...ROOT, 'templateVersions', key],
    queryFn: () => api.listTemplateVersions(key),
    enabled: key !== '',
  });

const useContractsInvalidation = () => {
  const qc = useQueryClient();
  return () => {
    void qc.invalidateQueries({ queryKey: [MODULE] });
  };
};

// ── Contract lifecycle mutations ────────────────────────────────────────────

export const useCreateContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({ mutationFn: (body: CreateContract) => api.createContract(body), onSuccess: invalidate });
};

export const usePreviewContract = () =>
  useMutation({ mutationFn: (body: PreviewContract) => api.previewContract(body) });

export const useUpdateContractDraft = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateContractDraft }) => api.updateContractDraft(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useDeleteContractDraft = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({ mutationFn: (id: string) => api.deleteContractDraft(id), onSuccess: invalidate });
};

export const useSubmitContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.submitContract(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

export const useDecideContractApproval = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: DecideContractApproval }) => api.decideContractApproval(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useGenerateContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.generateContract(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

export const useRetryContractPdf = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.retryContractPdf(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

export const useSignContractBlock = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: SignContractBlock }) => api.signContractBlock(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useAmendContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: AmendOrRenewContract }) => api.amendContract(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useRenewContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: AmendOrRenewContract }) => api.renewContract(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useTerminateContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: TerminateContract }) => api.terminateContract(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useArchiveContract = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.archiveContract(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

export const useAddContractAttachment = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: AddContractAttachment & { version: number } }) =>
      api.addContractAttachment(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useUploadContractAttachment = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; fields: { category: string; label: string; version: number }; file: File }) =>
      api.uploadContractAttachment(vars.id, vars.fields, vars.file),
    onSuccess: invalidate,
  });
};

export const useRemoveContractAttachment = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; attachmentId: string; version: number }) =>
      api.removeContractAttachment(vars.id, vars.attachmentId, vars.version),
    onSuccess: invalidate,
  });
};

// ── Types + templates administration ────────────────────────────────────────

export const useCreateContractType = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({ mutationFn: (body: CreateContractType) => api.createContractType(body), onSuccess: invalidate });
};

export const useUpdateContractType = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateContractType }) => api.updateContractType(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useCreateContractTemplate = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (body: CreateContractTemplate) => api.createContractTemplate(body),
    onSuccess: invalidate,
  });
};

export const useUpdateContractTemplate = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: UpdateContractTemplate }) => api.updateContractTemplate(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const usePublishContractTemplate = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.publishContractTemplate(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

export const useCloneContractTemplate = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; body: CloneContractTemplate }) => api.cloneContractTemplate(vars.id, vars.body),
    onSuccess: invalidate,
  });
};

export const useArchiveContractTemplate = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (vars: { id: string; version: number }) => api.archiveContractTemplate(vars.id, vars.version),
    onSuccess: invalidate,
  });
};

// ── Branding profile (A24) ──────────────────────────────────────────────────

export const useContractBranding = (enabled = true) =>
  useQuery({ queryKey: [...ROOT, 'branding'], queryFn: api.getContractBranding, enabled });

export const useUpdateContractBranding = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({
    mutationFn: (body: UpdateContractBranding) => api.updateContractBranding(body),
    onSuccess: invalidate,
  });
};

export const useUploadContractBrandingLogo = () => {
  const invalidate = useContractsInvalidation();
  return useMutation({ mutationFn: (file: File) => api.uploadContractBrandingLogo(file), onSuccess: invalidate });
};
