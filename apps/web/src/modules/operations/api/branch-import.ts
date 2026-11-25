// «استيراد فروع من شيت» (Round 29) — the two calls and their hooks.
//
//   POST /operations/bank-branches/import/compare   multipart `bankId` + `file` → the comparison;
//                                                   nothing is written.
//   POST /operations/bank-branches/import/apply     the SAME file with the comparison's
//                                                   `fileSha256` and `planDigest` → what it wrote.
//
// The apply writes branches and areas, so it stales both catalogs' subtrees — the branches tab and
// the areas tab (and every branch picker) read them again. The compare writes nothing and stales
// nothing. The screen words both calls' refusals itself (`lib/branch-import.ts`), so neither hook
// lets the global notifier speak too.
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  type OperationsBranchImportAppliedDto,
  type OperationsBranchImportCompareDto,
} from '@ecms/contracts';
import { upload } from '../../../shared/lib/api-client';
import { featureKey } from '../../../shared/lib/query-keys';

/** The catalogs an import writes — the same subtrees the branch and area dialogs stale. */
export const branchImportStales = [
  featureKey('operations', 'bankBranches'),
  featureKey('operations', 'areas'),
] as const;

export const compareBranchImport = (
  bankId: string,
  file: File,
): Promise<OperationsBranchImportCompareDto> => {
  const form = new FormData();
  form.append('bankId', bankId);
  form.append('file', file);
  return upload<OperationsBranchImportCompareDto>('/operations/bank-branches/import/compare', form);
};

export const applyBranchImport = (
  bankId: string,
  file: File,
  hashes: { fileSha256: string; planDigest: string },
): Promise<OperationsBranchImportAppliedDto> => {
  const form = new FormData();
  form.append('bankId', bankId);
  form.append('fileSha256', hashes.fileSha256);
  form.append('planDigest', hashes.planDigest);
  form.append('file', file);
  return upload<OperationsBranchImportAppliedDto>('/operations/bank-branches/import/apply', form);
};

const screenWordsIt = (): void => undefined;

export const useCompareBranchImport = () =>
  useMutation({
    mutationFn: ({ bankId, file }: { bankId: string; file: File }) =>
      compareBranchImport(bankId, file),
    onError: screenWordsIt,
  });

export const useApplyBranchImport = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      bankId,
      file,
      fileSha256,
      planDigest,
    }: {
      bankId: string;
      file: File;
      fileSha256: string;
      planDigest: string;
    }) => applyBranchImport(bankId, file, { fileSha256, planDigest }),
    onSuccess: async () => {
      for (const queryKey of branchImportStales) await qc.invalidateQueries({ queryKey });
    },
    onError: screenWordsIt,
  });
};
