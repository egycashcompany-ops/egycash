import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ApplicantSourceDto, type UpdateApplicantSource } from '@ecms/contracts';
import { RECRUITMENT_FORM_KEY } from '../../recruitment-form/api/recruitment-form-queries';
import * as api from './applicant-source-api';

const KEY = ['hr', 'applicant-sources'] as const;

export const useApplicantSources = () =>
  useQuery({ queryKey: KEY, queryFn: async () => (await api.listApplicantSources()).items });

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

export const useUpdateApplicantSource = () =>
  useSourceWrite<{ id: string; body: UpdateApplicantSource }>((vars) =>
    api.updateApplicantSource(vars.id, vars.body),
  );
