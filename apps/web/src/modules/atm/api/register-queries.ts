// TanStack Query hooks for the efficiency register (ADR-013). Keys follow the platform factory —
// ['atm', feature, kind, params] — and say the same thing the realtime registry says for the
// `atm.registerEntry` topic, so a write here and a write somebody else made go stale identically.
//
// Invalidation facts worth stating:
//   · every entry write stales the entries, the Data Report (its counts are the open entries),
//     the branch options (distinct values of the entries) AND the Operations machines — a receipt,
//     a handover or a delete creates, reactivates or archives a machine in the Operations list (D2);
//   · an APPLIED import stales the same four plus the run list; a preview writes nothing.
//
// Caching of secret-bearing payloads (DEC-18, the medical precedent): for a caller who holds
// `atmRegister.viewSecrets`, an entry payload carries key codes and notes, so those queries keep
// nothing — `staleTime: 0, gcTime: 0`. The reveal is a mutation whose cache entry is collected at
// once (`gcTime: 0`) and whose value the dialog clears with `reset()`; it never enters the query
// cache at all.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type AtmRegisterImportCategory,
  type HandoverAtmRegisterEntry,
  type ReceiveAtmRegisterEntry,
  type ReceivePendingAtmRegisterEntry,
  type UpdateAtmRegisterEntry,
} from '@ecms/contracts';
import { useCan } from '../../../platform/rbac/Can';
import { detailKey, featureKey, listKey } from '../../../shared/lib/query-keys';
import * as api from './register-api';
import { type RegisterListParams } from './register-api';

const MODULE = 'atm';

/** The register's key families — also the prefixes the realtime registry names. */
export const registerKeys = {
  entries: featureKey(MODULE, 'registerEntries'),
  report: featureKey(MODULE, 'registerReport'),
  meta: featureKey(MODULE, 'registerMeta'),
  branchOptions: featureKey(MODULE, 'registerBranchOptions'),
  importRuns: featureKey(MODULE, 'registerImportRuns'),
  machines: featureKey(MODULE, 'machines'),
};

/** No cache for a payload that may carry key codes (DEC-18); the default otherwise. */
const useSecretsCaching = (): { staleTime?: number; gcTime?: number } => {
  const can = useCan();
  return can('atmRegister.viewSecrets') ? { staleTime: 0, gcTime: 0 } : {};
};

const invalidateRegister = (client: ReturnType<typeof useQueryClient>): void => {
  void client.invalidateQueries({ queryKey: registerKeys.entries });
  void client.invalidateQueries({ queryKey: registerKeys.report });
  void client.invalidateQueries({ queryKey: registerKeys.branchOptions });
  void client.invalidateQueries({ queryKey: registerKeys.machines });
};

// ── Reads ───────────────────────────────────────────────────────────────────
export const useRegisterEntries = (params: RegisterListParams, enabled = true) => {
  const caching = useSecretsCaching();
  return useQuery({
    queryKey: listKey(MODULE, 'registerEntries', params),
    queryFn: () => api.listRegisterEntries(params),
    enabled,
    ...caching,
  });
};

export const useRegisterEntry = (id: string | null) => {
  const caching = useSecretsCaching();
  return useQuery({
    queryKey: detailKey(MODULE, 'registerEntries', id ?? ''),
    queryFn: () => api.getRegisterEntry(id ?? ''),
    enabled: id !== null && id !== '',
    ...caching,
  });
};

export const useRegisterMeta = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'registerMeta'),
    queryFn: () => api.getRegisterMeta(),
    enabled,
  });

export const useRegisterBranchOptions = (branchId: string | null) =>
  useQuery({
    queryKey: listKey(MODULE, 'registerBranchOptions', { branchId }),
    queryFn: () => api.getRegisterBranchOptions(branchId ?? ''),
    enabled: branchId !== null && branchId !== '',
  });

/** No polling and no as-of parameter (D7): the stamp is the server's `generatedAt`. */
export const useRegisterReport = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'registerReport'),
    queryFn: () => api.getRegisterReport(),
    enabled,
  });

export const useRegisterImportRuns = (enabled = true) =>
  useQuery({
    queryKey: listKey(MODULE, 'registerImportRuns'),
    queryFn: () => api.listRegisterImportRuns(),
    enabled,
  });

// ── Entry writes ────────────────────────────────────────────────────────────
export const useReceiveRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (body: ReceiveAtmRegisterEntry) => api.receiveRegisterEntry(body),
    onSuccess: () => invalidateRegister(client),
  });
};

export const useUpdateRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateAtmRegisterEntry }) =>
      api.updateRegisterEntry(id, body),
    onSuccess: () => invalidateRegister(client),
  });
};

export const useReceivePendingRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ReceivePendingAtmRegisterEntry }) =>
      api.receivePendingRegisterEntry(id, body),
    onSuccess: () => invalidateRegister(client),
  });
};

export const useHandoverRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: HandoverAtmRegisterEntry }) =>
      api.handoverRegisterEntry(id, body),
    onSuccess: () => invalidateRegister(client),
  });
};

export const useLinkRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.linkRegisterEntry(id, version),
    onSuccess: () => invalidateRegister(client),
  });
};

export const useDeleteRegisterEntry = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version: number }) =>
      api.deleteRegisterEntry(id, version),
    onSuccess: () => invalidateRegister(client),
  });
};

/**
 * The audited reveal. `gcTime: 0` so TanStack's MutationCache does not hold the value for its
 * default five minutes; the dialog calls `reset()` when it clears the value or closes. Nothing is
 * invalidated — a reveal changes no data, it only writes an audit row.
 */
export const useRevealRegisterCombination = () =>
  useMutation({
    mutationFn: (id: string) => api.revealRegisterCombination(id),
    gcTime: 0,
  });

// ── Import ──────────────────────────────────────────────────────────────────
export const useImportRegisterWorkbook = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({
      file,
      apply,
      fileSha256,
      reportOverride,
    }: {
      file: File;
      apply: readonly AtmRegisterImportCategory[];
      fileSha256?: string;
      reportOverride?: boolean;
    }) =>
      api.importRegisterWorkbook(file, {
        apply,
        ...(fileSha256 === undefined ? {} : { fileSha256 }),
        ...(reportOverride === undefined ? {} : { reportOverride }),
      }),
    onSuccess: (result) => {
      if (result.mode !== 'applied') return;
      invalidateRegister(client);
      void client.invalidateQueries({ queryKey: registerKeys.importRuns });
    },
  });
};
