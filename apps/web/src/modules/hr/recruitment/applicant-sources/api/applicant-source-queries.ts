import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApplicantSourceDto, type UpdateApplicantSource } from '@ecms/contracts';
import { RECRUITMENT_FORM_KEY } from '../../recruitment-form/api/recruitment-form-queries';
import * as api from './applicant-source-api';

const KEY = ['hr', 'applicant-sources'] as const;

/**
 * One page of the catalog, filtered by the server. The params are part of the query key, so paging
 * and filtering are cached per view rather than refetched into the same slot.
 */
export const useApplicantSources = (params: api.SourceListParams = {}) =>
  useQuery({
    queryKey: [...KEY, 'list', params] as const,
    queryFn: () => api.listApplicantSources(params),
  });

/**
 * The two catalog-wide counts the header cards show, each read as a list's `meta.totalItems` with
 * a page size of one — the count the endpoint computes anyway, without the rows. They are separate
 * from the table's query on purpose: the cards describe the whole catalog, and must not change
 * when the user filters the table under them.
 */
export const useSourceCounts = () =>
  useQuery({
    queryKey: [...KEY, 'counts'] as const,
    queryFn: async () => {
      const [all, active] = await Promise.all([
        api.listApplicantSources({ pageSize: 1 }),
        api.listApplicantSources({ pageSize: 1, active: true }),
      ]);
      return { total: all.meta.totalItems, active: active.meta.totalItems };
    },
    staleTime: 30_000,
  });

const useSourceWrite = <TInput>(fn: (input: TInput) => Promise<ApplicantSourceDto>) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    // A write answers with one source, not the list, so the list is refetched rather than patched
    // in place — a hand-merged array is a second copy of the server's ordering.
    //
    // The form is invalidated too, and that is not defensive: its `links` list has one row per
    // ACTIVE source, so adding a platform or disabling one changes it. Without this, a platform
    // added here has no link row until something else happens to refetch the form.
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEY }),
        qc.invalidateQueries({ queryKey: RECRUITMENT_FORM_KEY }),
      ]);
    },
  });
};

export const useCreateApplicantSource = () => useSourceWrite(api.createApplicantSource);

/**
 * Uploading an icon is two steps — put the file in the Files service, then point the source at it —
 * and they are one mutation because a file nobody references is litter. The source write is the
 * existing PATCH, so the list and the form are invalidated exactly as any other edit.
 */
export const useUploadSourceIcon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { source: ApplicantSourceDto; file: File }) => {
      const stored = await api.uploadApplicantSourceIcon(vars.source.id, vars.file);
      return api.updateApplicantSource(vars.source.id, {
        iconFileId: stored.id,
        version: vars.source.version,
      });
    },
    onSuccess: async () => {
      await Promise.all([
        qc.invalidateQueries({ queryKey: KEY }),
        qc.invalidateQueries({ queryKey: RECRUITMENT_FORM_KEY }),
      ]);
    },
  });
};

export const useUpdateApplicantSource = () =>
  useSourceWrite<{ id: string; body: UpdateApplicantSource }>((vars) =>
    api.updateApplicantSource(vars.id, vars.body),
  );
